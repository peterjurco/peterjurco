import type { APIRoute } from 'astro'
import { getAppDb } from '../../../../db'
import { jsonError, parseId, unauthorized } from '../../../../lib/api'
import { getTagById, setTagVisibility } from '../../../../lib/photos/repo'

/**
 * PATCH /api/photos/tags/:id — sets the tag's visibility ("mark a tag as
 * public", REQUIREMENTS). Owner-only (defense in depth beyond the
 * middleware); the public page at /t/:publicId only ever serves tags flipped
 * public here.
 */
export const PATCH: APIRoute = async ({ locals, params, request }) => {
  if (!locals.user) return unauthorized()

  const id = parseId(params.id)
  if (id === null) return jsonError(400, 'Invalid tag id')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError(400, 'Body must be JSON')
  }
  if (typeof body !== 'object' || body === null) {
    return jsonError(400, 'Body must be a JSON object')
  }
  const { visibility } = body as { visibility?: unknown }
  if (visibility !== 'private' && visibility !== 'public') {
    return jsonError(400, 'visibility must be "private" or "public"')
  }

  try {
    const db = getAppDb()
    if ((await getTagById(db, id)) === null) {
      return jsonError(404, 'Tag not found')
    }
    await setTagVisibility(db, id, visibility)
    return Response.json({ ok: true })
  } catch (error) {
    console.error('Tag visibility change failed:', error)
    return jsonError(500, 'Failed to update tag')
  }
}
