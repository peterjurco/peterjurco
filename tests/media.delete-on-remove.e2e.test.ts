import { AwsClient } from 'aws4fetch'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { apps, homeTiles, photoAlbums, users } from '../src/db/schema'
import { signValue } from '../src/lib/auth/cookie'
import { createSession } from '../src/lib/auth/session'
import { type DevServerHandle, startDevServer } from './helpers/dev-server'
import { createTestDb, DEFAULT_DEV_DATABASE_URL } from './helpers/test-db'

/**
 * Proves the R2-cleanup wiring end-to-end against a REAL S3 API (MinIO from
 * docker-compose.test.yml) — not just "deleteObject was called", but that
 * the byte actually disappears from the bucket, via the same presign/GET
 * flow real uploads use. Covers all three call sites from TODO.md: home
 * tiles (full delete + single-image drop + bulk-save), photo album covers,
 * and app icons.
 */

const PORT = 43120
const BASE_URL = `http://localhost:${PORT}`
const SESSION_SECRET = 'delete-on-remove-e2e-secret-32-ch!'

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

/** Presigns + PUTs a real object into the MinIO bucket; returns its key. */
async function uploadObject(filename: string): Promise<string> {
  const presign = await request('/api/media/presign', {
    method: 'POST',
    authed: true,
    body: { contentType: 'image/png', size: 3, filename },
  })
  expect(presign.status).toBe(200)
  const { url, key } = (await presign.json()) as { url: string; key: string }

  const put = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png' },
    body: 'abc',
  })
  expect(put.status).toBe(200)
  return key
}

/** Direct-to-MinIO existence check — the ground truth, bypassing our code. */
async function existsInMinio(key: string): Promise<boolean> {
  const response = await minio.fetch(`${MINIO_ENDPOINT}/${BUCKET}/${key}`)
  return response.status === 200
}

const TILE_BASE = {
  kind: 'photo' as const,
  x: 10,
  y: 10,
  width: 20,
  height: 20,
  zIndex: 1,
}

async function createTileViaApi(overrides: Record<string, unknown>) {
  const response = await request('/api/home/tiles', {
    method: 'POST',
    authed: true,
    body: { ...TILE_BASE, ...overrides },
  })
  expect(response.status).toBe(201)
  return (await response.json()) as { id: number }
}

beforeAll(async () => {
  // The test bucket — 200 on create, 409 when a previous run already owns it.
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
      googleSub: `delete-on-remove-e2e-${Date.now()}`,
      email: 'owner@example.com',
      name: 'Delete-on-remove E2E Owner',
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

beforeEach(async () => {
  // Each test's home-tiles cases exercise PUT (full-canvas replace), so
  // tiles must not leak across tests within this file.
  await db.delete(homeTiles)
  await db.delete(photoAlbums)
  await db.delete(apps)
})

describe('home tiles — R2 cleanup', () => {
  it('deletes the image when the tile is deleted', async () => {
    const key = await uploadObject('tile.png')
    expect(await existsInMinio(key)).toBe(true)

    const { id } = await createTileViaApi({ imageKeys: [key] })

    const del = await request(`/api/home/tiles/${id}`, {
      method: 'DELETE',
      authed: true,
    })
    expect(del.status).toBe(200)
    expect(await existsInMinio(key)).toBe(false)
  })

  it('PATCH dropping one image of a multi-image tile deletes only that image', async () => {
    const keyA = await uploadObject('a.png')
    const keyB = await uploadObject('b.png')
    const { id } = await createTileViaApi({ imageKeys: [keyA, keyB] })

    const patch = await request(`/api/home/tiles/${id}`, {
      method: 'PATCH',
      authed: true,
      body: { imageKeys: [keyA] },
    })
    expect(patch.status).toBe(200)

    expect(await existsInMinio(keyA)).toBe(true)
    expect(await existsInMinio(keyB)).toBe(false)
  })

  it("bulk save (PUT) deletes a fully-removed tile's images but keeps a merely-reordered tile's images", async () => {
    const keyKeep1 = await uploadObject('keep1.png')
    const keyKeep2 = await uploadObject('keep2.png')
    const keyRemoved = await uploadObject('removed.png')

    const kept = await createTileViaApi({ imageKeys: [keyKeep1, keyKeep2] })
    await createTileViaApi({ imageKeys: [keyRemoved], zIndex: 2 })

    // The complete new canvas: only the kept tile, with its images
    // reordered — the removed tile is simply absent from the array.
    const put = await request('/api/home/tiles', {
      method: 'PUT',
      authed: true,
      body: {
        tiles: [
          {
            ...TILE_BASE,
            id: kept.id,
            imageKeys: [keyKeep2, keyKeep1],
          },
        ],
      },
    })
    expect(put.status).toBe(200)

    expect(await existsInMinio(keyKeep1)).toBe(true)
    expect(await existsInMinio(keyKeep2)).toBe(true)
    expect(await existsInMinio(keyRemoved)).toBe(false)
  })
})

describe('photo album covers — R2 cleanup', () => {
  async function createAlbumViaApi(coverImageKey: string): Promise<number> {
    const response = await request('/api/photos/albums', {
      method: 'POST',
      authed: true,
      body: {
        name: 'E2E album',
        googlePhotosUrl: 'https://photos.app.goo.gl/DeleteOnRemoveE2E',
        coverImageKey,
      },
    })
    expect(response.status).toBe(201)
    const { id } = (await response.json()) as { id: number }
    return id
  }

  it('deletes the cover when the album is deleted', async () => {
    const key = await uploadObject('cover.png')
    const id = await createAlbumViaApi(key)

    const del = await request(`/api/photos/albums/${id}`, {
      method: 'DELETE',
      authed: true,
    })
    expect(del.status).toBe(200)
    expect(await existsInMinio(key)).toBe(false)
  })

  it('PATCH replacing the cover deletes the OLD one and keeps the new one', async () => {
    const oldKey = await uploadObject('old-cover.png')
    const newKey = await uploadObject('new-cover.png')
    const id = await createAlbumViaApi(oldKey)

    const patch = await request(`/api/photos/albums/${id}`, {
      method: 'PATCH',
      authed: true,
      body: { coverImageKey: newKey },
    })
    expect(patch.status).toBe(200)

    expect(await existsInMinio(oldKey)).toBe(false)
    expect(await existsInMinio(newKey)).toBe(true)
  })
})

describe('app icons — R2 cleanup', () => {
  async function createAppViaApi(iconKey: string): Promise<number> {
    const response = await request('/api/apps', {
      method: 'POST',
      authed: true,
      body: { name: 'E2E app', url: 'https://e2e.example', iconKey },
    })
    expect(response.status).toBe(201)
    const { id } = (await response.json()) as { id: number }
    return id
  }

  it('deletes the icon when the app is deleted', async () => {
    const key = await uploadObject('icon.png')
    const id = await createAppViaApi(key)

    const del = await request(`/api/apps/${id}`, {
      method: 'DELETE',
      authed: true,
    })
    expect(del.status).toBe(200)
    expect(await existsInMinio(key)).toBe(false)
  })

  it('PATCH clearing the icon to null deletes the old one', async () => {
    const key = await uploadObject('icon2.png')
    const id = await createAppViaApi(key)

    const patch = await request(`/api/apps/${id}`, {
      method: 'PATCH',
      authed: true,
      body: { iconKey: null },
    })
    expect(patch.status).toBe(200)
    expect(await existsInMinio(key)).toBe(false)
  })
})
