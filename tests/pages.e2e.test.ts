import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { articleCategories, articleTags, users } from '../src/db/schema'
import { signValue } from '../src/lib/auth/cookie'
import { createSession } from '../src/lib/auth/session'
import { getById } from '../src/lib/pages/repo'
import { type DevServerHandle, startDevServer } from './helpers/dev-server'
import { createTestDb, DEFAULT_DEV_DATABASE_URL } from './helpers/test-db'

const PORT = 43118
const BASE_URL = `http://localhost:${PORT}`
const SESSION_SECRET = 'pages-e2e-secret-32-characters!!'

const { db, close } = createTestDb()
let server: DevServerHandle | undefined
let sessionCookie: string

interface RequestOptions {
  method?: string
  body?: unknown
  authed?: boolean
}

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

async function createPageViaApi(slug: string): Promise<number> {
  const response = await request('/api/pages', {
    method: 'POST',
    authed: true,
    body: { slug, title: 'Test page' },
  })
  expect(response.status).toBe(201)
  const { id } = (await response.json()) as { id: number }
  return id
}

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      googleSub: `pages-e2e-${Date.now()}`,
      email: 'owner@example.com',
      name: 'Pages E2E Owner',
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

describe('pages API — auth is enforced', () => {
  it('rejects unauthenticated create / patch / delete with 401 JSON', async () => {
    for (const [path, method] of [
      ['/api/pages', 'POST'],
      ['/api/pages/1', 'PATCH'],
      ['/api/pages/1', 'DELETE'],
    ] as const) {
      const response = await request(path, { method, body: {} })
      expect(response.status, `${method} ${path}`).toBe(401)
    }
  })
})

describe('pages API — create', () => {
  it('creates a page and returns its id', async () => {
    const slug = `create-test-${Date.now()}`
    const id = await createPageViaApi(slug)
    expect(id).toBeGreaterThan(0)
    expect((await getById(db, id))?.slug).toBe(slug)
  })

  it('rejects an invalid or reserved slug with 400', async () => {
    for (const slug of ['Bad Slug', 'a', 'app']) {
      const response = await request('/api/pages', {
        method: 'POST',
        authed: true,
        body: { slug, title: 'x' },
      })
      expect(response.status, slug).toBe(400)
    }
  })

  it('rejects a duplicate slug with 409', async () => {
    const slug = `dup-test-${Date.now()}`
    await createPageViaApi(slug)
    const response = await request('/api/pages', {
      method: 'POST',
      authed: true,
      body: { slug, title: 'Again' },
    })
    expect(response.status).toBe(409)
  })
})

describe('pages API — update', () => {
  it('patches slug, title, visibility, mode, sortKey', async () => {
    const suffix = Date.now()
    const id = await createPageViaApi(`patch-test-${suffix}`)
    const renamedSlug = `patch-test-renamed-${suffix}`
    const response = await request(`/api/pages/${id}`, {
      method: 'PATCH',
      authed: true,
      body: {
        slug: renamedSlug,
        title: 'Renamed',
        visibility: 'public',
        mode: 'auto',
        sortKey: 'title_asc',
      },
    })
    expect(response.status).toBe(200)
    const stored = await getById(db, id)
    expect(stored?.slug).toBe(renamedSlug)
    expect(stored?.title).toBe('Renamed')
    expect(stored?.visibility).toBe('public')
    expect(stored?.mode).toBe('auto')
    expect(stored?.sortKey).toBe('title_asc')
  })

  it('patches articleIds', async () => {
    const id = await createPageViaApi(`articles-test-${Date.now()}`)
    const response = await request(`/api/pages/${id}`, {
      method: 'PATCH',
      authed: true,
      body: { articleIds: [3, 1, 2] },
    })
    expect(response.status).toBe(200)
    expect((await getById(db, id))?.articleIds).toEqual([3, 1, 2])
  })

  it('setting categoryId clears tagId and vice versa, across separate PATCHes', async () => {
    // categoryId/tagId are real FKs (article_categories/article_tags), and
    // this DB isn't reset between runs, so exercise this with rows that
    // actually exist rather than arbitrary ids (same reasoning as
    // tests/pages.repo.test.ts's setAutoFilter test).
    const unique = crypto.randomUUID()
    const [category] = await db
      .insert(articleCategories)
      .values({ name: `pages-e2e-category-${unique}` })
      .returning()
    const [tag] = await db
      .insert(articleTags)
      .values({ name: `pages-e2e-tag-${unique}` })
      .returning()
    if (!category || !tag) throw new Error('fixture insert returned no row')

    const id = await createPageViaApi(`filter-test-${Date.now()}`)
    await request(`/api/pages/${id}`, {
      method: 'PATCH',
      authed: true,
      body: { categoryId: category.id },
    })
    expect((await getById(db, id))?.tagId).toBeNull()

    await request(`/api/pages/${id}`, {
      method: 'PATCH',
      authed: true,
      body: { tagId: tag.id },
    })
    const stored = await getById(db, id)
    expect(stored?.categoryId).toBeNull()
    expect(stored?.tagId).toBe(tag.id)
  })

  it('rejects setting both categoryId and tagId in one PATCH', async () => {
    const id = await createPageViaApi(`both-test-${Date.now()}`)
    const response = await request(`/api/pages/${id}`, {
      method: 'PATCH',
      authed: true,
      body: { categoryId: 1, tagId: 2 },
    })
    expect(response.status).toBe(400)
  })

  it('rejects malformed PATCH bodies with 400', async () => {
    const id = await createPageViaApi(`malformed-test-${Date.now()}`)
    for (const body of [
      {},
      { slug: 'Bad Slug' },
      { title: 42 },
      { visibility: 'friends-only' },
      { mode: 'weird' },
      { articleIds: 'nope' },
      { articleIds: [1.5] },
      { categoryId: 'one' },
      { sortKey: 'random' },
    ]) {
      const response = await request(`/api/pages/${id}`, {
        method: 'PATCH',
        authed: true,
        body,
      })
      expect(response.status, JSON.stringify(body)).toBe(400)
    }
  })

  it('404s a PATCH to a missing page and 400s a bad id', async () => {
    const missing = await request('/api/pages/999999', {
      method: 'PATCH',
      authed: true,
      body: { title: 'ghost' },
    })
    expect(missing.status).toBe(404)

    for (const badId of ['not-a-number', '1.5', '-1']) {
      const bad = await request(`/api/pages/${badId}`, {
        method: 'PATCH',
        authed: true,
        body: { title: 'x' },
      })
      expect(bad.status, badId).toBe(400)
    }
  })

  it("renaming into another page's slug returns 409", async () => {
    const suffix = Date.now()
    const ownedSlug = `owned-slug-${suffix}`
    await createPageViaApi(ownedSlug)
    const id = await createPageViaApi(`renamable-${suffix}`)
    const response = await request(`/api/pages/${id}`, {
      method: 'PATCH',
      authed: true,
      body: { slug: ownedSlug },
    })
    expect(response.status).toBe(409)
  })
})

describe('pages API — delete', () => {
  it('deletes a page', async () => {
    const id = await createPageViaApi(`delete-test-${Date.now()}`)
    const del = await request(`/api/pages/${id}`, {
      method: 'DELETE',
      authed: true,
    })
    expect(del.status).toBe(200)
    expect(await getById(db, id)).toBeNull()
  })

  it('404s deleting an unknown id', async () => {
    const response = await request('/api/pages/999999', {
      method: 'DELETE',
      authed: true,
    })
    expect(response.status).toBe(404)
  })
})
