import type { APIContext } from 'astro'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signValue } from '../src/lib/auth/cookie'
import { validateSession } from '../src/lib/auth/session'
import { onRequest } from '../src/middleware'
import { env } from './helpers/stub-cloudflare-workers'

// The middleware's DB / session dependencies are mocked: these tests cover
// the middleware's own behavior (cookie → locals.user resolution, /app
// gating, resilience to session-validation failures), not session logic.
vi.mock('../src/db', () => ({ getAppDb: vi.fn(() => ({})) }))
vi.mock('../src/lib/auth/session', () => ({ validateSession: vi.fn() }))

const validateSessionMock = vi.mocked(validateSession)

function createContext(path: string, sessionCookie?: string): APIContext {
  const context = {
    locals: { user: undefined },
    cookies: {
      has: (name: string) => sessionCookie !== undefined && name === 'session',
      get: (name: string) =>
        sessionCookie !== undefined && name === 'session'
          ? { value: sessionCookie }
          : undefined,
    },
    url: new URL(`http://localhost${path}`),
    redirect: (location: string, status = 302) =>
      new Response(null, { status, headers: { location } }),
  }
  return context as unknown as APIContext
}

const next = () => Promise.resolve(new Response('page content'))

async function signedSessionCookie(): Promise<string> {
  return signValue(env.SESSION_SECRET, 'some-session-token')
}

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('middleware', () => {
  it('resolves the session cookie into locals.user', async () => {
    const user = { id: 1, email: 'user@example.com' }
    validateSessionMock.mockResolvedValueOnce(user as never)
    const context = createContext('/', await signedSessionCookie())

    const response = await onRequest(context, next)

    expect(context.locals.user).toBe(user)
    expect(response?.status).toBe(200)
  })

  it('renders public pages logged out when session validation throws', async () => {
    validateSessionMock.mockRejectedValueOnce(new Error('db is down'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const context = createContext('/', await signedSessionCookie())

    const response = await onRequest(context, next)

    expect(context.locals.user).toBeNull()
    expect(response?.status).toBe(200)
    expect(await response?.text()).toBe('page content')
    expect(consoleError).toHaveBeenCalledOnce()
  })

  it('redirects /app to login when session validation throws', async () => {
    validateSessionMock.mockRejectedValueOnce(new Error('db is down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const context = createContext('/app', await signedSessionCookie())

    const response = await onRequest(context, next)

    expect(context.locals.user).toBeNull()
    expect(response?.status).toBe(302)
    expect(response?.headers.get('location')).toBe('/api/auth/login')
  })

  it('never hits the DB without a valid signed cookie', async () => {
    const context = createContext('/app', 'tampered-cookie-value')

    const response = await onRequest(context, next)

    expect(validateSessionMock).not.toHaveBeenCalled()
    expect(response?.status).toBe(302)
    expect(response?.headers.get('location')).toBe('/api/auth/login')
  })
})
