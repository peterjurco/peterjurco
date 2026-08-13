import { rmSync } from 'node:fs'
import { AwsClient } from 'aws4fetch'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  isOwnedUrl,
  loadRehostCache,
  MAX_VIDEO_UPLOAD_BYTES,
  rehostImage,
  rehostVideo,
  saveRehostCache,
} from '../../scripts/migrate-wp/rehost-image'
import type { R2Env } from '../../src/lib/media/r2'
import { MAX_UPLOAD_BYTES } from '../../src/lib/media/r2'

/**
 * Exercises rehost-image.ts against real MinIO (docker-compose.test.yml,
 * standing in for R2 — same convention as tests/media.presign.e2e.test.ts).
 * The "source" fetch (the old WP site) is mocked via an injected
 * `fetchSource`, since that's someone else's server, not ours to hit in
 * tests — the R2 upload path is real.
 */

const MINIO_ENDPOINT = 'http://localhost:9000'
const BUCKET = 'peterjurco-test'
const OWNED_HOST = 'peterjur.co'

const env: R2Env = {
  R2_ACCOUNT_ID: 'unused-local',
  R2_ACCESS_KEY_ID: 'minioadmin',
  R2_SECRET_ACCESS_KEY: 'minioadmin',
  R2_BUCKET: BUCKET,
  R2_ENDPOINT: MINIO_ENDPOINT,
}

const minio = new AwsClient({
  accessKeyId: 'minioadmin',
  secretAccessKey: 'minioadmin',
  service: 's3',
  region: 'auto',
})

beforeAll(async () => {
  const bucket = await minio.fetch(`${MINIO_ENDPOINT}/${BUCKET}`, {
    method: 'PUT',
  })
  if (!bucket.ok && bucket.status !== 409) {
    throw new Error(
      `MinIO bucket create failed (${bucket.status}) — is MinIO up? ` +
        'docker compose -f docker-compose.test.yml up -d',
    )
  }
})

function fakeImageResponse(
  bytes: Uint8Array,
  contentType = 'image/jpeg',
): Response {
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: { 'content-type': contentType },
  })
}

async function getFromMinio(key: string): Promise<Response> {
  return minio.fetch(`${MINIO_ENDPOINT}/${BUCKET}/${key}`)
}

describe('isOwnedUrl', () => {
  it('matches the exact owned hostname', () => {
    expect(
      isOwnedUrl('https://peterjur.co/wp-content/uploads/a.jpg', OWNED_HOST),
    ).toBe(true)
    expect(isOwnedUrl('http://peterjur.co/x.png', OWNED_HOST)).toBe(true)
  })

  it('matches a www. variant', () => {
    expect(
      isOwnedUrl(
        'https://www.peterjur.co/wp-content/uploads/a.jpg',
        OWNED_HOST,
      ),
    ).toBe(true)
  })

  it('rejects other hostnames', () => {
    expect(isOwnedUrl('https://example.com/a.jpg', OWNED_HOST)).toBe(false)
    expect(isOwnedUrl('https://evilpeterjur.co/a.jpg', OWNED_HOST)).toBe(false)
    expect(
      isOwnedUrl('https://notpeterjur.co.evil.com/a.jpg', OWNED_HOST),
    ).toBe(false)
  })

  it('rejects malformed URLs without throwing', () => {
    expect(isOwnedUrl('not-a-url', OWNED_HOST)).toBe(false)
  })
})

describe('rehostImage', () => {
  it('fetches, uploads to R2 and returns a migrated/ key', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const fetchSource = vi.fn().mockResolvedValue(fakeImageResponse(bytes))
    const cache = new Map<string, string | null>()

    const key = await rehostImage(
      env,
      'https://peterjur.co/wp-content/uploads/2020/photo.jpg',
      { ownedHost: OWNED_HOST, cache, fetchSource },
    )

    expect(key).toMatch(/^migrated\/[A-Za-z0-9_-]{21}\.jpg$/)
    expect(fetchSource).toHaveBeenCalledTimes(1)

    const stored = await getFromMinio(key as string)
    expect(stored.status).toBe(200)
    expect(new Uint8Array(await stored.arrayBuffer())).toEqual(bytes)
  })

  it('dedupes: the same source URL is fetched only once per cache', async () => {
    const bytes = new Uint8Array([9, 9, 9])
    const fetchSource = vi.fn().mockResolvedValue(fakeImageResponse(bytes))
    const cache = new Map<string, string | null>()
    const url = 'https://peterjur.co/wp-content/uploads/dedupe.jpg'

    const first = await rehostImage(env, url, {
      ownedHost: OWNED_HOST,
      cache,
      fetchSource,
    })
    const second = await rehostImage(env, url, {
      ownedHost: OWNED_HOST,
      cache,
      fetchSource,
    })

    expect(second).toBe(first)
    expect(fetchSource).toHaveBeenCalledTimes(1)
  })

  it('never attempts a fetch for an external (non-owned) domain', async () => {
    const fetchSource = vi.fn()
    const cache = new Map<string, string | null>()

    const key = await rehostImage(env, 'https://example.com/photo.jpg', {
      ownedHost: OWNED_HOST,
      cache,
      fetchSource,
    })

    expect(key).toBeNull()
    expect(fetchSource).not.toHaveBeenCalled()
  })

  it('returns null (never throws) when the fetch fails, and caches the failure', async () => {
    const fetchSource = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const cache = new Map<string, string | null>()
    const url = 'https://peterjur.co/wp-content/uploads/missing.jpg'

    const key = await rehostImage(env, url, {
      ownedHost: OWNED_HOST,
      cache,
      fetchSource,
    })
    expect(key).toBeNull()

    // Cached as a known failure — a second call doesn't retry the fetch.
    const second = await rehostImage(env, url, {
      ownedHost: OWNED_HOST,
      cache,
      fetchSource,
    })
    expect(second).toBeNull()
    expect(fetchSource).toHaveBeenCalledTimes(1)
  })

  it('returns null on a non-2xx response without throwing', async () => {
    const fetchSource = vi
      .fn()
      .mockResolvedValue(new Response('not found', { status: 404 }))
    const cache = new Map<string, string | null>()

    const key = await rehostImage(
      env,
      'https://peterjur.co/wp-content/uploads/404.jpg',
      { ownedHost: OWNED_HOST, cache, fetchSource },
    )
    expect(key).toBeNull()
  })

  it('rejects a disallowed content type without uploading', async () => {
    const fetchSource = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1]) as BodyInit, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )
    const cache = new Map<string, string | null>()

    const key = await rehostImage(
      env,
      'https://peterjur.co/wp-content/uploads/oops.html',
      { ownedHost: OWNED_HOST, cache, fetchSource },
    )
    expect(key).toBeNull()
  })

  it('rejects a response over MAX_UPLOAD_BYTES without uploading', async () => {
    const oversized = new Uint8Array(MAX_UPLOAD_BYTES + 1)
    const fetchSource = vi.fn().mockResolvedValue(fakeImageResponse(oversized))
    const cache = new Map<string, string | null>()

    const key = await rehostImage(
      env,
      'https://peterjur.co/wp-content/uploads/huge.jpg',
      { ownedHost: OWNED_HOST, cache, fetchSource },
    )
    expect(key).toBeNull()
  })

  it('accepts a response exactly at MAX_UPLOAD_BYTES', async () => {
    const atCap = new Uint8Array(MAX_UPLOAD_BYTES)
    const fetchSource = vi.fn().mockResolvedValue(fakeImageResponse(atCap))
    const cache = new Map<string, string | null>()

    const key = await rehostImage(
      env,
      'https://peterjur.co/wp-content/uploads/at-cap.jpg',
      { ownedHost: OWNED_HOST, cache, fetchSource },
    )
    expect(key).not.toBeNull()
  }, 20_000)
})

describe('rehostVideo', () => {
  it('fetches, uploads to R2 and returns a migrated/ key for a video/mp4 file', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    const fetchSource = vi
      .fn()
      .mockResolvedValue(fakeImageResponse(bytes, 'video/mp4'))
    const cache = new Map<string, string | null>()

    const key = await rehostVideo(
      env,
      'https://peterjur.co/wp-content/uploads/2022/12/clip.mov',
      { ownedHost: OWNED_HOST, cache, fetchSource },
    )

    expect(key).toMatch(/^migrated\/[A-Za-z0-9_-]{21}\.mov$/)
    const stored = await getFromMinio(key as string)
    expect(stored.status).toBe(200)
    expect(new Uint8Array(await stored.arrayBuffer())).toEqual(bytes)
  })

  it('accepts video/quicktime and video/x-matroska — the real WP export uses both', async () => {
    for (const contentType of ['video/quicktime', 'video/x-matroska']) {
      const fetchSource = vi
        .fn()
        .mockResolvedValue(fakeImageResponse(new Uint8Array([1]), contentType))
      const key = await rehostVideo(
        env,
        `https://peterjur.co/wp-content/uploads/${contentType}.bin`,
        { ownedHost: OWNED_HOST, cache: new Map(), fetchSource },
      )
      expect(key, contentType).not.toBeNull()
    }
  })

  it('rejects an image content-type — the image/video allowlists are separate', async () => {
    const fetchSource = vi
      .fn()
      .mockResolvedValue(fakeImageResponse(new Uint8Array([1]), 'image/jpeg'))

    const key = await rehostVideo(
      env,
      'https://peterjur.co/wp-content/uploads/not-a-video.jpg',
      { ownedHost: OWNED_HOST, cache: new Map(), fetchSource },
    )
    expect(key).toBeNull()
  })

  it('accepts a file bigger than the image cap — video has its own, larger limit', async () => {
    const overImageCap = new Uint8Array(MAX_UPLOAD_BYTES + 1)
    const fetchSource = vi
      .fn()
      .mockResolvedValue(fakeImageResponse(overImageCap, 'video/mp4'))

    const key = await rehostVideo(
      env,
      'https://peterjur.co/wp-content/uploads/bigger-than-image-cap.mp4',
      { ownedHost: OWNED_HOST, cache: new Map(), fetchSource },
    )
    expect(key).not.toBeNull()
  }, 20_000)

  it('rejects a video over MAX_VIDEO_UPLOAD_BYTES without uploading', async () => {
    const oversized = new Uint8Array(MAX_VIDEO_UPLOAD_BYTES + 1)
    const fetchSource = vi
      .fn()
      .mockResolvedValue(fakeImageResponse(oversized, 'video/mp4'))

    const key = await rehostVideo(
      env,
      'https://peterjur.co/wp-content/uploads/huge.mp4',
      { ownedHost: OWNED_HOST, cache: new Map(), fetchSource },
    )
    expect(key).toBeNull()
  }, 30_000)

  it('never attempts a fetch for an external (non-owned) domain', async () => {
    const fetchSource = vi.fn()
    const key = await rehostVideo(env, 'https://example.com/clip.mp4', {
      ownedHost: OWNED_HOST,
      cache: new Map(),
      fetchSource,
    })
    expect(key).toBeNull()
    expect(fetchSource).not.toHaveBeenCalled()
  })
})

describe('loadRehostCache / saveRehostCache', () => {
  const CACHE_PATH = new URL('./.tmp-rehost-cache.json', import.meta.url)
    .pathname

  afterEach(() => {
    rmSync(CACHE_PATH, { force: true })
  })

  it('returns an empty cache when the file does not exist', () => {
    expect(loadRehostCache(CACHE_PATH).size).toBe(0)
  })

  it('round-trips across a save/reload, and a reloaded URL is never re-fetched', async () => {
    const url = 'https://peterjur.co/wp-content/uploads/persisted.jpg'
    const fetchSource = vi
      .fn()
      .mockResolvedValue(fakeImageResponse(new Uint8Array([5, 5, 5])))
    const firstRunCache = new Map<string, string | null>()

    const key = await rehostImage(env, url, {
      ownedHost: OWNED_HOST,
      cache: firstRunCache,
      fetchSource,
    })
    expect(key).not.toBeNull()
    saveRehostCache(CACHE_PATH, firstRunCache)

    // Simulates a fresh process: a brand new in-memory cache, reloaded from disk.
    const secondRunCache = loadRehostCache(CACHE_PATH)
    expect(secondRunCache.get(url)).toBe(key)

    const secondFetchSource = vi.fn()
    const secondKey = await rehostImage(env, url, {
      ownedHost: OWNED_HOST,
      cache: secondRunCache,
      fetchSource: secondFetchSource,
    })
    expect(secondKey).toBe(key)
    expect(secondFetchSource).not.toHaveBeenCalled()
  })

  it('does not persist a cached failure to disk', async () => {
    const url = 'https://peterjur.co/wp-content/uploads/will-fail.jpg'
    const fetchSource = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const cache = new Map<string, string | null>()

    const key = await rehostImage(env, url, {
      ownedHost: OWNED_HOST,
      cache,
      fetchSource,
    })
    expect(key).toBeNull()

    saveRehostCache(CACHE_PATH, cache)
    const reloaded = loadRehostCache(CACHE_PATH)
    expect(reloaded.has(url)).toBe(false)
  })
})
