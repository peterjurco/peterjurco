import { AwsClient } from 'aws4fetch'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { users } from '../src/db/schema'
import { signValue } from '../src/lib/auth/cookie'
import { createSession } from '../src/lib/auth/session'
import { getTagById, listAlbums, listTags } from '../src/lib/photos/repo'
import { type DevServerHandle, startDevServer } from './helpers/dev-server'
import { createTestDb, DEFAULT_DEV_DATABASE_URL } from './helpers/test-db'

// Dev-server round-trips share one compile-on-demand server — generous
// per-test budget so full-suite load never flakes a passing test.
vi.setConfig({ testTimeout: 30_000 })

const PORT = 43115
const BASE_URL = `http://localhost:${PORT}`
const SESSION_SECRET = 'photos-e2e-secret-32-characters!!'
const GPHOTOS_URL = 'https://photos.app.goo.gl/PhotosE2E'

const MINIO_ENDPOINT = 'http://localhost:9000'
const BUCKET = 'peterjurco-test'
const minio = new AwsClient({
  accessKeyId: 'minioadmin',
  secretAccessKey: 'minioadmin',
  service: 's3',
  region: 'auto',
})

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

async function createAlbumViaApi(
  overrides: Record<string, unknown> = {},
): Promise<number> {
  const response = await request('/api/photos/albums', {
    method: 'POST',
    authed: true,
    body: {
      name: 'E2E album',
      googlePhotosUrl: GPHOTOS_URL,
      ...overrides,
    },
  })
  expect(response.status).toBe(201)
  const { id } = (await response.json()) as { id: number }
  expect(id).toBeTypeOf('number')
  return id
}

beforeAll(async () => {
  // The MinIO test bucket (docker-compose.test.yml) — covers PUT here go
  // through the same presign path production uses against R2.
  const bucket = await minio.fetch(`${MINIO_ENDPOINT}/${BUCKET}`, {
    method: 'PUT',
  })
  if (!bucket.ok && bucket.status !== 409) {
    throw new Error(
      `MinIO bucket create failed (${bucket.status}) — is MinIO up? ` +
        'docker compose -f docker-compose.test.yml up -d',
    )
  }

  const [user] = await db
    .insert(users)
    .values({
      googleSub: `photos-e2e-${Date.now()}`,
      email: 'owner@example.com',
      name: 'Photos E2E Owner',
    })
    .returning()
  if (!user) throw new Error('failed to insert e2e user')
  const { token } = await createSession(db, user.id)
  sessionCookie = await signValue(SESSION_SECRET, token)

  // Image URLs on the pages resolve straight to the MinIO objects: the
  // dev server inherits these build-time PUBLIC_ vars from process.env.
  process.env.PUBLIC_R2_PUBLIC_BASE_URL = `${MINIO_ENDPOINT}/${BUCKET}`
  process.env.PUBLIC_IMAGE_TRANSFORMS = 'off'

  server = await startDevServer({
    port: PORT,
    vars: {
      DATABASE_URL: DEFAULT_DEV_DATABASE_URL,
      SESSION_SECRET,
      GOOGLE_CLIENT_ID: 'unused',
      GOOGLE_CLIENT_SECRET: 'unused',
      GOOGLE_REDIRECT_URI: `${BASE_URL}/api/auth/callback`,
      AUTH_ALLOWED_EMAILS: 'owner@example.com',
      R2_ACCOUNT_ID: 'unused-local',
      R2_ACCESS_KEY_ID: 'minioadmin',
      R2_SECRET_ACCESS_KEY: 'minioadmin',
      R2_BUCKET: BUCKET,
      R2_ENDPOINT: MINIO_ENDPOINT,
    },
  })
}, 120_000)

afterAll(async () => {
  server?.stop()
  await close()
})

describe('photos API — auth is enforced in every handler', () => {
  it('rejects unauthenticated calls with 401 JSON', async () => {
    for (const [path, method] of [
      ['/api/photos/albums', 'POST'],
      ['/api/photos/albums/1', 'PATCH'],
      ['/api/photos/albums/1', 'DELETE'],
      ['/api/photos/tags', 'POST'],
      ['/api/photos/tags/1', 'PATCH'],
    ] as const) {
      const response = await request(path, { method, body: {} })
      expect(response.status, `${method} ${path}`).toBe(401)
      const payload = (await response.json()) as { error: string }
      expect(payload.error).toBeTruthy()
    }
  })
})

describe('photos API — album CRUD', () => {
  it('creates an album with cover and tags end-to-end', async () => {
    const id = await createAlbumViaApi({
      name: 'Analogue 2024',
      coverImageKey: 'covers/analogue.jpg',
      tags: ['analogue', 'film'],
    })

    const albums = await listAlbums(db)
    const created = albums.find((album) => album.id === id)
    expect(created?.name).toBe('Analogue 2024')
    expect(created?.googlePhotosUrl).toBe(GPHOTOS_URL)
    expect(created?.coverImageKey).toBe('covers/analogue.jpg')
    expect(created?.tags.map((tag) => tag.name).sort()).toEqual([
      'analogue',
      'film',
    ])
  })

  it('rejects invalid create payloads with 400', async () => {
    for (const body of [
      {}, // nothing
      { name: 'No url' },
      { name: '', googlePhotosUrl: GPHOTOS_URL },
      { name: 'Bad url', googlePhotosUrl: 'https://evil.com/album' },
      { name: 'Bad url', googlePhotosUrl: 'http://photos.app.goo.gl/x' },
      { name: 'Bad tags', googlePhotosUrl: GPHOTOS_URL, tags: 'family' },
      { name: 'Bad cover', googlePhotosUrl: GPHOTOS_URL, coverImageKey: 42 },
    ]) {
      const response = await request('/api/photos/albums', {
        method: 'POST',
        authed: true,
        body,
      })
      expect(response.status, JSON.stringify(body)).toBe(400)
    }
  })

  it('PATCHes fields and tag set; DELETE removes the album', async () => {
    const id = await createAlbumViaApi({ tags: ['before'] })

    const patch = await request(`/api/photos/albums/${id}`, {
      method: 'PATCH',
      authed: true,
      body: {
        name: 'Renamed',
        coverImageKey: 'covers/new.webp',
        tags: ['after'],
      },
    })
    expect(patch.status).toBe(200)

    const albums = await listAlbums(db)
    const patched = albums.find((album) => album.id === id)
    expect(patched?.name).toBe('Renamed')
    expect(patched?.coverImageKey).toBe('covers/new.webp')
    expect(patched?.tags.map((tag) => tag.name)).toEqual(['after'])

    const del = await request(`/api/photos/albums/${id}`, {
      method: 'DELETE',
      authed: true,
    })
    expect(del.status).toBe(200)
    const after = await listAlbums(db)
    expect(after.some((album) => album.id === id)).toBe(false)
  })

  it('404s missing albums and 400s bad ids / bad patches', async () => {
    const missing = await request('/api/photos/albums/999999', {
      method: 'PATCH',
      authed: true,
      body: { name: 'ghost' },
    })
    expect(missing.status).toBe(404)

    const missingDelete = await request('/api/photos/albums/999999', {
      method: 'DELETE',
      authed: true,
    })
    expect(missingDelete.status).toBe(404)

    const badId = await request('/api/photos/albums/not-a-number', {
      method: 'PATCH',
      authed: true,
      body: { name: 'x' },
    })
    expect(badId.status).toBe(400)

    const id = await createAlbumViaApi()
    for (const body of [
      {}, // no updatable fields
      { name: '' },
      { googlePhotosUrl: 'https://evil.com/x' },
      { coverImageKey: 42 },
      { tags: 'nope' },
    ]) {
      const response = await request(`/api/photos/albums/${id}`, {
        method: 'PATCH',
        authed: true,
        body,
      })
      expect(response.status, JSON.stringify(body)).toBe(400)
    }
  })
})

describe('photos API — tags', () => {
  it('creates a tag and flips its visibility', async () => {
    const create = await request('/api/photos/tags', {
      method: 'POST',
      authed: true,
      body: { name: `family-${Date.now()}` },
    })
    expect(create.status).toBe(201)
    const tag = (await create.json()) as {
      id: number
      publicId: string
      visibility: string
    }
    expect(tag.visibility).toBe('private')
    expect(tag.publicId).toMatch(/^[A-Za-z0-9_-]{21}$/)

    const publish = await request(`/api/photos/tags/${tag.id}`, {
      method: 'PATCH',
      authed: true,
      body: { visibility: 'public' },
    })
    expect(publish.status).toBe(200)
    expect((await getTagById(db, tag.id))?.visibility).toBe('public')

    const badVisibility = await request(`/api/photos/tags/${tag.id}`, {
      method: 'PATCH',
      authed: true,
      body: { visibility: 'friends-only' },
    })
    expect(badVisibility.status).toBe(400)

    const missing = await request('/api/photos/tags/999999', {
      method: 'PATCH',
      authed: true,
      body: { visibility: 'public' },
    })
    expect(missing.status).toBe(404)
  })

  it('rejects empty tag names and returns the existing tag on duplicates', async () => {
    const empty = await request('/api/photos/tags', {
      method: 'POST',
      authed: true,
      body: { name: '   ' },
    })
    expect(empty.status).toBe(400)

    const name = `dupe-${Date.now()}`
    const first = await request('/api/photos/tags', {
      method: 'POST',
      authed: true,
      body: { name },
    })
    const again = await request('/api/photos/tags', {
      method: 'POST',
      authed: true,
      body: { name },
    })
    expect(again.status).toBe(201)
    const firstTag = (await first.json()) as { id: number }
    const againTag = (await again.json()) as { id: number }
    expect(againTag.id).toBe(firstTag.id)
    const tags = await listTags(db)
    expect(tags.filter((tag) => tag.name === name)).toHaveLength(1)
  })
})

describe('photo hub — pages and public sharing flow', () => {
  it('gates the authed pages behind login', async () => {
    for (const path of ['/app/photos', '/app/photos/tags/1']) {
      const response = await request(path)
      expect(response.status, path).toBe(302)
      expect(response.headers.get('location')).toBe('/api/auth/login')
    }
  })

  it('404s unknown tags and albums on the authed pages', async () => {
    const tagPage = await request('/app/photos/tags/999999', { authed: true })
    expect(tagPage.status).toBe(404)
    const badTagId = await request('/app/photos/tags/not-a-number', {
      authed: true,
    })
    expect(badTagId.status).toBe(404)
    const editPage = await request('/app/photos/999999/edit', { authed: true })
    expect(editPage.status).toBe(404)
  })

  it('runs the full add → list → tag page → public share → revoke loop', async () => {
    // 1. Upload a cover exactly like CoverUpload does: presign, then PUT.
    const presign = await request('/api/media/presign', {
      method: 'POST',
      authed: true,
      body: { contentType: 'image/png', size: 9, filename: 'hub.png' },
    })
    expect(presign.status).toBe(200)
    const { url, key } = (await presign.json()) as { url: string; key: string }
    const put = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: 'png-bytes',
    })
    expect(put.status).toBe(200)

    // 2. Create the album with the stored cover and a fresh tag.
    const tagName = `family-hub-${Date.now()}`
    const albumId = await createAlbumViaApi({
      name: 'Family summer',
      coverImageKey: key,
      tags: [tagName],
    })
    const tag = (await listTags(db)).find((entry) => entry.name === tagName)
    if (!tag) throw new Error('tag was not created with the album')

    // 3. The hub list shows the album: cover, name, tag link, edit link.
    const listPage = await request('/app/photos', { authed: true })
    expect(listPage.status).toBe(200)
    const listHtml = await listPage.text()
    expect(listHtml).toContain('Family summer')
    expect(listHtml).toContain(`/app/photos/tags/${tag.id}`)
    expect(listHtml).toContain(`/app/photos/${albumId}/edit`)
    // Transforms are off in tests → the cover img points at the object.
    expect(listHtml).toContain(`${MINIO_ENDPOINT}/${BUCKET}/${key}`)

    // 4. The tag page lists the album and shows visibility.
    const tagPage = await request(`/app/photos/tags/${tag.id}`, {
      authed: true,
    })
    expect(tagPage.status).toBe(200)
    const tagHtml = await tagPage.text()
    expect(tagHtml).toContain('Family summer')
    expect(tagHtml).toContain('private')
    expect(tagHtml).not.toContain(`/t/${tag.publicId}`)

    // 5. The homepage widget links to the hub's tag page.
    const homePage = await request('/app', { authed: true })
    const homeHtml = await homePage.text()
    expect(homeHtml).toContain(`/app/photos/tags/${tag.id}`)
    expect(homeHtml).toContain(tagName)

    // 6. Still private: the public URL must 404 (no leak).
    const whilePrivate = await request(`/t/${tag.publicId}`)
    expect(whilePrivate.status).toBe(404)

    // 7. Mark the tag public; the tag page now offers the public link.
    const publish = await request(`/api/photos/tags/${tag.id}`, {
      method: 'PATCH',
      authed: true,
      body: { visibility: 'public' },
    })
    expect(publish.status).toBe(200)
    const publicTagHtml = await (
      await request(`/app/photos/tags/${tag.id}`, { authed: true })
    ).text()
    expect(publicTagHtml).toContain(`/t/${tag.publicId}`)

    // 8. Open the public page logged-out.
    const publicPage = await request(`/t/${tag.publicId}`) // no cookie
    expect(publicPage.status).toBe(200)
    const publicHtml = await publicPage.text()
    expect(publicHtml).toContain(tagName)
    expect(publicHtml).toContain('Family summer')
    // Album links OUT to Google Photos, hardened with rel=noopener.
    expect(publicHtml).toContain(`href="${GPHOTOS_URL}"`)
    expect(publicHtml).toMatch(/rel="noopener[^"]*"/)
    // The cover renders from storage, and the object really serves.
    const coverUrl = `${MINIO_ENDPOINT}/${BUCKET}/${key}`
    expect(publicHtml).toContain(coverUrl)

    // Share-card OG meta.
    expect(publicHtml).toMatch(
      new RegExp(`<meta property="og:title" content="${tagName}[^"]*"`),
    )
    expect(publicHtml).toContain('<meta property="og:description"')
    expect(publicHtml).toContain(`property="og:url" content="${BASE_URL}/t/`)
    expect(publicHtml).toContain(`property="og:image" content="${coverUrl}"`)
    expect(publicHtml).toContain('name="twitter:card"')

    // Pure SSR public page — no islands, nothing editable.
    expect(publicHtml).not.toContain('astro-island')

    // 9. Back to private — the public URL 404s again (revoke).
    const unpublish = await request(`/api/photos/tags/${tag.id}`, {
      method: 'PATCH',
      authed: true,
      body: { visibility: 'private' },
    })
    expect(unpublish.status).toBe(200)
    const afterUnpublish = await request(`/t/${tag.publicId}`)
    expect(afterUnpublish.status).toBe(404)
  }, 60_000)

  it('404s unknown public ids without leaking anything', async () => {
    const response = await request('/t/definitely-not-a-real-id')
    expect(response.status).toBe(404)
  })
})
