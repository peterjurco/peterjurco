import { env } from 'cloudflare:workers'
import { generateCodeVerifier, generateState } from 'arctic'
import type { APIRoute } from 'astro'
import {
  OAUTH_COOKIE_MAX_AGE_SECONDS,
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_VERIFIER_COOKIE_NAME,
  sessionCookieOptions,
  signValue,
} from '../../../lib/auth/cookie'
import { googleAuthFromEnv } from '../../../lib/auth/google'
import { requireEnv } from '../../../lib/env'

/**
 * Starts the Google sign-in: stores the OAuth state + PKCE verifier in
 * short-lived signed cookies and redirects to Google's consent screen.
 */
export const GET: APIRoute = async ({ cookies, redirect }) => {
  const state = generateState()
  const codeVerifier = generateCodeVerifier()

  const google = googleAuthFromEnv(env)
  const authorizationUrl = google.createAuthorizationUrl(state, codeVerifier)

  const sessionSecret = requireEnv(env.SESSION_SECRET, 'SESSION_SECRET')
  const options = sessionCookieOptions(OAUTH_COOKIE_MAX_AGE_SECONDS)
  cookies.set(
    OAUTH_STATE_COOKIE_NAME,
    await signValue(sessionSecret, state),
    options,
  )
  cookies.set(
    OAUTH_VERIFIER_COOKIE_NAME,
    await signValue(sessionSecret, codeVerifier),
    options,
  )

  return redirect(authorizationUrl.toString(), 302)
}
