import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '../../src/db/schema'

export const DEFAULT_TEST_DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5544/peterjurco_test'

/**
 * Drizzle client over the node-postgres driver for tests.
 *
 * Production uses the Neon serverless HTTP driver (`src/db/client.ts`), which
 * cannot talk to a plain local Postgres — so tests build their own client over
 * TCP against the SAME schema, keeping the tests real-DB (never mocked SQL).
 */
export function createTestDb() {
  const pool = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL,
  })
  const db = drizzle(pool, { schema })
  return { db, close: () => pool.end() }
}

export type TestDb = ReturnType<typeof createTestDb>['db']
