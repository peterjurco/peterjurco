import { env } from 'cloudflare:workers'
import type { APIRoute } from 'astro'
import { getDb } from '../../../db'
import { SESSION_COOKIE_NAME, verifyValue } from '../../../lib/auth/cookie'
import { revokeSession } from '../../../lib/auth/session'

/** Revokes the session server-side, clears the cookie, and returns home. */
export const GET: APIRoute = async ({ cookies, redirect }) => {
  const signed = cookies.get(SESSION_COOKIE_NAME)?.value
  if (signed) {
    const token = await verifyValue(env.SESSION_SECRET, signed)
    if (token) {
      await revokeSession(getDb(env.DATABASE_URL), token)
    }
  }
  cookies.delete(SESSION_COOKIE_NAME, { path: '/' })
  return redirect('/', 302)
}
