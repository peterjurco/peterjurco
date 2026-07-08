import { describe, expect, it } from 'vitest'
import { BEACON_SRC, beaconAttrs } from '../src/lib/analytics'

/**
 * The beacon conditional (TECH_DECISIONS §7): Cloudflare Web Analytics ships
 * only in production builds with a configured token — dev servers and
 * token-less builds render no analytics script at all. The e2e suites assert
 * the dev-HTML absence end to end (tests/ops.e2e.test.ts).
 */
describe('beaconAttrs', () => {
  it('returns the script attributes in prod with a token', () => {
    const attrs = beaconAttrs('abc123', true)
    expect(attrs).not.toBeNull()
    expect(attrs?.src).toBe(BEACON_SRC)
    expect(attrs?.src).toContain('cloudflareinsights.com')
    // data-cf-beacon carries the token as the JSON payload Cloudflare expects.
    expect(JSON.parse(attrs?.dataCfBeacon ?? '')).toEqual({ token: 'abc123' })
  })

  it('returns null outside production even when a token is set', () => {
    expect(beaconAttrs('abc123', false)).toBeNull()
  })

  it('returns null in production without a token', () => {
    expect(beaconAttrs(undefined, true)).toBeNull()
    expect(beaconAttrs('', true)).toBeNull()
    expect(beaconAttrs('   ', true)).toBeNull()
  })

  it('trims the token before embedding it', () => {
    const attrs = beaconAttrs('  tok  ', true)
    expect(JSON.parse(attrs?.dataCfBeacon ?? '')).toEqual({ token: 'tok' })
  })
})
