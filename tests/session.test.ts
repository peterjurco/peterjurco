import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sessions, users } from '../src/db/schema'
import {
  createSession,
  hashToken,
  revokeSession,
  SESSION_REFRESH_THRESHOLD_MS,
  SESSION_TTL_MS,
  validateSession,
} from '../src/lib/auth/session'
import { createTestDb } from './helpers/test-db'

const { db, close } = createTestDb()

const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000
// Clock tolerance for "≈ now + TTL" assertions (DB round-trips, etc.).
const TOLERANCE_MS = 10_000

let userId: number

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      googleSub: `session-test-${crypto.randomUUID()}`,
      email: 'session-test@example.com',
      name: 'Session Test',
    })
    .returning()
  if (!user) throw new Error('failed to insert test user')
  userId = user.id
})

afterAll(async () => {
  try {
    await db.delete(sessions).where(eq(sessions.userId, userId))
    await db.delete(users).where(eq(users.id, userId))
  } finally {
    await close()
  }
})

async function findSessionByToken(token: string) {
  return db.query.sessions.findFirst({
    where: eq(sessions.tokenHash, await hashToken(token)),
  })
}

describe('createSession', () => {
  it('returns a plaintext token and stores only its SHA-256 hash', async () => {
    const { token } = await createSession(db, userId)
    expect(token.length).toBeGreaterThanOrEqual(32)

    const row = await findSessionByToken(token)
    expect(row).toBeDefined()
    if (!row) throw new Error('unreachable')
    expect(row.userId).toBe(userId)
    // Only the hash is persisted — never the plaintext token.
    expect(row.tokenHash).toBe(await hashToken(token))
    expect(row.tokenHash).not.toBe(token)
    expect(row.tokenHash).not.toContain(token)
    expect(row.revokedAt).toBeNull()
  })

  it('sets expires_at ≈ now + 5y', async () => {
    const { token } = await createSession(db, userId)
    const row = await findSessionByToken(token)
    if (!row) throw new Error('session row not found')
    const expectedExpiry = Date.now() + FIVE_YEARS_MS
    expect(Math.abs(row.expiresAt.getTime() - expectedExpiry)).toBeLessThan(
      TOLERANCE_MS,
    )
  })

  it('generates unique tokens per session', async () => {
    const { token: a } = await createSession(db, userId)
    const { token: b } = await createSession(db, userId)
    expect(a).not.toBe(b)
  })
})

describe('validateSession', () => {
  it('returns the user for a valid token', async () => {
    const { token } = await createSession(db, userId)
    const user = await validateSession(db, token)
    expect(user).not.toBeNull()
    expect(user?.id).toBe(userId)
    expect(user?.email).toBe('session-test@example.com')
  })

  it('returns null for an unknown token', async () => {
    expect(await validateSession(db, 'not-a-real-token')).toBeNull()
  })

  it('returns null for an expired token', async () => {
    const token = crypto.randomUUID()
    await db.insert(sessions).values({
      userId,
      tokenHash: await hashToken(token),
      expiresAt: new Date(Date.now() - 1000),
    })
    expect(await validateSession(db, token)).toBeNull()
  })

  it('returns null for a revoked token', async () => {
    const { token } = await createSession(db, userId)
    expect(await validateSession(db, token)).not.toBeNull()

    await revokeSession(db, token)
    expect(await validateSession(db, token)).toBeNull()
  })

  it('extends expires_at when validated past the refresh threshold (sliding refresh)', async () => {
    const token = crypto.randomUUID()
    // A session last refreshed just PAST the threshold (threshold + 1h ago).
    const staleExpiry = new Date(
      Date.now() +
        SESSION_TTL_MS -
        SESSION_REFRESH_THRESHOLD_MS -
        60 * 60 * 1000,
    )
    await db.insert(sessions).values({
      userId,
      tokenHash: await hashToken(token),
      expiresAt: staleExpiry,
    })

    expect(await validateSession(db, token)).not.toBeNull()

    const row = await findSessionByToken(token)
    if (!row) throw new Error('session row not found')
    const expectedExpiry = Date.now() + SESSION_TTL_MS
    expect(row.expiresAt.getTime()).toBeGreaterThan(staleExpiry.getTime())
    expect(Math.abs(row.expiresAt.getTime() - expectedExpiry)).toBeLessThan(
      TOLERANCE_MS,
    )
  })

  it('does not touch expires_at for a freshly refreshed session', async () => {
    const { token } = await createSession(db, userId)
    const before = await findSessionByToken(token)
    if (!before) throw new Error('session row not found')

    expect(await validateSession(db, token)).not.toBeNull()

    const after = await findSessionByToken(token)
    if (!after) throw new Error('session row not found')
    expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime())
  })
})

describe('revokeSession', () => {
  it('sets revoked_at', async () => {
    const { token } = await createSession(db, userId)
    await revokeSession(db, token)

    const row = await findSessionByToken(token)
    if (!row) throw new Error('session row not found')
    expect(row.revokedAt).toBeInstanceOf(Date)
  })

  it('is a no-op for an unknown token', async () => {
    await expect(revokeSession(db, 'not-a-real-token')).resolves.not.toThrow()
  })
})
