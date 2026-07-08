import type { APIRoute } from 'astro'
import { getAppDb } from '../../../../db'
import { jsonError, parseId, unauthorized } from '../../../../lib/api'
import { getTagById, setTagVisibility } from '../../../../lib/photos/repo'
import { parsePhotoTagPatch } from '../../../../lib/taxonomy/fields'
import { deletePhotoTag, renamePhotoTag } from '../../../../lib/taxonomy/repo'

/**
 * PATCH /api/taxonomy/photo-tags/:id — renames the tag and/or sets its
 * visibility (photos/repo.setTagVisibility — the same "mark a tag as public"
 * operation the photo hub's tag page uses; not duplicated here).
 * DELETE /api/taxonomy/photo-tags/:id — removes the tag and its album links.
 * Deleting (or un-publishing) a PUBLIC tag breaks its `/t/:publicId` share
 * link — the admin UI warns before calling this; the API itself allows it.
 *
 * Owner-only (defense in depth beyond the middleware).
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
  const fields = parsePhotoTagPatch(body as Record<string, unknown>)
  if (typeof fields === 'string') return jsonError(400, fields)
  if (fields.name === undefined && fields.visibility === undefined) {
    return jsonError(400, 'no updatable fields')
  }

  try {
    const db = getAppDb()
    if ((await getTagById(db, id)) === null) {
      return jsonError(404, 'Tag not found')
    }
    if (fields.name !== undefined) await renamePhotoTag(db, id, fields.name)
    if (fields.visibility !== undefined) {
      await setTagVisibility(db, id, fields.visibility)
    }
    return Response.json({ ok: true })
  } catch (error) {
    console.error('Photo tag patch failed:', error)
    return jsonError(500, 'Failed to update tag')
  }
}

export const DELETE: APIRoute = async ({ locals, params }) => {
  if (!locals.user) return unauthorized()

  const id = parseId(params.id)
  if (id === null) return jsonError(400, 'Invalid tag id')

  try {
    const db = getAppDb()
    if ((await getTagById(db, id)) === null) {
      return jsonError(404, 'Tag not found')
    }
    await deletePhotoTag(db, id)
    return Response.json({ ok: true })
  } catch (error) {
    console.error('Photo tag delete failed:', error)
    return jsonError(500, 'Failed to delete tag')
  }
}
