import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { users } from '../src/db/schema'
import { getById } from '../src/lib/articles/repo'
import { signValue } from '../src/lib/auth/cookie'
import { createSession } from '../src/lib/auth/session'
import { type DevServerHandle, startDevServer } from './helpers/dev-server'
import { createTestDb, DEFAULT_DEV_DATABASE_URL } from './helpers/test-db'

const PORT = 43112
const BASE_URL = `http://localhost:${PORT}`
const SESSION_SECRET = 'articles-e2e-secret-32-characters!'

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

async function createArticleViaApi(): Promise<number> {
  const response = await request('/api/articles', {
    method: 'POST',
    authed: true,
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
      googleSub: `articles-e2e-${Date.now()}`,
      email: 'owner@example.com',
      name: 'Articles E2E Owner',
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

describe('articles API — auth is enforced in every handler', () => {
  it('rejects unauthenticated create / patch / delete with 401 JSON', async () => {
    for (const [path, method] of [
      ['/api/articles', 'POST'],
      ['/api/articles/1', 'PATCH'],
      ['/api/articles/1', 'DELETE'],
    ] as const) {
      const response = await request(path, { method, body: {} })
      expect(response.status, `${method} ${path}`).toBe(401)
      const payload = (await response.json()) as { error: string }
      expect(payload.error).toBeTruthy()
    }
  })

  it('rejects a tampered session cookie', async () => {
    const response = await fetch(`${BASE_URL}/api/articles`, {
      method: 'POST',
      headers: { Origin: BASE_URL, Cookie: 'session=forged.signature' },
    })
    expect(response.status).toBe(401)
  })
})

describe('articles API — owner CRUD', () => {
  it('creates an empty article and returns its id', async () => {
    const id = await createArticleViaApi()
    expect(id).toBeGreaterThan(0)
  })

  it('persists autosaved content and title via PATCH', async () => {
    const id = await createArticleViaApi()
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Autosaved words' }],
        },
      ],
    }
    const patch = await request(`/api/articles/${id}`, {
      method: 'PATCH',
      authed: true,
      body: { title: 'My title', content },
    })
    expect(patch.status).toBe(200)

    // Persisted for real — read back through the repo against the same DB.
    const stored = await getById(db, id)
    expect(stored?.title).toBe('My title')
    expect(stored?.content).toEqual(content)
  })

  it('rejects malformed PATCH bodies with 400', async () => {
    const id = await createArticleViaApi()
    for (const body of [
      { title: 42 },
      { content: 'not a doc' },
      { visibility: 'friends-only' },
      { tags: 'not-an-array' },
      { categoryId: 'one' },
      { isFeatured: 'yes' },
    ]) {
      const response = await request(`/api/articles/${id}`, {
        method: 'PATCH',
        authed: true,
        body,
      })
      expect(response.status, JSON.stringify(body)).toBe(400)
    }
  })

  it('404s a PATCH to a missing article and 400s a bad id', async () => {
    const missing = await request('/api/articles/999999', {
      method: 'PATCH',
      authed: true,
      body: { title: 'ghost' },
    })
    expect(missing.status).toBe(404)

    const bad = await request('/api/articles/not-a-number', {
      method: 'PATCH',
      authed: true,
      body: { title: 'x' },
    })
    expect(bad.status).toBe(400)
  })

  it('deletes an article', async () => {
    const id = await createArticleViaApi()
    const del = await request(`/api/articles/${id}`, {
      method: 'DELETE',
      authed: true,
    })
    expect(del.status).toBe(200)

    const again = await request(`/api/articles/${id}`, {
      method: 'PATCH',
      authed: true,
      body: { title: 'gone' },
    })
    expect(again.status).toBe(404)
  })
})
