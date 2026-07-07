import type { APIRoute } from 'astro'
import { getAppDb } from '../../../db'
import { jsonError, unauthorized } from '../../../lib/api'
import { reorderFeatured } from '../../../lib/articles/queries'

/**
 * POST /api/articles/featured-order — persists the drag order of featured
 * articles. Body: `{orderedIds: number[]}`; each article's
 * `featured_position` becomes its index. Owner-only (defense in depth
 * beyond the middleware).
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
  const { orderedIds } = body as { orderedIds?: unknown }
  if (
    !Array.isArray(orderedIds) ||
    orderedIds.some((id) => !Number.isInteger(id) || (id as number) <= 0)
  ) {
    return jsonError(400, 'orderedIds must be an array of positive integers')
  }

  try {
    await reorderFeatured(getAppDb(), orderedIds as number[])
    return Response.json({ ok: true })
  } catch (error) {
    console.error('Featured reorder failed:', error)
    return jsonError(500, 'Failed to reorder featured articles')
  }
}
