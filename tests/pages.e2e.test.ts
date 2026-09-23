import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { articleCategories, articleTags, users } from '../src/db/schema'
import { createCategory } from '../src/lib/articles/repo'
import { signValue } from '../src/lib/auth/cookie'
import { createSession } from '../src/lib/auth/session'
import { getById } from '../src/lib/pages/repo'
import { type DevServerHandle, startDevServer } from './helpers/dev-server'
import { createTestDb, DEFAULT_DEV_DATABASE_URL } from './helpers/test-db'

// Dev-server round-trips share one compile-on-demand server — generous
// per-test budget so full-suite load never flakes a passing test.
vi.setConfig({ testTimeout: 30_000 })

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

async function fetchPagesListHtml(): Promise<string> {
  const response = await request('/app/pages', { authed: true })
  expect(response.status).toBe(200)
  return response.text()
}

/**
 * Extracts the `<li>...</li>` chunk rendering the given slug's row, so
 * assertions about its badges don't get confused by other pages the
 * shared-DB test run has created (this DB isn't reset between runs, and
 * other tests in this file create pages too).
 */
function liForSlug(html: string, slug: string): string {
  const marker = `/${slug}</span>`
  const markerIndex = html.indexOf(marker)
  if (markerIndex === -1) {
    throw new Error(`slug "${slug}" not found in /app/pages HTML`)
  }
  // `<li` (not `<li>`) — Astro injects a `data-astro-cid-*` scoping
  // attribute onto the tag, so it never renders as a bare `<li>`.
  const liStart = html.lastIndexOf('<li', markerIndex)
  const liEnd = html.indexOf('</li>', markerIndex)
  return html.slice(liStart, liEnd)
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
      { showTags: 'yes' },
      { showCreatedDate: 'yes' },
      { showUpdatedDate: 'yes' },
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

describe('pages admin list page', () => {
  it('renders the title and Public badge for a public page', async () => {
    const slug = `list-public-${Date.now()}`
    const id = await createPageViaApi(slug)
    const patchResponse = await request(`/api/pages/${id}`, {
      method: 'PATCH',
      authed: true,
      body: { visibility: 'public' },
    })
    expect(patchResponse.status).toBe(200)

    const li = liForSlug(await fetchPagesListHtml(), slug)
    expect(li).toContain('Test page')
    expect(li).toContain('Public')
  })

  it('renders Manual for manual-mode pages and Auto for auto-mode pages', async () => {
    const suffix = Date.now()
    const manualSlug = `list-manual-${suffix}`
    const autoSlug = `list-auto-${suffix}`
    const manualId = await createPageViaApi(manualSlug)
    const autoId = await createPageViaApi(autoSlug)

    // 'manual' is already the schema default, but set both explicitly so
    // this doesn't silently depend on that default.
    const manualPatch = await request(`/api/pages/${manualId}`, {
      method: 'PATCH',
      authed: true,
      body: { mode: 'manual' },
    })
    const autoPatch = await request(`/api/pages/${autoId}`, {
      method: 'PATCH',
      authed: true,
      body: { mode: 'auto' },
    })
    expect(manualPatch.status).toBe(200)
    expect(autoPatch.status).toBe(200)

    const html = await fetchPagesListHtml()
    expect(liForSlug(html, manualSlug)).toContain('Manual')
    expect(liForSlug(html, autoSlug)).toContain('Auto')
  })
})

describe('public page route', () => {
  it('404s an unknown slug and a private page', async () => {
    const unknown = await request('/no-such-slug')
    expect(unknown.status).toBe(404)

    const privateSlug = `still-private-${Date.now()}`
    await createPageViaApi(privateSlug)
    const privatePage = await request(`/${privateSlug}`)
    expect(privatePage.status).toBe(404)
  })

  it('lets a signed-in owner preview a private page; a signed-out visitor still 404s', async () => {
    const slug = `owner-preview-${Date.now()}`
    await createPageViaApi(slug)

    const asOwner = await request(`/${slug}`, { authed: true })
    expect(asOwner.status).toBe(200)

    const asVisitor = await request(`/${slug}`)
    expect(asVisitor.status).toBe(404)
  })

  it('a public page previewed by the owner also shows its draft articles; a visitor never sees them', async () => {
    const draft = await request('/api/articles', {
      method: 'POST',
      authed: true,
    })
    const { id: draftId } = (await draft.json()) as { id: number }
    await request(`/api/articles/${draftId}`, {
      method: 'PATCH',
      authed: true,
      body: { title: 'Unfinished draft' },
    })

    const published = await request('/api/articles', {
      method: 'POST',
      authed: true,
    })
    const { id: publishedId } = (await published.json()) as { id: number }
    await request(`/api/articles/${publishedId}`, {
      method: 'PATCH',
      authed: true,
      body: { title: 'Finished post', visibility: 'public' },
    })

    const slug = `draft-preview-${Date.now()}`
    const pageId = await createPageViaApi(slug)
    await request(`/api/pages/${pageId}`, {
      method: 'PATCH',
      authed: true,
      body: {
        articleIds: [draftId, publishedId],
        visibility: 'public',
      },
    })

    const asOwner = await request(`/${slug}`, { authed: true })
    expect(asOwner.status).toBe(200)
    const ownerHtml = await asOwner.text()
    expect(ownerHtml).toContain('Unfinished draft')
    expect(ownerHtml).toContain('Finished post')

    const asVisitor = await request(`/${slug}`)
    expect(asVisitor.status).toBe(200)
    const visitorHtml = await asVisitor.text()
    expect(visitorHtml).not.toContain('Unfinished draft')
    expect(visitorHtml).toContain('Finished post')
  })

  it('renders a manual-mode page: tiles in order, correct links, imageless fallback', async () => {
    const article1 = await request('/api/articles', {
      method: 'POST',
      authed: true,
    })
    const { id: articleId1 } = (await article1.json()) as { id: number }
    await request(`/api/articles/${articleId1}`, {
      method: 'PATCH',
      authed: true,
      body: { title: 'Tokyo trip', visibility: 'public' },
    })

    const article2 = await request('/api/articles', {
      method: 'POST',
      authed: true,
    })
    const { id: articleId2 } = (await article2.json()) as { id: number }
    await request(`/api/articles/${articleId2}`, {
      method: 'PATCH',
      authed: true,
      body: { title: 'Kyoto notes', visibility: 'public' },
    })

    const slug = `japan-manual-${Date.now()}`
    const pageId = await createPageViaApi(slug)
    await request(`/api/pages/${pageId}`, {
      method: 'PATCH',
      authed: true,
      body: { articleIds: [articleId2, articleId1], visibility: 'public' },
    })

    const response = await request(`/${slug}`)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('Kyoto notes')
    expect(html).toContain('Tokyo trip')
    // Order: Kyoto (articleId2) appears before Tokyo (articleId1).
    expect(html.indexOf('Kyoto notes')).toBeLessThan(html.indexOf('Tokyo trip'))
    expect(html).toContain('cover-placeholder')
  })

  it('shows tags and dates only when their display flags are on', async () => {
    const article = await request('/api/articles', {
      method: 'POST',
      authed: true,
    })
    const { id: articleId } = (await article.json()) as { id: number }
    await request(`/api/articles/${articleId}`, {
      method: 'PATCH',
      authed: true,
      body: {
        title: 'Tagged article',
        visibility: 'public',
        tags: ['adventure', 'solo'],
      },
    })

    const slug = `display-flags-${Date.now()}`
    const pageId = await createPageViaApi(slug)
    await request(`/api/pages/${pageId}`, {
      method: 'PATCH',
      authed: true,
      body: { articleIds: [articleId], visibility: 'public' },
    })

    const withoutFlags = await request(`/${slug}`)
    const htmlWithoutFlags = await withoutFlags.text()
    expect(htmlWithoutFlags).not.toContain('adventure')
    expect(htmlWithoutFlags).not.toContain('class="dates"')

    await request(`/api/pages/${pageId}`, {
      method: 'PATCH',
      authed: true,
      body: { showTags: true, showCreatedDate: true, showUpdatedDate: true },
    })
    const withFlags = await request(`/${slug}`)
    const htmlWithFlags = await withFlags.text()
    expect(htmlWithFlags).toContain('adventure')
    expect(htmlWithFlags).toContain('solo')
    expect(htmlWithFlags).toContain('class="dates"')
    expect(htmlWithFlags).toContain('Updated')
  })

  it('renders an auto-mode page filtered by category, sorted title_asc', async () => {
    const category = await createCategory(db, `films-${Date.now()}`)
    const a = await request('/api/articles', { method: 'POST', authed: true })
    const { id: idA } = (await a.json()) as { id: number }
    await request(`/api/articles/${idA}`, {
      method: 'PATCH',
      authed: true,
      body: {
        title: 'Zebra film',
        categoryId: category.id,
        visibility: 'public',
      },
    })
    const b = await request('/api/articles', { method: 'POST', authed: true })
    const { id: idB } = (await b.json()) as { id: number }
    await request(`/api/articles/${idB}`, {
      method: 'PATCH',
      authed: true,
      body: {
        title: 'Alpha film',
        categoryId: category.id,
        visibility: 'public',
      },
    })

    const slug = `films-auto-${Date.now()}`
    const pageId = await createPageViaApi(slug)
    await request(`/api/pages/${pageId}`, {
      method: 'PATCH',
      authed: true,
      body: {
        mode: 'auto',
        categoryId: category.id,
        sortKey: 'title_asc',
        visibility: 'public',
      },
    })

    const response = await request(`/${slug}`)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html.indexOf('Alpha film')).toBeLessThan(html.indexOf('Zebra film'))
  })
})
