import { env } from 'cloudflare:workers'
import { requireEnv } from '../lib/env'
import { getDb } from './client'

export * from './client'
export * from './schema'

/**
 * The app database, bound to the Worker's `DATABASE_URL` — the one-liner every
 * page, API handler and middleware uses. Throws loudly when the binding is
 * missing (see requireEnv).
 */
export function getAppDb() {
  return getDb(requireEnv(env.DATABASE_URL, 'DATABASE_URL'))
}
