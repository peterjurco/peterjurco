import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { users } from '../src/db/schema'
import { createCategory, getById } from '../src/lib/articles/repo'
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
      {}, // no updatable fields
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
    // Content patch — existence proven by updateArticle's returning().
    const missing = await request('/api/articles/999999', {
      method: 'PATCH',
      authed: true,
      body: { title: 'ghost' },
    })
    expect(missing.status).toBe(404)

    // Metadata-only patch — existence needs its own probe.
    const missingMeta = await request('/api/articles/999999', {
      method: 'PATCH',
      authed: true,
      body: { visibility: 'public' },
    })
    expect(missingMeta.status).toBe(404)

    for (const badId of ['not-a-number', '1.5', '1e3', '-1']) {
      const bad = await request(`/api/articles/${badId}`, {
        method: 'PATCH',
        authed: true,
        body: { title: 'x' },
      })
      expect(bad.status, badId).toBe(400)
    }
  })

  it('supports the full authoring + public-by-link sharing loop', async () => {
    // 1. Create as the authed owner, write content ("type"), set a title.
    const id = await createArticleViaApi()
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Shared e2e thoughts, ' },
            { type: 'text', text: 'boldly', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    }
    const write = await request(`/api/articles/${id}`, {
      method: 'PATCH',
      authed: true,
      body: { title: 'Sharing loop', content },
    })
    expect(write.status).toBe(200)

    // 2. "Reload" — the editor page serves the persisted content back.
    const editorPage = await request(`/app/articles/${id}`, { authed: true })
    expect(editorPage.status).toBe(200)
    const editorHtml = await editorPage.text()
    expect(editorHtml).toContain('Shared e2e thoughts')
    expect(editorHtml).toContain('Sharing loop')

    // 3. Set category + tags; the list page reflects them.
    const category = await createCategory(db, `essays-${id}`)
    const meta = await request(`/api/articles/${id}`, {
      method: 'PATCH',
      authed: true,
      body: { categoryId: category.id, tags: ['e2e', 'sharing'] },
    })
    expect(meta.status).toBe(200)
    const stored = await getById(db, id)
    expect(stored?.categoryId).toBe(category.id)
    expect(stored?.tags.map((tag) => tag.name).sort()).toEqual([
      'e2e',
      'sharing',
    ])
    const listPage = await request('/app/articles', { authed: true })
    expect(listPage.status).toBe(200)
    const listHtml = await listPage.text()
    expect(listHtml).toContain('Sharing loop')
    expect(listHtml).toContain(`essays-${id}`)

    const publicId = stored?.publicId
    if (!publicId) throw new Error('article has no public id')
    expect(publicId).toMatch(/^[A-Za-z0-9_-]{21}$/)

    // 4. Still private: the public URL must 404 (no leak).
    const whilePrivate = await request(`/a/${publicId}`)
    expect(whilePrivate.status).toBe(404)

    // 5. Toggle public; open the link logged-out.
    const publish = await request(`/api/articles/${id}`, {
      method: 'PATCH',
      authed: true,
      body: { visibility: 'public' },
    })
    expect(publish.status).toBe(200)

    const publicPage = await request(`/a/${publicId}`) // no cookie
    expect(publicPage.status).toBe(200)
    const publicHtml = await publicPage.text()

    // Rendered content, not editor JSON: real markup from renderDoc.
    expect(publicHtml).toContain('Shared e2e thoughts')
    expect(publicHtml).toContain('<strong>boldly</strong>')
    expect(publicHtml).toContain('Sharing loop')

    // Correct preview card: og:title + og:description (+ twitter fallbacks).
    expect(publicHtml).toMatch(
      /<meta property="og:title" content="Sharing loop"/,
    )
    expect(publicHtml).toMatch(
      /<meta property="og:description" content="[^"]*Shared e2e thoughts[^"]*"/,
    )
    expect(publicHtml).toContain('name="twitter:card"')

    // Pure SSR read view: no editor island, no toolbar, nothing editable.
    expect(publicHtml).not.toContain('astro-island')
    expect(publicHtml).not.toContain('editor-toolbar')
    expect(publicHtml).not.toContain('contenteditable')
    expect(publicHtml).not.toContain('role="toolbar"')

    // 6. Back to private — the public URL 404s again.
    const unpublish = await request(`/api/articles/${id}`, {
      method: 'PATCH',
      authed: true,
      body: { visibility: 'private' },
    })
    expect(unpublish.status).toBe(200)
    const afterUnpublish = await request(`/a/${publicId}`)
    expect(afterUnpublish.status).toBe(404)
  }, 60_000)

  it('serves the editor page only to the owner', async () => {
    const id = await createArticleViaApi()
    const anonymous = await request(`/app/articles/${id}`)
    expect(anonymous.status).toBe(302)
    expect(anonymous.headers.get('location')).toBe('/api/auth/login')
  })

  it('creates and redirects via the new-article form (POST only)', async () => {
    const viaGet = await request('/app/articles/new', { authed: true })
    expect(viaGet.status).toBe(302)
    expect(viaGet.headers.get('location')).toBe('/app/articles')

    const viaPost = await request('/app/articles/new', {
      method: 'POST',
      authed: true,
    })
    expect(viaPost.status).toBe(302)
    expect(viaPost.headers.get('location')).toMatch(/^\/app\/articles\/\d+$/)
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
