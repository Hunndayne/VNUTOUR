import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  fetchEncryptedAccountDetails,
  fetchEncryptedTeamMemberDetails,
  saveEncryptedAccountDetails,
} from '../src/accountDetailsCrypto.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const python = process.env.TEST_PYTHON || fileURLToPath(new URL('../../backend/.venv/Scripts/python.exe', import.meta.url))
const username = 'Nguyễn Bảo Ân'
const payload = { account: { username }, participant: { cccd: '012345678901', full_name: username } }
const encryptWithBackend = body => JSON.parse(execFileSync(python, ['-c', `
import json, sys
sys.stdin.reconfigure(encoding='utf-8')
sys.path.insert(0, 'backend/webapi')
from api.services.account_detail_encryption import encrypt_account_details, load_browser_public_key
data = json.load(sys.stdin)
print(json.dumps(encrypt_account_details(data['payload'], load_browser_public_key(data['public_key']), username=data['username'])))
`], { cwd: root, input: JSON.stringify(body), encoding: 'utf8' }))

test('Web Crypto decrypts a real Python backend response using a fresh key per request', async () => {
  const publicKeys = []
  const request = async (path, options) => {
    assert.equal(path, `/admin/accounts/${encodeURIComponent(username)}/details`)
    assert.equal(options.method, 'POST')
    assert.equal(options.cache, 'no-store')
    assert.deepEqual(Object.keys(options.body), ['public_key'])
    publicKeys.push(options.body.public_key)
    return encryptWithBackend({ ...options.body, username, payload })
  }
  assert.deepEqual(await fetchEncryptedAccountDetails(username, request), payload)
  assert.deepEqual(await fetchEncryptedAccountDetails(username, request), payload)
  assert.notEqual(publicKeys[0], publicKeys[1])
})

test('team member details use the same authenticated encryption on the team-scoped endpoint', async () => {
  const mssv = 'SV002'
  const memberPayload = {
    member: { mssv, full_name: 'Tran Target', phone: '0901234567' },
    accounts: { discord: { connected: true }, web: { connected: true } },
  }
  const result = await fetchEncryptedTeamMemberDetails(mssv, async (path, options) => {
    assert.equal(path, `/my-team/members/${mssv}/details`)
    assert.equal(options.method, 'POST')
    assert.equal(options.cache, 'no-store')
    return encryptWithBackend({ ...options.body, username: mssv, payload: memberPayload })
  })
  assert.deepEqual(result, memberPayload)
})

test('rejects plaintext, corrupted ciphertext, wrong account and replay to another key', async () => {
  let previous
  for (const mode of ['plaintext', 'corrupt', 'wrong-account', 'replay']) {
    await assert.rejects(fetchEncryptedAccountDetails(username, async (_, { body }) => {
      const encrypted = encryptWithBackend({ ...body, username: mode === 'wrong-account' ? 'another-user' : username, payload })
      if (mode === 'plaintext') { previous = encrypted; return payload }
      if (mode === 'replay') return previous
      if (mode === 'corrupt') {
        const parts = encrypted.jwe.split('.')
        parts[3] = (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1)
        encrypted.jwe = parts.join('.')
      }
      return encrypted
    }), /invalid_encrypted_response/)
  }
})

test('closing the drawer aborts before sending or returning sensitive data', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(fetchEncryptedAccountDetails(username, () => {
    assert.fail('must not request data after closing')
  }, { signal: controller.signal }), { name: 'AbortError' })
})

const editPayload = {
  account: { id: 42, username, updated_at: '2026-09-10T02:03:04+00:00' },
  participant: { id: 81, updated_at: '2026-09-10T02:03:05+00:00' },
}
const changes = { email: 'corrected@example.com', cccd: '012345678901', full_name: username }
const expectedRevision = {
  account_updated_at: editPayload.account.updated_at,
  participant_id: editPayload.participant.id,
  participant_updated_at: editPayload.participant.updated_at,
}
const editWithBackend = input => JSON.parse(execFileSync(python, ['-c', `
import json, sys, time
from types import SimpleNamespace
from unittest.mock import patch
from django.conf import settings
settings.configure(SECRET_KEY='test-only-secret-not-used-in-production')
sys.stdin.reconfigure(encoding='utf-8')
sys.path.insert(0, 'backend/webapi')
from api.services.account_edit_encryption import create_edit_grant, decrypt_edit_request, EditEncryptionError
data = json.load(sys.stdin)
actor = SimpleNamespace(id=data.get('actor_id', 9), token=data.get('session', 'test-admin-session'))
target = SimpleNamespace(id=data.get('target_id', 42), username=data.get('username', 'target'))
try:
    if data['operation'] == 'create':
        if data.get('expired'):
            with patch('cryptography.fernet.time.time', return_value=time.time() - 301):
                result = create_edit_grant(actor, target, data['payload'])
        else:
            result = create_edit_grant(actor, target, data['payload'])
    else:
        updated, revision = decrypt_edit_request(actor, target, data['body'])
        result = {'changes': updated, 'revision': revision}
except EditEncryptionError as exc:
    result = {'error': exc.code, 'status': exc.status}
print(json.dumps(result))
`], { cwd: root, input: JSON.stringify(input), encoding: 'utf8' }))
const newEditDetails = options => ({
  ...editPayload,
  _edit: editWithBackend({ operation: 'create', payload: editPayload, ...options }),
})

test('Web Crypto encrypts updates for the real backend with fresh IVs and no plaintext fields', async () => {
  const details = newEditDetails()
  const envelopes = []
  const controller = new AbortController()
  const request = async (path, options) => {
    assert.equal(path, `/admin/accounts/${encodeURIComponent(username)}/details/edit`)
    assert.equal(options.method, 'POST')
    assert.equal(options.cache, 'no-store')
    assert.equal(options.signal, controller.signal)
    assert.deepEqual(Object.keys(options.body).sort(), ['ciphertext', 'grant', 'iv'])
    const outgoing = JSON.stringify(options.body)
    for (const secret of [...Object.values(changes), details._edit.key, 'email', 'cccd', 'full_name']) {
      assert.equal(outgoing.includes(secret), false)
    }
    assert.equal(Buffer.from(options.body.iv, 'base64url').length, 12)
    envelopes.push(options.body)
    assert.deepEqual(editWithBackend({ operation: 'decrypt', body: options.body }), {
      changes, revision: expectedRevision,
    })
    return { ok: true }
  }
  assert.deepEqual(await saveEncryptedAccountDetails(username, details, changes, request, {
    signal: controller.signal,
  }), { ok: true })
  await saveEncryptedAccountDetails(username, details, changes, request, { signal: controller.signal })
  assert.notEqual(envelopes[0].iv, envelopes[1].iv)
  assert.notEqual(envelopes[0].ciphertext, envelopes[1].ciphertext)
  assert.notEqual(details._edit.key, newEditDetails()._edit.key)
})

test('backend binds edit grants to the admin, login session and target account', async () => {
  const details = newEditDetails()
  await saveEncryptedAccountDetails(username, details, changes, async (_, { body }) => {
    for (const context of [{ actor_id: 10 }, { session: 'new-login-session' }, { target_id: 43 }]) {
      assert.deepEqual(editWithBackend({ operation: 'decrypt', body, ...context }), {
        error: 'edit_session_invalid', status: 403,
      })
    }
  })
})

test('backend rejects expired grants and tampered ciphertext, IVs, grants and account AAD', async () => {
  await saveEncryptedAccountDetails(username, newEditDetails({ expired: true }), changes, async (_, { body }) => {
    assert.deepEqual(editWithBackend({ operation: 'decrypt', body }), {
      error: 'edit_session_expired', status: 410,
    })
  })
  const details = newEditDetails()
  await saveEncryptedAccountDetails(username, details, changes, async (_, { body }) => {
    for (const field of ['ciphertext', 'iv', 'grant']) {
      const corrupted = { ...body, [field]: (body[field][0] === 'A' ? 'B' : 'A') + body[field].slice(1) }
      assert.deepEqual(editWithBackend({ operation: 'decrypt', body: corrupted }), {
        error: field === 'grant' ? 'edit_session_expired' : 'invalid_encrypted_request',
        status: field === 'grant' ? 410 : 400,
      })
    }
  })
  await saveEncryptedAccountDetails(username, { ...details, account: { ...details.account, id: 43 } },
    changes, async (_, { body }) => {
      assert.deepEqual(editWithBackend({ operation: 'decrypt', body }), {
        error: 'invalid_encrypted_request', status: 400,
      })
    })
})

test('backend rejects plaintext, malformed envelopes and oversized updates', async () => {
  await saveEncryptedAccountDetails(username, newEditDetails(), changes, async (_, { body }) => {
    for (const malformed of [
      changes, [], null, { ...body, email: changes.email },
      { ...body, iv: 'a' }, { ...body, ciphertext: '%not-base64' },
      { ...body, ciphertext: 'A'.repeat(175000) }, { ...body, grant: 5 },
    ]) {
      assert.deepEqual(editWithBackend({ operation: 'decrypt', body: malformed }), {
        error: 'invalid_encrypted_request', status: 400,
      })
    }
  })
})

test('unlinked accounts keep null participant revisions in the edit grant', async () => {
  const details = { account: editPayload.account, participant: null }
  details._edit = editWithBackend({ operation: 'create', payload: details })
  await saveEncryptedAccountDetails(username, details, changes, async (_, { body }) => {
    assert.deepEqual(editWithBackend({ operation: 'decrypt', body }), {
      changes,
      revision: { account_updated_at: editPayload.account.updated_at, participant_id: null, participant_updated_at: null },
    })
  })
})

test('invalid edit metadata, oversized changes and a closed drawer never send updates', async () => {
  const details = newEditDetails()
  const mustNotRequest = () => assert.fail('must not send an invalid or cancelled update')
  for (const invalid of [undefined, {}, { ...details, _edit: {} }, { ...details, account: { id: 0 } }]) {
    await assert.rejects(saveEncryptedAccountDetails(username, invalid, changes, mustNotRequest), /edit_session_invalid/)
  }
  for (const invalid of [null, [], { notes: 'a'.repeat(128 * 1024) }]) {
    await assert.rejects(saveEncryptedAccountDetails(username, details, invalid, mustNotRequest), /invalid_encrypted_request/)
  }
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(saveEncryptedAccountDetails(username, details, changes, mustNotRequest, {
    signal: controller.signal,
  }), { name: 'AbortError' })
  const duringSave = new AbortController()
  await assert.rejects(saveEncryptedAccountDetails(username, details, changes, async () => {
    duringSave.abort()
    return { ok: true }
  }, { signal: duringSave.signal }), { name: 'AbortError' })
})
