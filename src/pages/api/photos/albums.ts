import type { APIRoute } from 'astro'
import { getAppDb } from '../../../db'
import { jsonError, unauthorized } from '../../../lib/api'
import { parseAlbumFields } from '../../../lib/photos/album-fields'
import { createAlbum, setAlbumTags } from '../../../lib/photos/repo'

/**
 * POST /api/photos/albums — creates an album (curated Google Photos link +
 * name + optional cover key + tags) and returns `{id}`. Owner-only (defense
 * in depth beyond the middleware).
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
  const fields = parseAlbumFields(body as Record<string, unknown>)
  if (typeof fields === 'string') return jsonError(400, fields)
  if (fields.name === undefined || fields.googlePhotosUrl === undefined) {
    return jsonError(400, 'name and googlePhotosUrl are required')
  }

  try {
    const db = getAppDb()
    const album = await createAlbum(db, {
      name: fields.name,
      googlePhotosUrl: fields.googlePhotosUrl,
      ...(typeof fields.coverImageKey === 'string'
        ? { coverImageKey: fields.coverImageKey }
        : {}),
    })
    if (fields.tags !== undefined && fields.tags.length > 0) {
      await setAlbumTags(db, album.id, fields.tags)
    }
    return Response.json({ id: album.id }, { status: 201 })
  } catch (error) {
    console.error('Album create failed:', error)
    return jsonError(500, 'Failed to create album')
  }
}
