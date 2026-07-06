import { execSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_DEV_DATABASE_URL } from './helpers/test-db'

const PORT = 43110
const HEALTH_URL = `http://localhost:${PORT}/api/health`
const DEV_VARS_PATH = new URL('../.dev.vars', import.meta.url).pathname

let previousDevVars: string | null = null

function stopDevServer(): void {
  try {
    execSync('pnpm astro dev stop', { stdio: 'ignore' })
  } catch {
    // No dev server running — fine.
  }
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(url)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new Error(`Dev server did not become reachable at ${url}`)
}

beforeAll(async () => {
  // The dev server reads DATABASE_URL from .dev.vars (Cloudflare runtime env).
  // Point it at the Neon-HTTP-proxied test database, preserving any existing
  // developer .dev.vars for restoration afterwards.
  previousDevVars = existsSync(DEV_VARS_PATH)
    ? readFileSync(DEV_VARS_PATH, 'utf8')
    : null
  const databaseUrl =
    process.env.HEALTH_TEST_DATABASE_URL ?? DEFAULT_DEV_DATABASE_URL
  writeFileSync(DEV_VARS_PATH, `DATABASE_URL=${databaseUrl}\n`)

  stopDevServer()
  execSync(`pnpm astro dev --background --port ${PORT}`, { stdio: 'ignore' })
  await waitForServer(HEALTH_URL, 90_000)
}, 120_000)

afterAll(() => {
  stopDevServer()
  if (previousDevVars === null) {
    unlinkSync(DEV_VARS_PATH)
  } else {
    writeFileSync(DEV_VARS_PATH, previousDevVars)
  }
})

describe('/api/health (running dev server)', () => {
  it('returns 200 { ok: true, db: "up" } when the DB is reachable', async () => {
    const response = await fetch(HEALTH_URL)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, db: 'up' })
  }, 30_000)
})
