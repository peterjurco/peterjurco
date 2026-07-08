import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { users } from '../src/db/schema'
import { signValue } from '../src/lib/auth/cookie'
import { createSession } from '../src/lib/auth/session'
import { type DevServerHandle, startDevServer } from './helpers/dev-server'
import { createTestDb, DEFAULT_DEV_DATABASE_URL } from './helpers/test-db'

const PORT = 43119
const BASE_URL = `http://localhost:${PORT}`
const SESSION_SECRET = 'admin-e2e-secret-32-characters!!!'

const { db, close } = createTestDb()
let server: DevServerHandle | undefined
/** Signed session cookie value for the owner — minted directly in the DB. */
let sessionCookie: string

interface RequestOptions {
  authed?: boolean
}

/** fetch against the dev server; sends Origin like a browser would. */
async function request(
  path: string,
  { authed = false }: RequestOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = { Origin: BASE_URL }
  if (authed) headers.Cookie = `session=${sessionCookie}`
  return fetch(`${BASE_URL}${path}`, { headers, redirect: 'manual' })
}

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      googleSub: `admin-e2e-${Date.now()}`,
      email: 'owner@example.com',
      name: 'Admin E2E Owner',
    })
    .returning()
  if (!user) throw new Error('failed to insert e2e user')
  const { token } = await createSession(db, user.id)
  sessionCookie = await signValue(SESSION_SECRET, token)

  server = await startDevServer({
    port: PORT,
    vars: {
      DATABASE_URL: DEFAULT_DEV_DATABASE_URL,
      SESSION_SECRET,
      GOOGLE_CLIENT_ID: 'unused',
      GOOGLE_CLIENT_SECRET: 'unused',
      GOOGLE_REDIRECT_URI: `${BASE_URL}/api/auth/callback`,
      AUTH_ALLOWED_EMAILS: 'owner@example.com',
    },
  })
}, 120_000)

afterAll(async () => {
  server?.stop()
  await close()
})

describe('admin pages — auth gating', () => {
  it('302s to login when anonymous', async () => {
    for (const path of [
      '/app/admin',
      '/app/admin/apps',
      '/app/admin/taxonomy',
    ]) {
      const response = await request(path)
      expect(response.status, path).toBe(302)
      expect(response.headers.get('location'), path).toBe('/api/auth/login')
    }
  })

  it('200s when authed', async () => {
    for (const path of [
      '/app/admin',
      '/app/admin/apps',
      '/app/admin/taxonomy',
    ]) {
      const response = await request(path, { authed: true })
      expect(response.status, path).toBe(200)
    }
  })
})

describe('admin landing page', () => {
  it('links to Apps, Taxonomy and the Home canvas editor, with no design controls', async () => {
    const page = await request('/app/admin', { authed: true })
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('href="/app/admin/apps"')
    expect(html).toContain('href="/app/admin/taxonomy"')
    expect(html).toContain('href="/app/home-editor"')
    expect(html).toContain('backup.yml')
    // No theme/design/visual-customization controls of any kind.
    expect(html.toLowerCase()).not.toContain('theme')
    expect(html.toLowerCase()).not.toContain('color scheme')
  })

  it('is reachable from the app menu', async () => {
    const home = await request('/app', { authed: true })
    const html = await home.text()
    expect(html).toContain('href="/app/admin"')
  })
})
