import type { APIRoute } from 'astro'
import { getAppDb } from '../../../db'
import { jsonError, unauthorized } from '../../../lib/api'
import { reorderApps } from '../../../lib/apps/repo'

/**
 * POST /api/apps/reorder — persists the full new order of the apps list.
 * Body: `{orderedIds: number[]}`; each app's `sort_order` becomes its index.
 * Owner-only (defense in depth beyond the middleware).
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
  // The apps list is hand-curated and tiny; each id costs one sequential
  // UPDATE (no-transactions invariant), so a huge array is garbage input.
  if (orderedIds.length > 100) {
    return jsonError(400, 'orderedIds must contain at most 100 ids')
  }

  try {
    await reorderApps(getAppDb(), orderedIds as number[])
    return Response.json({ ok: true })
  } catch (error) {
    console.error('Apps reorder failed:', error)
    return jsonError(500, 'Failed to reorder apps')
  }
}
