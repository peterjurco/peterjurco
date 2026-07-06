import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type DevServerHandle, startDevServer } from './helpers/dev-server'
import { DEFAULT_DEV_DATABASE_URL } from './helpers/test-db'

const PORT = 43111
const BASE_URL = `http://localhost:${PORT}`

const ALLOWED_EMAIL = 'allowed@example.com'
const DENIED_EMAIL = 'denied@example.com'
// Mixed case on purpose — the allow-list check must be case-insensitive.
const ALLOWED_EMAILS_ENV = 'Allowed@Example.COM'

/** code → the email the stubbed Google token endpoint reports back. */
const CODE_TO_EMAIL: Record<string, string> = {
  'code-allowed': ALLOWED_EMAIL,
  'code-denied': DENIED_EMAIL,
}

const FIVE_YEARS_SECONDS = 5 * 365 * 24 * 60 * 60

let googleStub: Server | undefined
let server: DevServerHandle | undefined
const tokenRequests: URLSearchParams[] = []

function base64Url(value: string): string {
  return Buffer.from(value).toString('base64url')
}

/** Unsigned-but-well-formed ID token — decodeIdToken never verifies it. */
function makeIdToken(email: string): string {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64Url(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      sub: `google-sub-${email}`,
      email,
      name: 'E2E Test User',
      picture: 'https://example.com/avatar.png',
    }),
  )
  return `${header}.${payload}.${base64Url('stub-signature')}`
}

function handleTokenRequest(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  let body = ''
  request.on('data', (chunk) => {
    body += chunk
  })
  request.on('end', () => {
    const params = new URLSearchParams(body)
    tokenRequests.push(params)
    const email = CODE_TO_EMAIL[params.get('code') ?? '']
    if (!email) {
      response.writeHead(400, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: 'invalid_grant' }))
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(
      JSON.stringify({
        access_token: 'stub-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid email profile',
        id_token: makeIdToken(email),
      }),
    )
  })
}

/** Minimal cookie jar for driving the flow with plain fetch. */
class CookieJar {
  private cookies = new Map<string, string>()

  storeFrom(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(';')
      const separator = (pair ?? '').indexOf('=')
      if (separator === -1) continue
      const name = (pair ?? '').slice(0, separator).trim()
      const value = (pair ?? '').slice(separator + 1).trim()
      const expired = attributes.some((attribute) => {
        const separatorIndex = attribute.indexOf('=')
        if (separatorIndex === -1) return false
        const key = attribute.slice(0, separatorIndex).trim().toLowerCase()
        const attributeValue = attribute.slice(separatorIndex + 1).trim()
        if (key === 'max-age') return Number(attributeValue) <= 0
        if (key === 'expires') return new Date(attributeValue) <= new Date()
        return false
      })
      if (expired || value === '') {
        this.cookies.delete(name)
      } else {
        this.cookies.set(name, value)
      }
    }
  }

  get(name: string): string | undefined {
    return this.cookies.get(name)
  }

  set(name: string, value: string): void {
    this.cookies.set(name, value)
  }

  header(): string {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ')
  }
}

/** GET with manual redirects, sending and recording the jar's cookies. */
async function get(path: string, jar: CookieJar): Promise<Response> {
  const response = await fetch(`${BASE_URL}${path}`, {
    redirect: 'manual',
    headers: { Cookie: jar.header() },
  })
  jar.storeFrom(response)
  return response
}

/** Runs /api/auth/login and returns the state Google would echo back. */
async function startLogin(jar: CookieJar): Promise<string> {
  const response = await get('/api/auth/login', jar)
  expect(response.status).toBe(302)
  const location = new URL(response.headers.get('location') ?? '')
  expect(location.origin + location.pathname).toBe(
    'https://accounts.google.com/o/oauth2/v2/auth',
  )
  const state = location.searchParams.get('state')
  expect(state).toBeTruthy()
  if (!state) throw new Error('unreachable')
  return state
}

beforeAll(async () => {
  // Stub of Google's token endpoint — the ONLY Google interaction the
  // callback performs. Everything else (redirects, cookies, DB) is real.
  googleStub = createServer(handleTokenRequest)
  await new Promise<void>((resolve) =>
    googleStub?.listen(0, '127.0.0.1', resolve),
  )
  const stubPort = (googleStub?.address() as AddressInfo).port

  server = await startDevServer({
    port: PORT,
    vars: {
      DATABASE_URL: DEFAULT_DEV_DATABASE_URL,
      SESSION_SECRET: 'e2e-session-secret-32-characters!!',
      GOOGLE_CLIENT_ID: 'e2e-client-id',
      GOOGLE_CLIENT_SECRET: 'e2e-client-secret',
      GOOGLE_REDIRECT_URI: `${BASE_URL}/api/auth/callback`,
      AUTH_ALLOWED_EMAILS: ALLOWED_EMAILS_ENV,
      AUTH_TOKEN_ENDPOINT: `http://127.0.0.1:${stubPort}/token`,
    },
  })
}, 120_000)

afterAll(async () => {
  server?.stop()
  await new Promise((resolve) => googleStub?.close(resolve))
})

describe('auth e2e (running dev server, stubbed Google)', () => {
  it('logs an allow-listed user in, keeps them signed in, and logs them out', async () => {
    const jar = new CookieJar()

    // 1. Unauthenticated /app redirects to login (subpaths too).
    let response = await get('/app', jar)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/api/auth/login')
    response = await get('/app/anything', jar)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/api/auth/login')

    // 2. Login redirects to Google with identity-only scopes + PKCE.
    response = await get('/api/auth/login', jar)
    expect(response.status).toBe(302)
    const authorizeUrl = new URL(response.headers.get('location') ?? '')
    const scopes = (authorizeUrl.searchParams.get('scope') ?? '')
      .split(/\s+/)
      .sort()
    expect(scopes).toEqual(['email', 'openid', 'profile'])
    expect(authorizeUrl.searchParams.get('code_challenge')).toBeTruthy()
    const state = authorizeUrl.searchParams.get('state')
    if (!state) throw new Error('no state in authorize URL')
    expect(jar.get('oauth_state')).toBeTruthy()
    expect(jar.get('oauth_verifier')).toBeTruthy()

    // 3. Callback exchanges the code, sets the signed session cookie.
    response = await get(
      `/api/auth/callback?code=code-allowed&state=${encodeURIComponent(state)}`,
      jar,
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/app')
    const sessionSetCookie = response.headers
      .getSetCookie()
      .find((header) => header.startsWith('session='))
    expect(sessionSetCookie).toBeDefined()
    if (!sessionSetCookie) throw new Error('unreachable')
    expect(sessionSetCookie).toContain('HttpOnly')
    expect(sessionSetCookie).toContain('Secure')
    expect(sessionSetCookie).toMatch(/SameSite=Lax/i)
    expect(sessionSetCookie).toContain('Path=/')
    expect(sessionSetCookie).toContain(`Max-Age=${FIVE_YEARS_SECONDS}`)

    // The code exchange really used PKCE against the stub.
    const tokenRequest = tokenRequests.at(-1)
    expect(tokenRequest?.get('grant_type')).toBe('authorization_code')
    expect(tokenRequest?.get('code_verifier')).toBeTruthy()

    // 4. /app renders the signed-in user.
    response = await get('/app', jar)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain(ALLOWED_EMAIL)
    expect(html).toContain('/api/auth/logout')

    // 5. Logout clears the cookie and revokes the session server-side.
    const sessionCookie = jar.get('session')
    if (!sessionCookie) throw new Error('no session cookie in jar')
    response = await get('/api/auth/logout', jar)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/')
    expect(jar.get('session')).toBeUndefined()

    // 6. /app redirects again…
    response = await get('/app', jar)
    expect(response.status).toBe(302)

    // 7. …even when replaying the old cookie — the session is revoked in
    // the DB, not merely dropped from the browser.
    jar.set('session', sessionCookie)
    response = await get('/app', jar)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/api/auth/login')
  }, 60_000)

  it('rejects a non-allow-listed Google account with 403', async () => {
    const jar = new CookieJar()
    const state = await startLogin(jar)

    const response = await get(
      `/api/auth/callback?code=code-denied&state=${encodeURIComponent(state)}`,
      jar,
    )
    expect(response.status).toBe(403)
    expect(jar.get('session')).toBeUndefined()

    // Still locked out.
    const app = await get('/app', jar)
    expect(app.status).toBe(302)
  }, 60_000)

  it('rejects a callback with a mismatched state', async () => {
    const jar = new CookieJar()
    await startLogin(jar)

    const response = await get(
      '/api/auth/callback?code=code-allowed&state=forged-state',
      jar,
    )
    expect(response.status).toBe(400)
    expect(jar.get('session')).toBeUndefined()
  }, 60_000)
})
