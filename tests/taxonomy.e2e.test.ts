import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  articleCategories,
  articles,
  articleTags,
  articleTagsMap,
  photoAlbums,
  photoAlbumsTagsMap,
  photoTags,
  users,
} from '../src/db/schema'
import { signValue } from '../src/lib/auth/cookie'
import { createSession } from '../src/lib/auth/session'
import { type DevServerHandle, startDevServer } from './helpers/dev-server'
import { createTestDb, DEFAULT_DEV_DATABASE_URL } from './helpers/test-db'

const PORT = 43118
const BASE_URL = `http://localhost:${PORT}`
const SESSION_SECRET = 'taxonomy-e2e-secret-32-characters!'
const GPHOTOS_URL = 'https://photos.app.goo.gl/TaxonomyE2E'

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

beforeAll(async () => {
  // FK order: join rows → articles/albums → categories/tags.
  await db.delete(articleTagsMap)
  await db.delete(articles)
  await db.delete(articleTags)
  await db.delete(articleCategories)
  await db.delete(photoAlbumsTagsMap)
  await db.delete(photoAlbums)
  await db.delete(photoTags)

  const [user] = await db
    .insert(users)
    .values({
      googleSub: `taxonomy-e2e-${Date.now()}`,
      email: 'owner@example.com',
      name: 'Taxonomy E2E Owner',
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

describe('taxonomy API — auth is enforced in every handler', () => {
  it('rejects unauthenticated calls with 401 JSON', async () => {
    for (const [path, method] of [
      ['/api/taxonomy/article-categories', 'POST'],
      ['/api/taxonomy/article-categories/1', 'PATCH'],
      ['/api/taxonomy/article-categories/1', 'DELETE'],
      ['/api/taxonomy/article-tags', 'POST'],
      ['/api/taxonomy/article-tags/1', 'PATCH'],
      ['/api/taxonomy/article-tags/1', 'DELETE'],
      ['/api/taxonomy/photo-tags', 'POST'],
      ['/api/taxonomy/photo-tags/1', 'PATCH'],
      ['/api/taxonomy/photo-tags/1', 'DELETE'],
    ] as const) {
      const response = await request(path, { method, body: {} })
      expect(response.status, `${method} ${path}`).toBe(401)
      const payload = (await response.json()) as { error: string }
      expect(payload.error).toBeTruthy()
    }
  })
})

describe('article categories — referential cleanup on delete', () => {
  it('creates, renames, and on delete detaches (sets null) an assigned article, which survives', async () => {
    const create = await request('/api/taxonomy/article-categories', {
      method: 'POST',
      authed: true,
      body: { name: 'E2E category' },
    })
    expect(create.status).toBe(201)
    const category = (await create.json()) as { id: number; name: string }

    const rename = await request(
      `/api/taxonomy/article-categories/${category.id}`,
      { method: 'PATCH', authed: true, body: { name: 'E2E renamed' } },
    )
    expect(rename.status).toBe(200)

    // Minimal article assigned to the category, inserted directly (no
    // article-creation API dependency needed for this test).
    const [article] = await db
      .insert(articles)
      .values({
        publicId: `taxonomy-e2e-article-${Date.now()}`,
        title: 'Category-linked article',
        content: { type: 'doc', content: [] },
        categoryId: category.id,
      })
      .returning()
    if (!article) throw new Error('failed to insert test article')

    const del = await request(
      `/api/taxonomy/article-categories/${category.id}`,
      { method: 'DELETE', authed: true },
    )
    expect(del.status).toBe(200)

    // DB-level verification: the article survives, uncategorized.
    const [reloaded] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, article.id))
    expect(reloaded).toBeDefined()
    expect(reloaded?.categoryId).toBeNull()
    expect(reloaded?.title).toBe('Category-linked article')

    const missing = await request(
      `/api/taxonomy/article-categories/${category.id}`,
      { method: 'PATCH', authed: true, body: { name: 'ghost' } },
    )
    expect(missing.status).toBe(404)
  })

  it('rejects invalid payloads and unknown ids', async () => {
    const empty = await request('/api/taxonomy/article-categories', {
      method: 'POST',
      authed: true,
      body: { name: '   ' },
    })
    expect(empty.status).toBe(400)

    const badId = await request(
      '/api/taxonomy/article-categories/not-a-number',
      {
        method: 'DELETE',
        authed: true,
      },
    )
    expect(badId.status).toBe(400)

    const missingDelete = await request(
      '/api/taxonomy/article-categories/999999',
      {
        method: 'DELETE',
        authed: true,
      },
    )
    expect(missingDelete.status).toBe(404)
  })
})

describe('article tags — join rows removed, article untouched', () => {
  it('creates, deletes, and the join row (not the article) disappears', async () => {
    const create = await request('/api/taxonomy/article-tags', {
      method: 'POST',
      authed: true,
      body: { name: `e2e-tag-${Date.now()}` },
    })
    expect(create.status).toBe(201)
    const tag = (await create.json()) as { id: number; name: string }

    const [article] = await db
      .insert(articles)
      .values({
        publicId: `taxonomy-e2e-tagged-${Date.now()}`,
        title: 'Tagged article',
        content: { type: 'doc', content: [] },
      })
      .returning()
    if (!article) throw new Error('failed to insert test article')
    await db
      .insert(articleTagsMap)
      .values({ articleId: article.id, tagId: tag.id })

    const del = await request(`/api/taxonomy/article-tags/${tag.id}`, {
      method: 'DELETE',
      authed: true,
    })
    expect(del.status).toBe(200)

    const links = await db
      .select()
      .from(articleTagsMap)
      .where(eq(articleTagsMap.tagId, tag.id))
    expect(links).toEqual([])
    const [reloaded] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, article.id))
    expect(reloaded).toBeDefined()
    expect(reloaded?.title).toBe('Tagged article')
  })
})

describe('photo tags — visibility toggle and referential cleanup', () => {
  it('creates a private tag, flips it public and back, and reflects on the admin page', async () => {
    const name = `e2e-photo-tag-${Date.now()}`
    const create = await request('/api/taxonomy/photo-tags', {
      method: 'POST',
      authed: true,
      body: { name },
    })
    expect(create.status).toBe(201)
    const tag = (await create.json()) as { id: number; visibility: string }
    expect(tag.visibility).toBe('private')

    const publish = await request(`/api/taxonomy/photo-tags/${tag.id}`, {
      method: 'PATCH',
      authed: true,
      body: { visibility: 'public' },
    })
    expect(publish.status).toBe(200)

    const adminPage = await request('/app/admin/taxonomy', { authed: true })
    expect(adminPage.status).toBe(200)
    const html = await adminPage.text()
    expect(html).toContain(name)
    expect(html).toContain('public')

    const unpublish = await request(`/api/taxonomy/photo-tags/${tag.id}`, {
      method: 'PATCH',
      authed: true,
      body: { visibility: 'private' },
    })
    expect(unpublish.status).toBe(200)
  })

  it('deletes a tag, removing its album link without deleting the album', async () => {
    const album = await request('/api/photos/albums', {
      method: 'POST',
      authed: true,
      body: {
        name: 'Taxonomy E2E album',
        googlePhotosUrl: GPHOTOS_URL,
        tags: [`e2e-doomed-${Date.now()}`],
      },
    })
    expect(album.status).toBe(201)
    const { id: albumId } = (await album.json()) as { id: number }

    const [row] = await db
      .select()
      .from(photoAlbumsTagsMap)
      .where(eq(photoAlbumsTagsMap.albumId, albumId))
    if (!row) throw new Error('album/tag link not created')
    const tagId = row.tagId

    const del = await request(`/api/taxonomy/photo-tags/${tagId}`, {
      method: 'DELETE',
      authed: true,
    })
    expect(del.status).toBe(200)

    const links = await db
      .select()
      .from(photoAlbumsTagsMap)
      .where(eq(photoAlbumsTagsMap.tagId, tagId))
    expect(links).toEqual([])
    const [reloadedAlbum] = await db
      .select()
      .from(photoAlbums)
      .where(eq(photoAlbums.id, albumId))
    expect(reloadedAlbum).toBeDefined()
    expect(reloadedAlbum?.name).toBe('Taxonomy E2E album')
  })

  it('rejects a bad visibility value and 404s unknown ids', async () => {
    const create = await request('/api/taxonomy/photo-tags', {
      method: 'POST',
      authed: true,
      body: { name: `e2e-bad-vis-${Date.now()}` },
    })
    const tag = (await create.json()) as { id: number }

    const bad = await request(`/api/taxonomy/photo-tags/${tag.id}`, {
      method: 'PATCH',
      authed: true,
      body: { visibility: 'friends-only' },
    })
    expect(bad.status).toBe(400)

    const missing = await request('/api/taxonomy/photo-tags/999999', {
      method: 'PATCH',
      authed: true,
      body: { visibility: 'public' },
    })
    expect(missing.status).toBe(404)

    const missingDelete = await request('/api/taxonomy/photo-tags/999999', {
      method: 'DELETE',
      authed: true,
    })
    expect(missingDelete.status).toBe(404)
  })
})

describe('admin taxonomy page', () => {
  it('gates the page behind auth and renders when authed', async () => {
    const anon = await request('/app/admin/taxonomy')
    expect(anon.status).toBe(302)
    expect(anon.headers.get('location')).toBe('/api/auth/login')

    const page = await request('/app/admin/taxonomy', { authed: true })
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('Categories')
  })
})
