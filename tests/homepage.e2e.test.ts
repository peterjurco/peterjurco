import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  articleCategories,
  articles,
  articleTags,
  articleTagsMap,
  users,
} from '../src/db/schema'
import { listFeatured } from '../src/lib/articles/queries'
import { createCategory } from '../src/lib/articles/repo'
import { signValue } from '../src/lib/auth/cookie'
import { createSession } from '../src/lib/auth/session'
import { type DevServerHandle, startDevServer } from './helpers/dev-server'
import { createTestDb, DEFAULT_DEV_DATABASE_URL } from './helpers/test-db'

const PORT = 43113
const BASE_URL = `http://localhost:${PORT}`
const SESSION_SECRET = 'homepage-e2e-secret-32-characters!'

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

/** Creates an article via the API and titles it via PATCH. */
async function createTitledArticle(title: string): Promise<number> {
  const created = await request('/api/articles', {
    method: 'POST',
    authed: true,
  })
  expect(created.status).toBe(201)
  const { id } = (await created.json()) as { id: number }
  const titled = await request(`/api/articles/${id}`, {
    method: 'PATCH',
    authed: true,
    body: { title },
  })
  expect(titled.status).toBe(200)
  return id
}

async function patchArticle(id: number, body: unknown): Promise<void> {
  const response = await request(`/api/articles/${id}`, {
    method: 'PATCH',
    authed: true,
    body,
  })
  expect(response.status).toBe(200)
}

/** The homepage's Featured section markup (heading to next heading). */
function featuredSection(html: string): string {
  const start = html.indexOf('Featured articles')
  const end = html.indexOf('Recent articles')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return html.slice(start, end)
}

beforeAll(async () => {
  // Deterministic listings: start from empty article tables (FK order).
  await db.delete(articleTagsMap)
  await db.delete(articles)
  await db.delete(articleTags)
  await db.delete(articleCategories)

  const [user] = await db
    .insert(users)
    .values({
      googleSub: `homepage-e2e-${Date.now()}`,
      email: 'owner@example.com',
      name: 'Homepage E2E Owner',
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

describe('featured-order endpoint — auth and validation', () => {
  it('rejects unauthenticated reorders with 401 JSON', async () => {
    const response = await request('/api/articles/featured-order', {
      method: 'POST',
      body: { orderedIds: [1] },
    })
    expect(response.status).toBe(401)
    const payload = (await response.json()) as { error: string }
    expect(payload.error).toBeTruthy()
  })

  it('rejects malformed bodies with 400', async () => {
    for (const body of [
      {},
      { orderedIds: 'not-an-array' },
      { orderedIds: [1.5] },
      { orderedIds: ['1'] },
      { orderedIds: [-1] },
    ]) {
      const response = await request('/api/articles/featured-order', {
        method: 'POST',
        authed: true,
        body,
      })
      expect(response.status, JSON.stringify(body)).toBe(400)
    }
  })
})

describe('homepage — featured reordering persists', () => {
  it('marks two articles featured, reorders them, and the order holds', async () => {
    const alpha = await createTitledArticle('Featured alpha')
    const beta = await createTitledArticle('Featured beta')
    await patchArticle(alpha, { isFeatured: true })
    await patchArticle(beta, { isFeatured: true })

    // Drag result: beta first. (Drag mechanics are covered by the jsdom
    // component tests — the wire contract is the ordered id array.)
    const reorder = await request('/api/articles/featured-order', {
      method: 'POST',
      authed: true,
      body: { orderedIds: [beta, alpha] },
    })
    expect(reorder.status).toBe(200)

    // Persisted for real — repo read against the same DB…
    expect((await listFeatured(db)).map((article) => article.id)).toEqual([
      beta,
      alpha,
    ])

    // …and a "reload": the homepage HTML lists beta before alpha.
    const page = await request('/app', { authed: true })
    expect(page.status).toBe(200)
    const section = featuredSection(await page.text())
    expect(section.indexOf('Featured beta')).toBeGreaterThan(-1)
    expect(section.indexOf('Featured beta')).toBeLessThan(
      section.indexOf('Featured alpha'),
    )

    // Reorder back — the swap persists too (order is stable, not accidental).
    const swapBack = await request('/api/articles/featured-order', {
      method: 'POST',
      authed: true,
      body: { orderedIds: [alpha, beta] },
    })
    expect(swapBack.status).toBe(200)
    const reloaded = featuredSection(
      await (await request('/app', { authed: true })).text(),
    )
    expect(reloaded.indexOf('Featured alpha')).toBeLessThan(
      reloaded.indexOf('Featured beta'),
    )
  }, 60_000)
})

describe('homepage — recent and widget slots', () => {
  it('shows the latest article first in Recent and renders slot empty-states', async () => {
    await createTitledArticle('Recent earlier')
    const latest = await createTitledArticle('Recent latest')

    const page = await request('/app', { authed: true })
    expect(page.status).toBe(200)
    const html = await page.text()

    const recentStart = html.indexOf('Recent articles')
    const recentSection = html.slice(
      recentStart,
      html.indexOf('Photo hubs', recentStart),
    )
    expect(recentSection).toContain(`/app/articles/${latest}`)
    expect(recentSection.indexOf('Recent latest')).toBeGreaterThan(-1)
    expect(recentSection.indexOf('Recent latest')).toBeLessThan(
      recentSection.indexOf('Recent earlier'),
    )

    // Widget slots degrade gracefully until Plans 5/7 fill them.
    expect(html).toContain('No photo hubs yet.')
    expect(html).toContain('No apps yet.')

    // The menu (REQUIREMENTS: authenticated section has a menu).
    for (const href of [
      '/app/articles',
      '/app/photos',
      '/app/admin/apps',
      '/app/admin',
    ]) {
      expect(html).toContain(`href="${href}"`)
    }
    expect(html).toContain('/api/auth/logout')
  })

  it('redirects anonymous visitors to login', async () => {
    const response = await request('/app')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/api/auth/login')
  })
})

describe('category and tag pages', () => {
  it('lists the articles of a category; unknown id 404s', async () => {
    const category = await createCategory(db, 'E2E Essays')
    const inside = await createTitledArticle('Categorized piece')
    await patchArticle(inside, { categoryId: category.id })
    await createTitledArticle('Uncategorized piece')

    const page = await request(`/app/categories/${category.id}`, {
      authed: true,
    })
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('E2E Essays')
    expect(html).toContain('Categorized piece')
    expect(html).toContain(`/app/articles/${inside}`)
    expect(html).not.toContain('Uncategorized piece')

    expect(
      (await request('/app/categories/999999', { authed: true })).status,
    ).toBe(404)
    expect(
      (await request('/app/categories/not-a-number', { authed: true })).status,
    ).toBe(404)
  })

  it('lists the articles of a tag; unknown id 404s', async () => {
    const tagged = await createTitledArticle('Tagged piece')
    await patchArticle(tagged, { tags: ['e2e-hiking'] })

    const hikingTag = (await db.select().from(articleTags)).find(
      (row) => row.name === 'e2e-hiking',
    )
    if (!hikingTag) throw new Error('tag row not created')

    const page = await request(`/app/tags/${hikingTag.id}`, { authed: true })
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('e2e-hiking')
    expect(html).toContain('Tagged piece')
    expect(html).toContain(`/app/articles/${tagged}`)

    expect((await request('/app/tags/999999', { authed: true })).status).toBe(
      404,
    )
  })

  it('gates listing pages behind auth', async () => {
    const response = await request('/app/categories/1')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/api/auth/login')
  })
})
