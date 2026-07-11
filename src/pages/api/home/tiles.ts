import { env } from 'cloudflare:workers'
import type { APIRoute } from 'astro'
import { getAppDb } from '../../../db'
import { jsonError, unauthorized } from '../../../lib/api'
import {
  bulkUpsertLayout,
  createTile,
  listOrdered,
} from '../../../lib/home/repo'
import {
  parseLayoutPayload,
  parseTileFields,
  requireCompleteTile,
} from '../../../lib/home/tile-fields'

/**
 * Home-tiles collection API — the canvas editor's persistence:
 * - GET  /api/home/tiles — the canvas in stacking order.
 * - POST /api/home/tiles — create one tile, returns `{id}`.
 * - PUT  /api/home/tiles — full-canvas save (`{tiles: [...]}` IS the canvas:
 *   entries with ids update, id-less insert, missing rows are deleted).
 *
 * All owner-only (defense in depth beyond the middleware) — the PUBLIC page
 * reads tiles through the repo server-side, never through this API.
 */

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return unauthorized()
  try {
    return Response.json({ tiles: await listOrdered(getAppDb()) })
  } catch (error) {
    console.error('Tiles list failed:', error)
    return jsonError(500, 'Failed to list tiles')
  }
}

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
  const fields = parseTileFields(body as Record<string, unknown>)
  if (typeof fields === 'string') return jsonError(400, fields)
  const values = requireCompleteTile(fields)
  if (typeof values === 'string') return jsonError(400, values)

  try {
    const tile = await createTile(getAppDb(), values)
    return Response.json({ id: tile.id }, { status: 201 })
  } catch (error) {
    console.error('Tile create failed:', error)
    return jsonError(500, 'Failed to create tile')
  }
}

export const PUT: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return unauthorized()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError(400, 'Body must be JSON')
  }
  const layout = parseLayoutPayload(body)
  if (typeof layout === 'string') return jsonError(400, layout)

  try {
    const tiles = await bulkUpsertLayout(getAppDb(), layout, env)
    return Response.json({ tiles })
  } catch (error) {
    console.error('Tiles bulk save failed:', error)
    return jsonError(500, 'Failed to save layout')
  }
}
