// Per-request Web Crypto keys live only in memory. There is no plaintext fallback.
const TYPE = 'vnutour-account-details+jwe'

function checkAborted(signal) {
  if (signal?.aborted) throw new DOMException('The request was aborted', 'AbortError')
}

function decodeBase64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid_encrypted_response')
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))
}

async function fetchEncryptedDetails(subject, path, request, { signal } = {}) {
  if (!globalThis.crypto?.subtle) throw new Error('secure_browser_required')
  const keys = await crypto.subtle.generateKey({
    name: 'RSA-OAEP', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
  }, false, ['wrapKey', 'unwrapKey'])
  checkAborted(signal)
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey))
  const envelope = await request(path, {
    method: 'POST', cache: 'no-store', signal,
    body: { public_key: btoa(String.fromCharCode(...spki)) },
  })
  checkAborted(signal)
  try {
    if (envelope?.encrypted !== true || typeof envelope.jwe !== 'string') throw new Error()
    const parts = envelope.jwe.split('.')
    if (parts.length !== 5) throw new Error()
    const [protectedHeader, wrappedKey, iv, ciphertext, tag] = parts
    const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(protectedHeader)))
    if (header.alg !== 'RSA-OAEP-256' || header.enc !== 'A256GCM'
        || header.typ !== TYPE || header.account !== subject || header.crit) throw new Error()
    const nonce = decodeBase64Url(iv)
    const authTag = decodeBase64Url(tag)
    if (nonce.length !== 12 || authTag.length !== 16) throw new Error()
    const aesKey = await crypto.subtle.unwrapKey(
      'raw', decodeBase64Url(wrappedKey), keys.privateKey, { name: 'RSA-OAEP' },
      { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
    )
    const encrypted = decodeBase64Url(ciphertext)
    const combined = new Uint8Array(encrypted.length + authTag.length)
    combined.set(encrypted)
    combined.set(authTag, encrypted.length)
    const plaintext = await crypto.subtle.decrypt({
      name: 'AES-GCM', iv: nonce, tagLength: 128,
      additionalData: new TextEncoder().encode(protectedHeader),
    }, aesKey, combined)
    try {
      checkAborted(signal)
      return JSON.parse(new TextDecoder().decode(plaintext))
    } finally {
      new Uint8Array(plaintext).fill(0)
    }
  } catch {
    throw new Error('invalid_encrypted_response')
  }
}

export function fetchEncryptedAccountDetails(username, request, options = {}) {
  return fetchEncryptedDetails(
    username,
    `/admin/accounts/${encodeURIComponent(username)}/details`,
    request,
    options,
  )
}

export function fetchEncryptedTeamMemberDetails(mssv, request, options = {}) {
  return fetchEncryptedDetails(
    mssv,
    `/my-team/members/${encodeURIComponent(mssv)}/details`,
    request,
    options,
  )
}

function encodeBase64Url(value) {
  // Chunking avoids overflowing the argument stack for longer registration forms.
  let binary = ''
  for (let offset = 0; offset < value.length; offset += 8192) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 8192))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function saveEncryptedAccountDetails(username, details, changes, request, { signal } = {}) {
  if (!globalThis.crypto?.subtle) throw new Error('secure_browser_required')
  checkAborted(signal)
  const accountId = details?.account?.id
  const edit = details?._edit
  if (!((Number.isSafeInteger(accountId) && accountId > 0)
      || (typeof accountId === 'string' && /^[1-9]\d*$/.test(accountId)))
      || typeof edit?.key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(edit.key)
      || typeof edit?.grant !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(edit.grant)
      || edit.grant.length > 8192) {
    throw new Error('edit_session_invalid')
  }
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new Error('invalid_encrypted_request')
  }
  const rawKey = decodeBase64Url(edit.key)
  let plaintext
  let body
  try {
    if (rawKey.length !== 32) throw new Error('edit_session_invalid')
    plaintext = new TextEncoder().encode(JSON.stringify(changes))
    if (plaintext.length > 128 * 1024) throw new Error('invalid_encrypted_request')
    const aesKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt'])
    rawKey.fill(0)
    checkAborted(signal)
    const nonce = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({
      name: 'AES-GCM', iv: nonce, tagLength: 128,
      additionalData: new TextEncoder().encode(`vnutour-account-edit-v1:${accountId}`),
    }, aesKey, plaintext))
    body = { grant: edit.grant, iv: encodeBase64Url(nonce), ciphertext: encodeBase64Url(ciphertext) }
  } finally {
    rawKey.fill(0)
    plaintext?.fill(0)
  }
  checkAborted(signal)
  const result = await request(`/admin/accounts/${encodeURIComponent(username)}/details/edit`, {
    method: 'POST', cache: 'no-store', signal, body,
  })
  checkAborted(signal)
  return result
}
