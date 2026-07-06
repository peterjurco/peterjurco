import { CodeChallengeMethod, decodeIdToken, OAuth2Client } from 'arctic'

export const GOOGLE_AUTHORIZATION_ENDPOINT =
  'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

/**
 * Identity-only scopes (TECH_DECISIONS §6): Google is used purely for
 * sign-in. Never add Drive/Photos/content scopes.
 */
export const GOOGLE_SCOPES = ['openid', 'email', 'profile']

export interface GoogleAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  /**
   * Test-only override (AUTH_TOKEN_ENDPOINT env var) pointing the code
   * exchange at a stub server. Unset in production → real Google endpoint.
   */
  tokenEndpoint?: string
}

/** OpenID Connect claims we consume from Google's ID token. */
export interface GoogleIdentity {
  sub: string
  email: string
  name: string
  avatarUrl: string | null
}

/**
 * Google OAuth2 (authorization-code + PKCE) via Arctic's OAuth2Client — the
 * same client Arctic's own Google provider wraps, with the token endpoint
 * injectable for tests.
 */
export function createGoogleAuth(config: GoogleAuthConfig) {
  const client = new OAuth2Client(
    config.clientId,
    config.clientSecret,
    config.redirectUri,
  )
  const tokenEndpoint = config.tokenEndpoint ?? GOOGLE_TOKEN_ENDPOINT

  return {
    createAuthorizationUrl(state: string, codeVerifier: string): URL {
      return client.createAuthorizationURLWithPKCE(
        GOOGLE_AUTHORIZATION_ENDPOINT,
        state,
        CodeChallengeMethod.S256,
        codeVerifier,
        GOOGLE_SCOPES,
      )
    },

    /** Exchanges the authorization code and decodes the ID token's claims. */
    async exchangeCode(
      code: string,
      codeVerifier: string,
    ): Promise<GoogleIdentity> {
      const tokens = await client.validateAuthorizationCode(
        tokenEndpoint,
        code,
        codeVerifier,
      )
      const claims = decodeIdToken(tokens.idToken()) as {
        sub?: unknown
        email?: unknown
        name?: unknown
        picture?: unknown
      }
      if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') {
        throw new Error('ID token is missing required claims (sub, email)')
      }
      return {
        sub: claims.sub,
        email: claims.email,
        name: typeof claims.name === 'string' ? claims.name : claims.email,
        avatarUrl: typeof claims.picture === 'string' ? claims.picture : null,
      }
    },
  }
}

export type GoogleAuth = ReturnType<typeof createGoogleAuth>
