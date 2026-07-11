import type { APIRoute } from 'astro'
import { getAppDb } from '../../../../db'
import { jsonError, parseId, unauthorized } from '../../../../lib/api'
import {
  deleteTile,
  getTile,
  type HomeTile,
  updateTile,
} from '../../../../lib/home/repo'
import {
  parseTileFields,
  requireCompleteTile,
  type TileFields,
} from '../../../../lib/home/tile-fields'

/**
 * Single home-tile API:
 * - PATCH  /api/home/tiles/:id — partial update of any tile fields. The patch
 *   is validated AGAINST THE MERGED ROW, so a partial update can never break
 *   the completeness invariant (e.g. `{imageKeys: []}` on a photo tile).
 * - DELETE /api/home/tiles/:id — removes the tile.
 *
 * Owner-only (defense in depth beyond the middleware).
 */

/** The stored row as validator input — id/timestamps are not tile fields. */
function tileFieldsOf(tile: HomeTile): TileFields {
  const { id, createdAt, updatedAt, ...fields } = tile
  return fields
}

export const PATCH: APIRoute = async ({ locals, params, request }) => {
  if (!locals.user) return unauthorized()

  const id = parseId(params.id)
  if (id === null) return jsonError(400, 'Invalid tile id')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError(400, 'Body must be JSON')
  }
  if (typeof body !== 'object' || body === null) {
    return jsonError(400, 'Body must be a JSON object')
  }
  const fields = parseTileFields(body as Record<string, unknown>)
  if (typeof fields === 'string') return jsonError(400, fields)
  if (Object.keys(fields).length === 0) {
    return jsonError(400, 'no updatable fields')
  }

  try {
    const db = getAppDb()
    // Invariant check on the MERGED row: the patch alone can be valid while
    // the result is unrenderable (photo without any imageKeys, quote without
    // text).
    const existing = await getTile(db, id)
    if (existing === null) return jsonError(404, 'Tile not found')
    const merged = requireCompleteTile({ ...tileFieldsOf(existing), ...fields })
    if (typeof merged === 'string') return jsonError(400, merged)

    // updateTile's returning() re-checks existence (row deleted since read).
    const tile = await updateTile(db, id, fields)
    if (tile === null) return jsonError(404, 'Tile not found')
    return Response.json({ tile })
  } catch (error) {
    console.error('Tile patch failed:', error)
    return jsonError(500, 'Failed to update tile')
  }
}

export const DELETE: APIRoute = async ({ locals, params }) => {
  if (!locals.user) return unauthorized()

  const id = parseId(params.id)
  if (id === null) return jsonError(400, 'Invalid tile id')

  try {
    if (!(await deleteTile(getAppDb(), id))) {
      return jsonError(404, 'Tile not found')
    }
    return Response.json({ ok: true })
  } catch (error) {
    console.error('Tile delete failed:', error)
    return jsonError(500, 'Failed to delete tile')
  }
}
