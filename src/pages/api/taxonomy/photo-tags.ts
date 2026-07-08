import type { APIRoute } from 'astro'
import { getAppDb } from '../../../db'
import { jsonError, unauthorized } from '../../../lib/api'
import { createTag } from '../../../lib/photos/repo'
import { parseName } from '../../../lib/taxonomy/fields'

/**
 * POST /api/taxonomy/photo-tags — creates a photo tag (REQUIREMENTS "Admin"
 * — edit categories and tags), reusing photos/repo.createTag (private, with
 * an opaque public id — same as tags created on the fly from the album
 * form). Owner-only (defense in depth beyond the middleware).
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
    const tag = await createTag(getAppDb(), fields.name)
    return Response.json(
      {
        id: tag.id,
        name: tag.name,
        visibility: tag.visibility,
        publicId: tag.publicId,
      },
      { status: 201 },
    )
  } catch (error) {
    console.error('Photo tag create failed:', error)
    return jsonError(500, 'Failed to create tag')
  }
}
