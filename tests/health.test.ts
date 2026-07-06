import { type ChildProcess, spawn } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_DEV_DATABASE_URL } from './helpers/test-db'

const PORT = 43110
const HEALTH_URL = `http://localhost:${PORT}/api/health`
const ROOT_DIR = new URL('..', import.meta.url).pathname
const DEV_VARS_PATH = new URL('../.dev.vars', import.meta.url).pathname
const DEV_VARS_BACKUP_PATH = new URL(
  '../.dev.vars.test-backup',
  import.meta.url,
).pathname
const DEV_LOCK_FILE_PATH = new URL('../.astro/dev.json', import.meta.url)
  .pathname

let devServer: ChildProcess | undefined
let devVarsOverwritten = false

/**
 * Restores `.dev.vars` from the on-disk backup (and removes the backup).
 * Idempotent — runs in afterAll and again on process exit, so a crashed or
 * killed test run still leaves the developer's `.dev.vars` intact.
 */
function restoreDevVars(): void {
  if (!devVarsOverwritten) return
  devVarsOverwritten = false
  if (existsSync(DEV_VARS_BACKUP_PATH)) {
    copyFileSync(DEV_VARS_BACKUP_PATH, DEV_VARS_PATH)
    unlinkSync(DEV_VARS_BACKUP_PATH)
  } else if (existsSync(DEV_VARS_PATH)) {
    // No backup — `.dev.vars` did not exist before the test wrote it.
    unlinkSync(DEV_VARS_PATH)
  }
}

/**
 * Stops ONLY the dev server this test spawned (never unrelated dev servers).
 * The server runs in its own process group (`detached: true`), so killing the
 * negative PID takes down the whole tree (pnpm → astro → workerd).
 */
function stopDevServer(): void {
  const pid = devServer?.pid
  devServer = undefined
  if (pid === undefined) return
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    // Already exited — fine.
  }
}

/**
 * Removes Astro's dev-server lock file, but only when it belongs to the
 * server this test started (matched by the dedicated test port) — never a
 * lock owned by an unrelated dev server.
 */
function removeOwnDevLockFile(): void {
  try {
    const lock = JSON.parse(readFileSync(DEV_LOCK_FILE_PATH, 'utf8')) as {
      port?: number
    }
    if (lock.port === PORT) unlinkSync(DEV_LOCK_FILE_PATH)
  } catch {
    // Missing or unreadable lock file — nothing to clean up.
  }
}

function cleanup(): void {
  stopDevServer()
  removeOwnDevLockFile()
  restoreDevVars()
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (devServer?.exitCode != null) {
      throw new Error(
        `Dev server exited early (code ${devServer.exitCode}) — is another ` +
          'dev server already running for this project?',
      )
    }
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
  // Point it at the Neon-HTTP-proxied test database, backing up any existing
  // developer .dev.vars to disk first so it survives even a hard crash.
  if (existsSync(DEV_VARS_PATH)) {
    copyFileSync(DEV_VARS_PATH, DEV_VARS_BACKUP_PATH)
  }
  devVarsOverwritten = true
  const databaseUrl =
    process.env.HEALTH_TEST_DATABASE_URL ?? DEFAULT_DEV_DATABASE_URL
  writeFileSync(DEV_VARS_PATH, `DATABASE_URL=${databaseUrl}\n`)
  process.on('exit', cleanup)

  devServer = spawn('pnpm', ['astro', 'dev', '--port', String(PORT)], {
    cwd: ROOT_DIR,
    stdio: 'ignore',
    detached: true,
    env: {
      ...process.env,
      // Astro 7 auto-daemonizes `astro dev` when it detects an agentic
      // environment, re-parenting the server to PID 1 and escaping our
      // process group. This env var (set by Astro's own daemon child)
      // disables that detection, keeping the server foreground in OUR
      // process group so cleanup kills exactly the server we started.
      ASTRO_DEV_BACKGROUND: '1',
    },
  })
  await waitForServer(HEALTH_URL, 90_000)
}, 120_000)

afterAll(() => {
  cleanup()
})

describe('/api/health (running dev server)', () => {
  it('returns 200 { ok: true, db: "up" } when the DB is reachable', async () => {
    const response = await fetch(HEALTH_URL)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, db: 'up' })
  }, 30_000)
})
