import { neon, neonConfig } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import {
  LOCAL_NEON_PROXY_FETCH_ENDPOINT,
  LOCAL_NEON_PROXY_HOST,
} from './local-proxy'
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
  // Local dev / CI only — route through the local Neon HTTP proxy (see
  // src/db/local-proxy.ts). Production Neon URLs are unaffected.
  if (databaseUrl.includes(LOCAL_NEON_PROXY_HOST)) {
    neonConfig.fetchEndpoint = LOCAL_NEON_PROXY_FETCH_ENDPOINT
  }
  return drizzle(neon(databaseUrl), { schema })
}

export type Db = ReturnType<typeof getDb>
