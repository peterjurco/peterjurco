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
import { createGoogleAuth } from '../../../lib/auth/google'

/**
 * Starts the Google sign-in: stores the OAuth state + PKCE verifier in
 * short-lived signed cookies and redirects to Google's consent screen.
 */
export const GET: APIRoute = async ({ cookies, redirect }) => {
  const state = generateState()
  const codeVerifier = generateCodeVerifier()

  const google = createGoogleAuth({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  })
  const authorizationUrl = google.createAuthorizationUrl(state, codeVerifier)

  const options = sessionCookieOptions(OAUTH_COOKIE_MAX_AGE_SECONDS)
  cookies.set(
    OAUTH_STATE_COOKIE_NAME,
    await signValue(env.SESSION_SECRET, state),
    options,
  )
  cookies.set(
    OAUTH_VERIFIER_COOKIE_NAME,
    await signValue(env.SESSION_SECRET, codeVerifier),
    options,
  )

  return redirect(authorizationUrl.toString(), 302)
}
