import { execSync } from 'node:child_process'
import { DEFAULT_TEST_DATABASE_URL } from './test-db'

/**
 * Applies the checked-in drizzle migrations to the test database
 * (a disposable Neon branch in CI, or local Postgres) before the suite runs.
 */
export default function setup(): void {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL
  process.env.TEST_DATABASE_URL = databaseUrl
  execSync('pnpm drizzle-kit migrate', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  })
}
