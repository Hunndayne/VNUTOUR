// Per-request Web Crypto keys live only in memory. There is no plaintext fallback.
const TYPE = 'vnutour-account-details+jwe'

function checkAborted(signal) {
  if (signal?.aborted) throw new DOMException('The request was aborted', 'AbortError')
}

function decodeBase64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid_encrypted_response')
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))
}

export async function fetchEncryptedAccountDetails(username, request, { signal } = {}) {
  if (!globalThis.crypto?.subtle) throw new Error('secure_browser_required')
  const keys = await crypto.subtle.generateKey({
    name: 'RSA-OAEP', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
  }, false, ['wrapKey', 'unwrapKey'])
  checkAborted(signal)
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey))
  const envelope = await request(`/admin/accounts/${encodeURIComponent(username)}/details`, {
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
        || header.typ !== TYPE || header.account !== username || header.crit) throw new Error()
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
