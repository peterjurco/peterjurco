import { defineMiddleware } from 'astro:middleware'
import { env } from 'cloudflare:workers'
import { getDb } from './db'
import { readSessionToken, SESSION_COOKIE_NAME } from './lib/auth/cookie'
import { validateSession } from './lib/auth/session'
import { requireEnv } from './lib/env'

/**
 * Resolves the session cookie into `Astro.locals.user` on every request and
 * gates the authenticated area: unauthenticated `/app/*` → 302 to login.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.user = null

  // The env vars are only required once there is a session cookie to verify —
  // requests without one must never 500 over auth configuration.
  if (context.cookies.has(SESSION_COOKIE_NAME)) {
    const token = await readSessionToken(
      context.cookies,
      requireEnv(env.SESSION_SECRET, 'SESSION_SECRET'),
    )
    if (token) {
      const db = getDb(requireEnv(env.DATABASE_URL, 'DATABASE_URL'))
      try {
        context.locals.user = await validateSession(db, token)
      } catch (error) {
        // A DB outage must not take public pages down with a 500: log it and
        // treat the request as logged out — /app/* then falls through to the
        // login redirect below.
        console.error('Session validation failed:', error)
        context.locals.user = null
      }
    }
  }

  const isAppRoute =
    context.url.pathname === '/app' || context.url.pathname.startsWith('/app/')
  if (isAppRoute && context.locals.user === null) {
    return context.redirect('/api/auth/login', 302)
  }

  return next()
})
