import type { APIRoute } from 'astro'
import { getAppDb } from '../../../db'
import { jsonError, unauthorized } from '../../../lib/api'
import { createCategory } from '../../../lib/articles/repo'
import { parseName } from '../../../lib/taxonomy/fields'

/**
 * POST /api/taxonomy/article-categories — creates an article category
 * (REQUIREMENTS "Admin" — edit categories and tags). Owner-only (defense in
 * depth beyond the middleware).
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
    const category = await createCategory(getAppDb(), fields.name)
    return Response.json(
      { id: category.id, name: category.name },
      { status: 201 },
    )
  } catch (error) {
    console.error('Category create failed:', error)
    return jsonError(500, 'Failed to create category')
  }
}
