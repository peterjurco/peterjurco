import type { APIRoute } from 'astro'
import { getAppDb } from '../../../db'
import { jsonError, unauthorized } from '../../../lib/api'
import { createTag } from '../../../lib/photos/repo'

/**
 * POST /api/photos/tags — creates a photo tag (private, with a fresh opaque
 * public id) and returns it; an existing tag of the same name is returned
 * instead of erroring (create-by-name is idempotent). Owner-only (defense in
 * depth beyond the middleware). Visibility changes live at
 * PATCH /api/photos/tags/:id.
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
  const { name } = body as { name?: unknown }
  if (typeof name !== 'string' || name.trim().length === 0) {
    return jsonError(400, 'name must be a non-empty string')
  }

  try {
    const tag = await createTag(getAppDb(), name.trim())
    return Response.json(tag, { status: 201 })
  } catch (error) {
    console.error('Tag create failed:', error)
    return jsonError(500, 'Failed to create tag')
  }
}
