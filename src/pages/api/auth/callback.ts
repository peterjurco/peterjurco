import { env } from 'cloudflare:workers'
import type { APIRoute } from 'astro'
import { getDb } from '../../../db'
import { users } from '../../../db/schema'
import { isAllowed } from '../../../lib/auth/allowlist'
import {
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_VERIFIER_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  signValue,
  verifyValue,
} from '../../../lib/auth/cookie'
import { createGoogleAuth } from '../../../lib/auth/google'
import { createSession } from '../../../lib/auth/session'

/**
 * Google OAuth callback: state check → code exchange → allow-list check →
 * user upsert → session mint → signed session cookie → /app.
 */
export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const signedState = cookies.get(OAUTH_STATE_COOKIE_NAME)?.value
  const signedVerifier = cookies.get(OAUTH_VERIFIER_COOKIE_NAME)?.value

  // The transient OAuth cookies are single-use — drop them either way.
  cookies.delete(OAUTH_STATE_COOKIE_NAME, { path: '/' })
  cookies.delete(OAUTH_VERIFIER_COOKIE_NAME, { path: '/' })

  const storedState = signedState
    ? await verifyValue(env.SESSION_SECRET, signedState)
    : null
  const codeVerifier = signedVerifier
    ? await verifyValue(env.SESSION_SECRET, signedVerifier)
    : null
  if (!code || !state || !storedState || !codeVerifier) {
    return new Response('Missing or invalid OAuth state', { status: 400 })
  }
  if (state !== storedState) {
    return new Response('OAuth state mismatch', { status: 400 })
  }

  const google = createGoogleAuth({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
    // Test-only stub override; undefined in production → real Google.
    tokenEndpoint: env.AUTH_TOKEN_ENDPOINT,
  })

  let identity: Awaited<ReturnType<typeof google.exchangeCode>>
  try {
    identity = await google.exchangeCode(code, codeVerifier)
  } catch (error) {
    console.error('OAuth code exchange failed:', error)
    return new Response('Authorization code exchange failed', { status: 400 })
  }

  if (!isAllowed(identity.email, env.AUTH_ALLOWED_EMAILS)) {
    return new Response('Forbidden: this Google account is not allowed', {
      status: 403,
    })
  }

  const db = getDb(env.DATABASE_URL)
  const [user] = await db
    .insert(users)
    .values({
      googleSub: identity.sub,
      email: identity.email,
      name: identity.name,
      avatarUrl: identity.avatarUrl,
    })
    .onConflictDoUpdate({
      target: users.googleSub,
      set: {
        email: identity.email,
        name: identity.name,
        avatarUrl: identity.avatarUrl,
      },
    })
    .returning()
  if (!user) {
    return new Response('Failed to upsert user', { status: 500 })
  }

  const { token } = await createSession(db, user.id)
  cookies.set(
    SESSION_COOKIE_NAME,
    await signValue(env.SESSION_SECRET, token),
    sessionCookieOptions(),
  )

  return redirect('/app', 302)
}
