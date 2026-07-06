import { type ChildProcess, spawn } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'

const ROOT_DIR = new URL('../..', import.meta.url).pathname
const DEV_VARS_PATH = new URL('../../.dev.vars', import.meta.url).pathname
const DEV_VARS_BACKUP_PATH = new URL(
  '../../.dev.vars.test-backup',
  import.meta.url,
).pathname
const DEV_LOCK_FILE_PATH = new URL('../../.astro/dev.json', import.meta.url)
  .pathname

export interface DevServerHandle {
  baseUrl: string
  /** Stops the server, restores `.dev.vars`, removes our lock file. Idempotent. */
  stop: () => void
}

interface StartDevServerOptions {
  /** Dedicated port — unique per test file so runs never collide. */
  port: number
  /** Contents written to `.dev.vars` (the Cloudflare runtime env). */
  vars: Record<string, string>
  /** Path polled until the server responds (default `/`). */
  readyPath?: string
  timeoutMs?: number
}

/**
 * Boots a real `astro dev` server for integration tests.
 *
 * The dev server reads its runtime env from `.dev.vars`, so any existing
 * developer `.dev.vars` is backed up to disk first and restored on stop /
 * process exit — it survives even a hard crash. A leftover backup means a
 * previous run was SIGKILLed before restoring — `.dev.vars` then holds test
 * content, so the stale backup is the real file and is NOT overwritten.
 *
 * NOTE: `.dev.vars` is a single shared file — vitest.config.ts disables file
 * parallelism so two dev-server tests never race over it.
 */
export async function startDevServer(
  options: StartDevServerOptions,
): Promise<DevServerHandle> {
  const { port, vars, readyPath = '/', timeoutMs = 90_000 } = options
  const baseUrl = `http://localhost:${port}`
  let devServer: ChildProcess | undefined
  let devVarsOverwritten = false

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
   * Stops ONLY the dev server this helper spawned (never unrelated dev
   * servers). The server runs in its own process group (`detached: true`),
   * so killing the negative PID takes down the whole tree
   * (pnpm → astro → workerd).
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
   * server this helper started (matched by the dedicated port) — never a
   * lock owned by an unrelated dev server.
   */
  function removeOwnDevLockFile(): void {
    try {
      const lock = JSON.parse(readFileSync(DEV_LOCK_FILE_PATH, 'utf8')) as {
        port?: number
      }
      if (lock.port === port) unlinkSync(DEV_LOCK_FILE_PATH)
    } catch {
      // Missing or unreadable lock file — nothing to clean up.
    }
  }

  function stop(): void {
    // Unhook ourselves so repeated startDevServer calls in one process don't
    // stack dead exit handlers.
    process.off('exit', stop)
    stopDevServer()
    removeOwnDevLockFile()
    restoreDevVars()
  }

  async function waitForServer(url: string): Promise<void> {
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

  if (existsSync(DEV_VARS_PATH) && !existsSync(DEV_VARS_BACKUP_PATH)) {
    copyFileSync(DEV_VARS_PATH, DEV_VARS_BACKUP_PATH)
  }
  devVarsOverwritten = true
  const varLines = Object.entries(vars)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('')
  writeFileSync(DEV_VARS_PATH, varLines)
  process.on('exit', stop)

  devServer = spawn('pnpm', ['astro', 'dev', '--port', String(port)], {
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

  try {
    await waitForServer(`${baseUrl}${readyPath}`)
  } catch (error) {
    stop()
    throw error
  }

  return { baseUrl, stop }
}
