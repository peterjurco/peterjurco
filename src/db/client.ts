import { neon, neonConfig } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

/**
 * Builds a Drizzle client over the Neon serverless HTTP driver
 * (Workers-compatible — no raw TCP).
 *
 * The database URL is always passed by the caller (in Astro routes:
 * `Astro.locals.runtime.env.DATABASE_URL`) — never read at module level,
 * so no secret is baked in at build time.
 */
export function getDb(databaseUrl: string) {
  // Local dev / CI only: the Neon HTTP driver cannot talk to plain Postgres,
  // so a local Neon HTTP proxy (ghcr.io/timowilhelm/local-neon-http-proxy)
  // serves the Neon wire-over-HTTP protocol at db.localtest.me:4444
  // (db.localtest.me resolves to 127.0.0.1). Production Neon URLs are
  // unaffected.
  if (databaseUrl.includes('db.localtest.me')) {
    neonConfig.fetchEndpoint = 'http://db.localtest.me:4444/sql'
  }
  return drizzle(neon(databaseUrl), { schema })
}

export type Db = ReturnType<typeof getDb>
