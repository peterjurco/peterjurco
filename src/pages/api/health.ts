import type { APIRoute } from 'astro'
import { sql } from 'drizzle-orm'
import { getAppDb } from '../../db'

export const GET: APIRoute = async () => {
  try {
    const db = getAppDb()
    await db.execute(sql`select 1`)
    return Response.json({ ok: true, db: 'up' })
  } catch (error) {
    console.error('Health check failed:', error)
    return Response.json({ ok: false }, { status: 503 })
  }
}
