import type { APIRoute } from 'astro'
import { getAppDb } from '../../../db'
import { jsonError, unauthorized } from '../../../lib/api'
import { parseName } from '../../../lib/taxonomy/fields'
import { createArticleTag } from '../../../lib/taxonomy/repo'

/**
 * POST /api/taxonomy/article-tags — creates an article tag (REQUIREMENTS
 * "Admin" — edit categories and tags), or returns the existing one when the
 * name is already taken (see taxonomy/repo.createArticleTag). Owner-only
 * (defense in depth beyond the middleware).
 */
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return unauthorized()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError(400, 'Body must be JSON')
  }
  if (typeof body !== 'object' || body === null) {
    return jsonError(400, 'Body must be a JSON object')
  }
  const fields = parseName(body as Record<string, unknown>)
  if (typeof fields === 'string') return jsonError(400, fields)

  try {
    const tag = await createArticleTag(getAppDb(), fields.name)
    return Response.json({ id: tag.id, name: tag.name }, { status: 201 })
  } catch (error) {
    console.error('Article tag create failed:', error)
    return jsonError(500, 'Failed to create tag')
  }
}
