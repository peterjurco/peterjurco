import { describe, expect, it } from 'vitest'
import {
  SESSION_COOKIE_MAX_AGE_SECONDS,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  signValue,
  verifyValue,
} from '../src/lib/auth/cookie'

const SECRET = 'test-secret-at-least-32-chars-long!!'

describe('signValue / verifyValue', () => {
  it('round-trips a value as value.signature', async () => {
    const signed = await signValue(SECRET, 'some-token')
    expect(signed.startsWith('some-token.')).toBe(true)
    expect(signed.split('.')).toHaveLength(2)

    expect(await verifyValue(SECRET, signed)).toBe('some-token')
  })

  it('produces a deterministic signature for the same secret and value', async () => {
    expect(await signValue(SECRET, 'v')).toBe(await signValue(SECRET, 'v'))
  })

  it('rejects a tampered value', async () => {
    const signed = await signValue(SECRET, 'some-token')
    const [, signature] = signed.split('.')
    expect(await verifyValue(SECRET, `other-token.${signature}`)).toBeNull()
  })

  it('rejects a tampered signature', async () => {
    const signed = await signValue(SECRET, 'some-token')
    const tampered = signed.slice(0, -2) + (signed.endsWith('A') ? 'BB' : 'AA')
    expect(await verifyValue(SECRET, tampered)).toBeNull()
  })

  it('rejects a signature minted with a different secret', async () => {
    const signed = await signValue('another-secret-also-32-chars-long!!!', 'v')
    expect(await verifyValue(SECRET, signed)).toBeNull()
  })

  it('rejects malformed input (no signature separator)', async () => {
    expect(await verifyValue(SECRET, 'garbage-without-a-dot')).toBeNull()
    expect(await verifyValue(SECRET, '')).toBeNull()
  })
})

describe('session cookie attributes', () => {
  it('is HttpOnly, Secure, SameSite=Lax, Path=/ with a ~5-year Max-Age', () => {
    const options = sessionCookieOptions()
    expect(options.httpOnly).toBe(true)
    expect(options.secure).toBe(true)
    expect(options.sameSite).toBe('lax')
    expect(options.path).toBe('/')
    expect(options.maxAge).toBe(SESSION_COOKIE_MAX_AGE_SECONDS)
    expect(SESSION_COOKIE_MAX_AGE_SECONDS).toBe(5 * 365 * 24 * 60 * 60)
  })

  it('supports a custom max-age (short-lived OAuth state cookies)', () => {
    expect(sessionCookieOptions(600).maxAge).toBe(600)
  })

  it('exposes a stable cookie name', () => {
    expect(SESSION_COOKIE_NAME).toBe('session')
  })
})
