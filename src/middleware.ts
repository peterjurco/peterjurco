import { env } from 'cloudflare:workers'
import { defineMiddleware } from 'astro:middleware'
import { getDb } from './db'
import { SESSION_COOKIE_NAME, verifyValue } from './lib/auth/cookie'
import { validateSession } from './lib/auth/session'

/**
 * Resolves the session cookie into `Astro.locals.user` on every request and
 * gates the authenticated area: unauthenticated `/app/*` → 302 to login.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.user = null

  const signed = context.cookies.get(SESSION_COOKIE_NAME)?.value
  if (signed) {
    const token = await verifyValue(env.SESSION_SECRET, signed)
    if (token) {
      context.locals.user = await validateSession(
        getDb(env.DATABASE_URL),
        token,
      )
    }
  }

  const isAppRoute =
    context.url.pathname === '/app' || context.url.pathname.startsWith('/app/')
  if (isAppRoute && context.locals.user === null) {
    return context.redirect('/api/auth/login', 302)
  }

  return next()
})
