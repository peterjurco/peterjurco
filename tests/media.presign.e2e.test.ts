import { AwsClient } from 'aws4fetch'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { users } from '../src/db/schema'
import { signValue } from '../src/lib/auth/cookie'
import { createSession } from '../src/lib/auth/session'
import { MAX_UPLOAD_BYTES } from '../src/lib/media/r2'
import { type DevServerHandle, startDevServer } from './helpers/dev-server'
import { createTestDb, DEFAULT_DEV_DATABASE_URL } from './helpers/test-db'

/**
 * Presigned-upload flow against a real S3 API (MinIO from
 * docker-compose.test.yml, standing in for R2 via R2_ENDPOINT).
 */

const PORT = 43114
const BASE_URL = `http://localhost:${PORT}`
const SESSION_SECRET = 'presign-e2e-secret-32-characters!'

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

async function presign(
  body: unknown,
  { authed = true }: { authed?: boolean } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    Origin: BASE_URL,
    'Content-Type': 'application/json',
  }
  if (authed) headers.Cookie = `session=${sessionCookie}`
  return fetch(`${BASE_URL}/api/media/presign`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
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
      googleSub: `presign-e2e-${Date.now()}`,
      email: 'owner@example.com',
      name: 'Presign E2E Owner',
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

describe('POST /api/media/presign', () => {
  it('requires auth', async () => {
    const response = await presign(
      { contentType: 'image/jpeg', size: 1024, filename: 'a.jpg' },
      { authed: false },
    )
    expect(response.status).toBe(401)
  })

  it('rejects non-image content types', async () => {
    for (const contentType of [
      'application/pdf',
      'text/html',
      'image/svg+xml',
      '',
      undefined,
    ]) {
      const response = await presign({
        contentType,
        size: 1024,
        filename: 'a.bin',
      })
      expect(response.status, String(contentType)).toBe(400)
    }
  })

  it('rejects missing, non-positive or oversize declared sizes', async () => {
    for (const size of [undefined, 0, -5, 1.5, MAX_UPLOAD_BYTES + 1]) {
      const response = await presign({
        contentType: 'image/jpeg',
        size,
        filename: 'a.jpg',
      })
      expect(response.status, String(size)).toBe(400)
    }
    const atCap = await presign({
      contentType: 'image/jpeg',
      size: MAX_UPLOAD_BYTES,
      filename: 'a.jpg',
    })
    expect(atCap.status).toBe(200)
  })

  it('mints a URL that stores bytes retrievable with a signed GET', async () => {
    const response = await presign({
      contentType: 'image/png',
      size: 9,
      filename: 'Cover Photo.PNG',
    })
    expect(response.status).toBe(200)
    const { url, key } = (await response.json()) as { url: string; key: string }
    expect(key).toMatch(/^covers\/[A-Za-z0-9_-]{21}\.png$/)
    expect(url).toContain(`/${BUCKET}/${key}`)
    expect(url).toContain('X-Amz-Signature=')

    // Anyone holding the URL can PUT — no extra credentials.
    const put = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: 'png-bytes',
    })
    expect(put.status).toBe(200)

    // The object landed in the bucket — read it back with a signed GET.
    const get = await minio.fetch(`${MINIO_ENDPOINT}/${BUCKET}/${key}`)
    expect(get.status).toBe(200)
    expect(await get.text()).toBe('png-bytes')
  })
})
