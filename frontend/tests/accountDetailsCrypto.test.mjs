import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { fetchEncryptedAccountDetails } from '../src/accountDetailsCrypto.js'

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
