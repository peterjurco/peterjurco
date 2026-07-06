import type { AstroCookieSetOptions } from 'astro'

export const SESSION_COOKIE_NAME = 'session'
/** ~5 years — "stay signed in indefinitely on this device". */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 5 * 365 * 24 * 60 * 60

/** Transient cookies carrying OAuth state/PKCE verifier across the redirect. */
export const OAUTH_STATE_COOKIE_NAME = 'oauth_state'
export const OAUTH_VERIFIER_COOKIE_NAME = 'oauth_verifier'
export const OAUTH_COOKIE_MAX_AGE_SECONDS = 10 * 60

const encoder = new TextEncoder()

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function base64UrlToBytes(encoded: string): Uint8Array | null {
  const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/')
  try {
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  } catch {
    return null
  }
}

/**
 * HMAC-SHA256-signs a cookie value (Web Crypto): `value` → `value.signature`
 * with a base64url signature.
 */
export async function signValue(
  secret: string,
  value: string,
): Promise<string> {
  const key = await importHmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return `${value}.${bytesToBase64Url(new Uint8Array(signature))}`
}

/**
 * Returns the embedded value when the signature checks out, null for
 * tampered or malformed input. Comparison is constant-time
 * (crypto.subtle.verify).
 */
export async function verifyValue(
  secret: string,
  signed: string,
): Promise<string | null> {
  const separator = signed.lastIndexOf('.')
  if (separator === -1) return null
  const value = signed.slice(0, separator)
  const signature = base64UrlToBytes(signed.slice(separator + 1))
  if (signature === null) return null

  const key = await importHmacKey(secret)
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    signature as Uint8Array<ArrayBuffer>,
    encoder.encode(value),
  )
  return valid ? value : null
}

/**
 * Attributes for auth cookies: HttpOnly, Secure, SameSite=Lax, Path=/.
 * Defaults to the ~5-year session lifetime; pass a short maxAge for
 * transient cookies (OAuth state).
 */
export function sessionCookieOptions(
  maxAgeSeconds: number = SESSION_COOKIE_MAX_AGE_SECONDS,
): AstroCookieSetOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  }
}
