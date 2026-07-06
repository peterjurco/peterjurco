import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type DevServerHandle, startDevServer } from './helpers/dev-server'
import { DEFAULT_DEV_DATABASE_URL } from './helpers/test-db'

const PORT = 43110

let server: DevServerHandle | undefined

beforeAll(async () => {
  // The dev server reads DATABASE_URL from .dev.vars (Cloudflare runtime
  // env); point it at the Neon-HTTP-proxied test database.
  server = await startDevServer({
    port: PORT,
    vars: {
      DATABASE_URL:
        process.env.HEALTH_TEST_DATABASE_URL ?? DEFAULT_DEV_DATABASE_URL,
    },
    readyPath: '/api/health',
  })
}, 120_000)

afterAll(() => {
  server?.stop()
})

describe('/api/health (running dev server)', () => {
  it('returns 200 { ok: true, db: "up" } when the DB is reachable', async () => {
    const response = await fetch(`http://localhost:${PORT}/api/health`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, db: 'up' })
  }, 30_000)
})
