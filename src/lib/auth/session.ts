import { eq } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from '../../db/schema'
import { sessions, users } from '../../db/schema'

/**
 * Any Drizzle Postgres client over our schema — the Neon HTTP driver in
 * production (src/db/client.ts) or node-postgres in tests
 * (tests/helpers/test-db.ts).
 */
export type AuthDb = PgDatabase<PgQueryResultHKT, typeof schema>

export type SessionUser = typeof users.$inferSelect

/** "Stay signed in indefinitely": sessions live ~5 years… */
export const SESSION_TTL_MS = 5 * 365 * 24 * 60 * 60 * 1000
/**
 * …and slide on activity: validating a session that was last refreshed more
 * than this long ago pushes expires_at back out to now + TTL.
 */
export const SESSION_REFRESH_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

/** SHA-256 (Web Crypto) hex digest — the only form a token is stored in. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  )
  return bytesToHex(new Uint8Array(digest))
}

/** 256-bit random opaque token (hex). */
function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

/**
 * Mints a new session for the user. Returns the plaintext token (for the
 * cookie); only its SHA-256 hash is persisted.
 */
export async function createSession(
  db: AuthDb,
  userId: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.insert(sessions).values({
    userId,
    tokenHash: await hashToken(token),
    expiresAt,
  })
  return { token, expiresAt }
}

/**
 * Resolves a plaintext token to its user, or null for unknown / expired /
 * revoked sessions. Applies the sliding refresh as a side effect.
 */
export async function validateSession(
  db: AuthDb,
  token: string,
): Promise<SessionUser | null> {
  const tokenHash = await hashToken(token)
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1)
  if (!row) return null

  const now = Date.now()
  if (row.session.revokedAt !== null) return null
  if (row.session.expiresAt.getTime() <= now) return null

  const refreshDue =
    row.session.expiresAt.getTime() - now <
    SESSION_TTL_MS - SESSION_REFRESH_THRESHOLD_MS
  if (refreshDue) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(now + SESSION_TTL_MS) })
      .where(eq(sessions.id, row.session.id))
  }

  return row.user
}

/** Kill switch: marks the session revoked so validation fails from now on. */
export async function revokeSession(db: AuthDb, token: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.tokenHash, await hashToken(token)))
}
