import { neon } from '@neondatabase/serverless'
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
  return drizzle(neon(databaseUrl), { schema })
}

export type Db = ReturnType<typeof getDb>
