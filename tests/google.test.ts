import { describe, expect, it } from 'vitest'
import { createGoogleAuth, GOOGLE_SCOPES } from '../src/lib/auth/google'

const google = createGoogleAuth({
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'https://peterjur.co/api/auth/callback',
})

describe('Google authorize URL', () => {
  const url = google.createAuthorizationUrl('test-state', 'test-code-verifier')

  it('points at Google with the client id, redirect URI, and PKCE', () => {
    expect(url.origin + url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    )
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://peterjur.co/api/auth/callback',
    )
    expect(url.searchParams.get('state')).toBe('test-state')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
  })

  it('requests ONLY identity scopes — no Drive/Photos/content access', () => {
    const scopes = (url.searchParams.get('scope') ?? '').split(/\s+/).sort()
    // Exact match: openid + email + profile and nothing else.
    expect(scopes).toEqual(['email', 'openid', 'profile'])
    expect(GOOGLE_SCOPES).toEqual(['openid', 'email', 'profile'])

    // Belt and braces: no Google content scope ever sneaks in.
    const raw = url.searchParams.get('scope') ?? ''
    for (const forbidden of ['drive', 'photos', 'gmail', 'calendar']) {
      expect(raw.toLowerCase()).not.toContain(forbidden)
    }
  })
})
