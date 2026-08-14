import type { APIRoute } from 'astro'
import { getAppDb } from '../../../../db'
import { jsonError, parseId, unauthorized } from '../../../../lib/api'
import { isCoverAspectRatio } from '../../../../lib/photos/cover-aspect-ratio'
import {
  getTagById,
  setTagCoverAspectRatio,
  setTagVisibility,
} from '../../../../lib/photos/repo'

/**
 * PATCH /api/photos/tags/:id — sets the tag's visibility ("mark a tag as
 * public", REQUIREMENTS) and/or its public-page cover aspect ratio. Owner-
 * only (defense in depth beyond the middleware); the public page at
 * /t/:publicId only ever serves tags flipped public here.
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
  const { visibility, coverAspectRatio } = body as {
    visibility?: unknown
    coverAspectRatio?: unknown
  }
  if (visibility === undefined && coverAspectRatio === undefined) {
    return jsonError(400, 'Nothing to update')
  }
  if (
    visibility !== undefined &&
    visibility !== 'private' &&
    visibility !== 'public'
  ) {
    return jsonError(400, 'visibility must be "private" or "public"')
  }
  if (coverAspectRatio !== undefined && !isCoverAspectRatio(coverAspectRatio)) {
    return jsonError(400, 'coverAspectRatio is not a recognized aspect ratio')
  }

  try {
    const db = getAppDb()
    if ((await getTagById(db, id)) === null) {
      return jsonError(404, 'Tag not found')
    }
    if (visibility !== undefined) await setTagVisibility(db, id, visibility)
    if (coverAspectRatio !== undefined) {
      await setTagCoverAspectRatio(db, id, coverAspectRatio)
    }
    return Response.json({ ok: true })
  } catch (error) {
    console.error('Tag update failed:', error)
    return jsonError(500, 'Failed to update tag')
  }
}
