import { env } from 'cloudflare:workers'
import type { APIRoute } from 'astro'
import { getAppDb } from '../../../db'
import { readSessionToken, SESSION_COOKIE_NAME } from '../../../lib/auth/cookie'
import { revokeSession } from '../../../lib/auth/session'
import { requireEnv } from '../../../lib/env'

/**
 * Revokes the session server-side, clears the cookie, and returns home.
 * POST only — logout mutates state, and a GET would be triggerable by a
 * simple cross-site link or prefetch.
 */
export const POST: APIRoute = async ({ cookies, redirect }) => {
  const token = await readSessionToken(
    cookies,
    requireEnv(env.SESSION_SECRET, 'SESSION_SECRET'),
  )
  if (token) {
    await revokeSession(getAppDb(), token)
  }
  cookies.delete(SESSION_COOKIE_NAME, { path: '/' })
  return redirect('/', 302)
}
