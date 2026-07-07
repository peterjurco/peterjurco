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
