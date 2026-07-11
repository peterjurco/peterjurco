import { env } from 'cloudflare:workers'
import type { APIRoute } from 'astro'
import { getAppDb } from '../../../../db'
import { jsonError, parseId, unauthorized } from '../../../../lib/api'
import { parseAlbumFields } from '../../../../lib/photos/album-fields'
import {
  albumExists,
  deleteAlbum,
  setAlbumTags,
  updateAlbum,
} from '../../../../lib/photos/repo'

/**
 * PATCH /api/photos/albums/:id — partial update (name, googlePhotosUrl,
 * coverImageKey — null clears — and/or the tag set).
 * DELETE /api/photos/albums/:id — removes the album and its tag links.
 *
 * Owner-only (defense in depth beyond the middleware).
 */

export const PATCH: APIRoute = async ({ locals, params, request }) => {
  if (!locals.user) return unauthorized()

  const id = parseId(params.id)
  if (id === null) return jsonError(400, 'Invalid album id')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError(400, 'Body must be JSON')
  }
  if (typeof body !== 'object' || body === null) {
    return jsonError(400, 'Body must be a JSON object')
  }
  const fields = parseAlbumFields(body as Record<string, unknown>)
  if (typeof fields === 'string') return jsonError(400, fields)
  const { tags, ...patch } = fields
  if (Object.keys(patch).length === 0 && tags === undefined) {
    return jsonError(400, 'no updatable fields')
  }

  try {
    const db = getAppDb()
    if (Object.keys(patch).length > 0) {
      // updateAlbum's returning() doubles as the existence check.
      if ((await updateAlbum(db, id, patch, env)) === null) {
        return jsonError(404, 'Album not found')
      }
    } else if (!(await albumExists(db, id))) {
      return jsonError(404, 'Album not found')
    }
    if (tags !== undefined) await setAlbumTags(db, id, tags)
    return Response.json({ ok: true })
  } catch (error) {
    console.error('Album patch failed:', error)
    return jsonError(500, 'Failed to update album')
  }
}

export const DELETE: APIRoute = async ({ locals, params }) => {
  if (!locals.user) return unauthorized()

  const id = parseId(params.id)
  if (id === null) return jsonError(400, 'Invalid album id')

  try {
    const db = getAppDb()
    if (!(await albumExists(db, id))) {
      return jsonError(404, 'Album not found')
    }
    // Tag GC parity with articles: deleting an album keeps its tags around —
    // setAlbumTags is the only GC point.
    await deleteAlbum(db, id, env)
    return Response.json({ ok: true })
  } catch (error) {
    console.error('Album delete failed:', error)
    return jsonError(500, 'Failed to delete album')
  }
}
