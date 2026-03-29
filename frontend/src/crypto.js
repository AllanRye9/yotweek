/**
 * E2E Encryption utilities using Web Crypto API (ECDH + AES-GCM).
 *
 * Key lifecycle:
 *  1. generateKeyPair()  – on first login / registration, creates ECDH key pair.
 *  2. exportPublicKey()  – export public key as JWK string to send to server.
 *  3. Private key stored in localStorage (as JWK) – never sent to server.
 *  4. getSharedSecret()  – derives AES-GCM key from own private key + peer public key.
 *  5. encryptMessage()   – encrypts plaintext with shared secret → base64 ciphertext.
 *  6. decryptMessage()   – decrypts ciphertext → plaintext.
 */

const PRIVATE_KEY_STORAGE = 'e2e_private_key'
const PUBLIC_KEY_STORAGE  = 'e2e_public_key'

// ── Key generation & persistence ─────────────────────────────────────────────

/**
 * Generate a new ECDH P-256 key pair, persist the private key in localStorage
 * and return { publicKeyJwk, privateKeyJwk }.
 */
export async function generateKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey'],
  )
  const publicKeyJwk  = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey)

  localStorage.setItem(PRIVATE_KEY_STORAGE, JSON.stringify(privateKeyJwk))
  localStorage.setItem(PUBLIC_KEY_STORAGE,  JSON.stringify(publicKeyJwk))

  return { publicKeyJwk, privateKeyJwk }
}

/**
 * Return the stored public-key JWK string, or null if not yet generated.
 */
export function getStoredPublicKeyJwk() {
  return localStorage.getItem(PUBLIC_KEY_STORAGE)
}

/**
 * Return the stored private-key JWK object, or null.
 */
function _getStoredPrivateKeyJwk() {
  const raw = localStorage.getItem(PRIVATE_KEY_STORAGE)
  return raw ? JSON.parse(raw) : null
}

/**
 * Import a JWK public-key string back into a CryptoKey.
 */
async function _importPublicKey(jwkString) {
  const jwk = typeof jwkString === 'string' ? JSON.parse(jwkString) : jwkString
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
}

// ── Shared secret derivation ──────────────────────────────────────────────────

/**
 * Derive a shared AES-GCM key from own private key + peer's public-key JWK string.
 * Returns a CryptoKey usable for encrypt/decrypt.
 */
export async function getSharedSecret(peerPublicKeyJwk) {
  const privateJwk = _getStoredPrivateKeyJwk()
  if (!privateJwk) throw new Error('No local private key found. Call generateKeyPair() first.')

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey'],
  )
  const peerPublicKey = await _importPublicKey(peerPublicKeyJwk)

  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// ── Encrypt / Decrypt ─────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string.
 * Returns a base64-encoded string: <12-byte IV (base64)>:<ciphertext (base64)>
 */
export async function encryptMessage(sharedKey, plaintext) {
  const iv          = crypto.getRandomValues(new Uint8Array(12))
  const encoded     = new TextEncoder().encode(plaintext)
  const cipherBuf   = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, encoded)
  const ivB64       = _bufToBase64(iv)
  const cipherB64   = _bufToBase64(new Uint8Array(cipherBuf))
  return `${ivB64}:${cipherB64}`
}

/**
 * Decrypt a ciphertext produced by encryptMessage().
 * Returns the original plaintext string.
 */
export async function decryptMessage(sharedKey, ciphertext) {
  const [ivB64, cipherB64] = ciphertext.split(':')
  if (!ivB64 || !cipherB64) throw new Error('Invalid ciphertext format')
  const iv        = _base64ToBuf(ivB64)
  const cipherBuf = _base64ToBuf(cipherB64)
  const plainBuf  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sharedKey, cipherBuf)
  return new TextDecoder().decode(plainBuf)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _bufToBase64(buf) {
  return btoa(String.fromCharCode(...buf))
}

function _base64ToBuf(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

/**
 * True if the stored ciphertext looks like an E2E-encrypted payload.
 */
export function isEncryptedPayload(content) {
  if (typeof content !== 'string') return false
  // Format: <base64>:<base64>
  const parts = content.split(':')
  return parts.length === 2 && parts[0].length >= 16 && parts[1].length >= 16
}
