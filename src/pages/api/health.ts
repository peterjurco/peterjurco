import { env } from 'cloudflare:workers'
import type { APIRoute } from 'astro'
import { sql } from 'drizzle-orm'
import { getDb } from '../../db'

export const GET: APIRoute = async () => {
  try {
    const db = getDb(env.DATABASE_URL)
    await db.execute(sql`select 1`)
    return Response.json({ ok: true, db: 'up' })
  } catch (error) {
    console.error('Health check failed:', error)
    return Response.json({ ok: false }, { status: 503 })
  }
}
