import { env } from 'cloudflare:workers'
import type { APIRoute } from 'astro'
import { getDb } from '../../../db'
import { jsonError, unauthorized } from '../../../lib/api'
import { createArticle } from '../../../lib/articles/repo'
import { requireEnv } from '../../../lib/env'

/**
 * POST /api/articles — creates an empty, private article and returns `{id}`.
 * Owner-only: every article endpoint requires `locals.user` (defense in depth
 * beyond the middleware); public reading happens via the SSR page, not the API.
 */
export const POST: APIRoute = async ({ locals }) => {
  if (!locals.user) return unauthorized()
  try {
    const db = getDb(requireEnv(env.DATABASE_URL, 'DATABASE_URL'))
    const article = await createArticle(db)
    return Response.json({ id: article.id }, { status: 201 })
  } catch (error) {
    console.error('Article create failed:', error)
    return jsonError(500, 'Failed to create article')
  }
}
