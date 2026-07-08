import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { apps, users } from '../src/db/schema'
import { listOrdered } from '../src/lib/apps/repo'
import { signValue } from '../src/lib/auth/cookie'
import { createSession } from '../src/lib/auth/session'
import { type DevServerHandle, startDevServer } from './helpers/dev-server'
import { createTestDb, DEFAULT_DEV_DATABASE_URL } from './helpers/test-db'

const PORT = 43117
const BASE_URL = `http://localhost:${PORT}`
const SESSION_SECRET = 'apps-e2e-secret-32-characters!!!!'

const { db, close } = createTestDb()
let server: DevServerHandle | undefined
/** Signed session cookie value for the owner — minted directly in the DB. */
let sessionCookie: string

interface RequestOptions {
  method?: string
  body?: unknown
  authed?: boolean
}

/** fetch against the dev server; sends Origin like a browser would. */
async function request(
  path: string,
  { method = 'GET', body, authed = false }: RequestOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = { Origin: BASE_URL }
  if (authed) headers.Cookie = `session=${sessionCookie}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  return fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    redirect: 'manual',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

async function createAppViaApi(
  overrides: Record<string, unknown> = {},
): Promise<{ id: number; sortOrder: number }> {
  const response = await request('/api/apps', {
    method: 'POST',
    authed: true,
    body: {
      name: 'E2E app',
      url: 'https://e2e.example',
      ...overrides,
    },
  })
  expect(response.status).toBe(201)
  return (await response.json()) as { id: number; sortOrder: number }
}

beforeAll(async () => {
  await db.delete(apps)

  const [user] = await db
    .insert(users)
    .values({
      googleSub: `apps-e2e-${Date.now()}`,
      email: 'owner@example.com',
      name: 'Apps E2E Owner',
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

describe('apps API — auth is enforced in every handler', () => {
  it('rejects unauthenticated calls with 401 JSON', async () => {
    for (const [path, method] of [
      ['/api/apps', 'POST'],
      ['/api/apps/1', 'PATCH'],
      ['/api/apps/1', 'DELETE'],
      ['/api/apps/reorder', 'POST'],
    ] as const) {
      const response = await request(path, { method, body: {} })
      expect(response.status, `${method} ${path}`).toBe(401)
      const payload = (await response.json()) as { error: string }
      expect(payload.error).toBeTruthy()
    }
  })
})

describe('apps API — validation', () => {
  it('rejects invalid create payloads with 400', async () => {
    for (const body of [
      {}, // nothing
      { name: 'No url' },
      { name: '', url: 'https://ok.example' },
      { name: 'Bad url', url: 'http://insecure.example' },
      { name: 'Bad icon', url: 'https://ok.example', iconKey: 42 },
      { name: 'Bad sort', url: 'https://ok.example', sortOrder: 1.5 },
    ]) {
      const response = await request('/api/apps', {
        method: 'POST',
        authed: true,
        body,
      })
      expect(response.status, JSON.stringify(body)).toBe(400)
    }
  })

  it('404s missing apps and 400s bad ids / empty patches', async () => {
    const missing = await request('/api/apps/999999', {
      method: 'PATCH',
      authed: true,
      body: { name: 'ghost' },
    })
    expect(missing.status).toBe(404)

    const missingDelete = await request('/api/apps/999999', {
      method: 'DELETE',
      authed: true,
    })
    expect(missingDelete.status).toBe(404)

    const badId = await request('/api/apps/not-a-number', {
      method: 'PATCH',
      authed: true,
      body: { name: 'x' },
    })
    expect(badId.status).toBe(400)

    const { id } = await createAppViaApi()
    const empty = await request(`/api/apps/${id}`, {
      method: 'PATCH',
      authed: true,
      body: {},
    })
    expect(empty.status).toBe(400)
  })

  it('rejects invalid /api/apps/reorder bodies', async () => {
    for (const body of [
      {}, // no orderedIds
      { orderedIds: 'nope' },
      { orderedIds: [1, -2] },
      { orderedIds: [1, 1.5] },
      { orderedIds: Array.from({ length: 101 }, (_, i) => i + 1) },
    ]) {
      const response = await request('/api/apps/reorder', {
        method: 'POST',
        authed: true,
        body,
      })
      expect(response.status, JSON.stringify(body)).toBe(400)
    }
  })
})

describe('apps API — CRUD, ordering and the homepage widget', () => {
  it('creates, lists (ordered), reorders and deletes an app end-to-end', async () => {
    const first = await createAppViaApi({ name: 'First app' })
    const second = await createAppViaApi({ name: 'Second app' })
    expect(second.sortOrder).toBeGreaterThan(first.sortOrder)

    // Appears in listOrdered.
    let ordered = await listOrdered(db)
    expect(ordered.map((app) => app.id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    )

    // Appears on the authenticated homepage widget with a link.
    const homePage = await request('/app', { authed: true })
    expect(homePage.status).toBe(200)
    const homeHtml = await homePage.text()
    expect(homeHtml).toContain('First app')
    expect(homeHtml).toContain('Second app')
    expect(homeHtml).toContain('href="https://e2e.example"')
    expect(homeHtml).toContain('/app/admin/apps')

    // Reorder: swap sort_order between the two, PATCHing both.
    const swapFirst = await request(`/api/apps/${first.id}`, {
      method: 'PATCH',
      authed: true,
      body: { sortOrder: second.sortOrder },
    })
    const swapSecond = await request(`/api/apps/${second.id}`, {
      method: 'PATCH',
      authed: true,
      body: { sortOrder: first.sortOrder },
    })
    expect(swapFirst.status).toBe(200)
    expect(swapSecond.status).toBe(200)

    ordered = await listOrdered(db)
    const firstIndex = ordered.findIndex((app) => app.id === first.id)
    const secondIndex = ordered.findIndex((app) => app.id === second.id)
    expect(secondIndex).toBeLessThan(firstIndex)

    // Delete removes it from the list.
    const del = await request(`/api/apps/${first.id}`, {
      method: 'DELETE',
      authed: true,
    })
    expect(del.status).toBe(200)
    const afterDelete = await listOrdered(db)
    expect(afterDelete.some((app) => app.id === first.id)).toBe(false)
  })

  it('POST /api/apps/reorder rewrites sort_order for the full list', async () => {
    const first = await createAppViaApi({ name: 'Alpha' })
    const second = await createAppViaApi({ name: 'Beta' })
    const third = await createAppViaApi({ name: 'Gamma' })

    const reorder = await request('/api/apps/reorder', {
      method: 'POST',
      authed: true,
      body: { orderedIds: [third.id, first.id, second.id] },
    })
    expect(reorder.status).toBe(200)

    // Other tests in this file leave apps behind (only `beforeAll` clears
    // the table), so filter to the three ids this test owns rather than
    // asserting on the full, shared list.
    const ids = new Set([first.id, second.id, third.id])
    const ordered = (await listOrdered(db)).filter((app) => ids.has(app.id))
    expect(ordered.map((app) => app.id)).toEqual([
      third.id,
      first.id,
      second.id,
    ])
    expect(ordered.map((app) => app.sortOrder)).toEqual([0, 1, 2])
  })

  it('renames and clears the icon via PATCH', async () => {
    const { id } = await createAppViaApi({ iconKey: 'covers/icon.png' })

    const patch = await request(`/api/apps/${id}`, {
      method: 'PATCH',
      authed: true,
      body: { name: 'Renamed app', iconKey: null },
    })
    expect(patch.status).toBe(200)

    const found = (await listOrdered(db)).find((app) => app.id === id)
    expect(found?.name).toBe('Renamed app')
    expect(found?.iconKey).toBeNull()
  })
})

describe('admin apps page', () => {
  it('gates the page behind auth and renders when authed', async () => {
    const anon = await request('/app/admin/apps')
    expect(anon.status).toBe(302)
    expect(anon.headers.get('location')).toBe('/api/auth/login')

    await createAppViaApi({
      name: 'Admin-listed app',
      url: 'https://admin-listed.example',
    })
    const page = await request('/app/admin/apps', { authed: true })
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('Admin-listed app')
    expect(html).toContain('href="https://admin-listed.example"')
  })
})
