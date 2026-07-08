import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { homeTiles, users } from '../src/db/schema'
import { signValue } from '../src/lib/auth/cookie'
import { createSession } from '../src/lib/auth/session'
import { listOrdered } from '../src/lib/home/repo'
import { type DevServerHandle, startDevServer } from './helpers/dev-server'
import { createTestDb, DEFAULT_DEV_DATABASE_URL } from './helpers/test-db'

// Dev-server round-trips share one compile-on-demand server — generous
// per-test budget so full-suite load never flakes a passing test.
vi.setConfig({ testTimeout: 30_000 })

const PORT = 43116
const BASE_URL = `http://localhost:${PORT}`
const SESSION_SECRET = 'home-e2e-secret-32-characters!!!!'
const IMG_BASE = 'http://localhost:9000/peterjurco-test'

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

/** A valid photo-tile create body; override per test. */
function photoBody(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'photo',
    imageKey: 'home/redhouse.webp',
    x: 2.5,
    y: 1,
    width: 48,
    height: 22.5,
    rotation: 0,
    border: null,
    hoverEffect: 'develop',
    zIndex: 1,
    cycleGroup: null,
    ...overrides,
  }
}

async function createTileViaApi(
  body: Record<string, unknown>,
): Promise<number> {
  const response = await request('/api/home/tiles', {
    method: 'POST',
    authed: true,
    body,
  })
  expect(response.status).toBe(201)
  const { id } = (await response.json()) as { id: number }
  expect(id).toBeTypeOf('number')
  return id
}

/**
 * The page's effective CSS: inline <style> blocks plus every linked
 * stylesheet (Astro dev serves imported CSS either way depending on version).
 */
async function pageCss(html: string): Promise<string> {
  let css = html
  const links = [
    ...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g),
  ].map((match) => match[1] as string)
  for (const href of links) {
    const response = await fetch(new URL(href, BASE_URL))
    if (response.ok) css += await response.text()
  }
  return css
}

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      googleSub: `home-e2e-${Date.now()}`,
      email: 'owner@example.com',
      name: 'Home E2E Owner',
    })
    .returning()
  if (!user) throw new Error('failed to insert e2e user')
  const { token } = await createSession(db, user.id)
  sessionCookie = await signValue(SESSION_SECRET, token)

  // Tile img URLs resolve straight against the base (transforms off): the
  // dev server inherits these build-time PUBLIC_ vars from process.env.
  process.env.PUBLIC_R2_PUBLIC_BASE_URL = IMG_BASE
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
      R2_BUCKET: 'peterjurco-test',
      R2_ENDPOINT: 'http://localhost:9000',
    },
  })
}, 120_000)

beforeEach(async () => {
  await db.delete(homeTiles)
})

afterAll(async () => {
  server?.stop()
  await close()
})

describe('home tiles API — auth is enforced in every handler', () => {
  it('rejects unauthenticated calls with 401 JSON', async () => {
    for (const [path, method] of [
      ['/api/home/tiles', 'GET'],
      ['/api/home/tiles', 'POST'],
      ['/api/home/tiles', 'PUT'],
      ['/api/home/tiles/1', 'PATCH'],
      ['/api/home/tiles/1', 'DELETE'],
    ] as const) {
      const response = await request(path, {
        method,
        ...(method === 'GET' || method === 'DELETE' ? {} : { body: {} }),
      })
      expect(response.status, `${method} ${path}`).toBe(401)
      const payload = (await response.json()) as { error: string }
      expect(payload.error).toBeTruthy()
    }
  })

  it('gates the editor page behind login', async () => {
    const response = await request('/app/home-editor')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/api/auth/login')
  })

  it('serves the editor page to the owner', async () => {
    const response = await request('/app/home-editor', { authed: true })
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('Home canvas')
  })
})

describe('home tiles API — validation', () => {
  it('rejects invalid tiles with 400', async () => {
    for (const body of [
      photoBody({ kind: 'headline' }),
      photoBody({ imageKey: null }), // photo without image
      photoBody({ hoverEffect: 'warm' }), // rejected DESIGN direction
      photoBody({ rotation: 90 }),
      photoBody({ width: 0 }),
      photoBody({ x: 500 }),
      photoBody({ zIndex: 1.5 }),
      photoBody({ border: { width: 4 } }),
      { kind: 'quote', x: 0, y: 0, width: 10, height: 10, zIndex: 1 }, // no text
    ]) {
      const response = await request('/api/home/tiles', {
        method: 'POST',
        authed: true,
        body,
      })
      expect(response.status, JSON.stringify(body)).toBe(400)
    }
  })

  it('rejects an invalid bulk payload naming the offending tile', async () => {
    const response = await request('/api/home/tiles', {
      method: 'PUT',
      authed: true,
      body: { tiles: [photoBody(), photoBody({ rotation: 90 })] },
    })
    expect(response.status).toBe(400)
    const { error } = (await response.json()) as { error: string }
    expect(error).toContain('tiles[1]')
  })

  it('404s missing tiles and 400s bad ids', async () => {
    const missing = await request('/api/home/tiles/999999', {
      method: 'PATCH',
      authed: true,
      body: { x: 1 },
    })
    expect(missing.status).toBe(404)
    const badId = await request('/api/home/tiles/nope', {
      method: 'DELETE',
      authed: true,
    })
    expect(badId.status).toBe(400)
  })
})

describe('public homepage — canvas render from stored layout', () => {
  it('renders seeded tiles with layout, DESIGN treatments, masthead, socials and OG meta', async () => {
    await createTileViaApi(
      photoBody({ border: { width: 4, color: '#f0e7d3' } }),
    )
    await createTileViaApi({
      kind: 'quote',
      textContent: 'Everything has led to this',
      cite: '— on the road, somewhere north',
      x: 60,
      y: 10,
      width: 30,
      height: 15,
      rotation: -1.6,
      zIndex: 5,
    })
    await createTileViaApi({
      kind: 'quote',
      textContent: 'The best camera is the one you have with you',
      cite: null,
      x: 10,
      y: 40,
      width: 40,
      height: 10,
      rotation: 1.3,
      zIndex: 6,
    })

    const response = await request('/') // logged out
    expect(response.status).toBe(200)
    const html = await response.text()

    // Masthead + ground.
    expect(html).toContain('class="public-home"')
    expect(html).toContain('Peter Jurčo')

    // The photo tile: absolutely positioned, Develop hover, border, no tilt.
    expect(html).toContain('class="tile photo develop"')
    expect(html).toMatch(
      /left:2\.5%;top:1%;width:48%;height:22\.5%;--tilt:0deg;z-index:1;border:4px solid #f0e7d3/,
    )
    expect(html).toContain(`${IMG_BASE}/home/redhouse.webp`)

    // The cited quote is the tilted marquee; the uncited one is ink.
    expect(html).toContain('class="tile marquee"')
    expect(html).toContain('Everything has led to this')
    expect(html).toContain('— on the road, somewhere north')
    expect(html).toContain('--tilt:-1.6deg')
    expect(html).toContain('class="tile quote-ink"')
    expect(html).toContain('--tilt:1.3deg')

    // Footer socials (DESIGN list) and no menu.
    for (const label of [
      'Instagram',
      'LinkedIn',
      'Goodreads',
      'Last.fm',
      'Strava',
      'GitHub',
      'Email',
    ]) {
      expect(html).toContain(`>${label}</a>`)
    }

    // OG meta — og:image absolute, derived from the first photo tile.
    expect(html).toContain('<meta property="og:title" content="Peter Jurčo"')
    expect(html).toContain('<meta property="og:description"')
    expect(html).toContain(`property="og:url" content="${BASE_URL}/"`)
    expect(html).toContain(
      `property="og:image" content="${IMG_BASE}/home/redhouse.webp"`,
    )
    expect(html).toContain('name="twitter:card"')

    // No cycle groups → pure SSR, zero islands, no editor code.
    expect(html).not.toContain('astro-island')
    expect(html).not.toContain('CanvasEditor')

    // The locked visual language ships: Develop filter values, the slow
    // 1s filter transition, and the reduced-motion escape hatch.
    const css = await pageCss(html)
    expect(css).toContain('saturate(0.74) contrast(0.94) brightness(0.98)')
    expect(css).toContain('saturate(1.08) contrast(1.04) brightness(1.03)')
    expect(css).toContain('transition: filter 1s ease')
    expect(css).toContain('prefers-reduced-motion')
  })

  it('mounts the CycleGroup island only when a cycle_group exists', async () => {
    await createTileViaApi(photoBody({ cycleGroup: 'north', zIndex: 2 }))
    await createTileViaApi(
      photoBody({
        imageKey: 'home/earth.webp',
        cycleGroup: 'north',
        zIndex: 3,
      }),
    )

    const html = await (await request('/')).text()
    // ONE island for the group container — both layers inside it.
    expect(html.match(/<astro-island/g)).toHaveLength(1)
    expect(html).toContain('cycle-layer')
    expect(html).toContain(`${IMG_BASE}/home/redhouse.webp`)
    expect(html).toContain(`${IMG_BASE}/home/earth.webp`)
    // The anchor tile (lowest z) provides the layout of the group container.
    expect(html).toContain('z-index:2')
    expect(html).not.toContain('z-index:3')
  })

  it('renders an empty canvas without islands when no tiles exist', async () => {
    const response = await request('/')
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('class="public-home"')
    expect(html).not.toContain('astro-island')
    expect(html).toContain('content="summary"') // no og:image without photos
  })
})

describe('bulk save — editor round-trip', () => {
  it('PUT persists the complete canvas and the public page reflects it', async () => {
    const keepId = await createTileViaApi(photoBody())
    await createTileViaApi(photoBody({ imageKey: 'home/drop.webp', zIndex: 2 }))

    const put = await request('/api/home/tiles', {
      method: 'PUT',
      authed: true,
      body: {
        tiles: [
          // moved + retilted + hover disabled
          photoBody({ id: keepId, x: 33, rotation: 3, hoverEffect: 'none' }),
          {
            kind: 'quote',
            textContent: 'Fresh words',
            cite: '— new',
            x: 50,
            y: 50,
            width: 20,
            height: 10,
            rotation: -2,
            zIndex: 9,
          },
        ],
      },
    })
    expect(put.status).toBe(200)
    const { tiles: saved } = (await put.json()) as {
      tiles: Array<{ id: number; x: number }>
    }
    expect(saved).toHaveLength(2)

    // GET (authed) reflects the new layout…
    const list = await request('/api/home/tiles', { authed: true })
    const { tiles: listed } = (await list.json()) as {
      tiles: Array<Record<string, unknown>>
    }
    expect(listed).toHaveLength(2)
    expect(listed[0]).toMatchObject({ id: keepId, x: 33, rotation: 3 })

    // …and so does the public page: moved photo without the develop class,
    // the dropped tile gone, the new marquee present.
    const html = await (await request('/')).text()
    expect(html).toMatch(/class="tile photo"[^>]*style="left:33%/)
    expect(html).not.toContain('home/drop.webp')
    expect(html).toContain('Fresh words')

    // And the DB agrees (same repo the page renders from).
    const rows = await listOrdered(db)
    expect(rows.map((row) => row.id)).toEqual(listed.map((row) => row.id))
  })

  it('PATCH and DELETE adjust single tiles', async () => {
    const id = await createTileViaApi(photoBody())
    const patch = await request(`/api/home/tiles/${id}`, {
      method: 'PATCH',
      authed: true,
      body: { rotation: -4.5, border: { width: 2, color: '#17140f' } },
    })
    expect(patch.status).toBe(200)
    let html = await (await request('/')).text()
    expect(html).toContain('--tilt:-4.5deg')
    expect(html).toContain('border:2px solid #17140f')

    const del = await request(`/api/home/tiles/${id}`, {
      method: 'DELETE',
      authed: true,
    })
    expect(del.status).toBe(200)
    html = await (await request('/')).text()
    expect(html).not.toContain('home/redhouse.webp')
  })
})
