import type { APIRoute } from 'astro'
import { getAppDb } from '../../db'
import { jsonError, unauthorized } from '../../lib/api'
import { parseAppFields } from '../../lib/apps/app-fields'
import { createApp, nextSortOrder } from '../../lib/apps/repo'

/**
 * POST /api/apps — creates a "My apps" link entry (name, url, optional icon
 * key). `sortOrder` defaults to appending at the end of the list when
 * omitted. Owner-only (defense in depth beyond the middleware).
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
  const fields = parseAppFields(body as Record<string, unknown>)
  if (typeof fields === 'string') return jsonError(400, fields)
  if (fields.name === undefined || fields.url === undefined) {
    return jsonError(400, 'name and url are required')
  }

  try {
    const db = getAppDb()
    const sortOrder = fields.sortOrder ?? (await nextSortOrder(db))
    const app = await createApp(db, {
      name: fields.name,
      url: fields.url,
      sortOrder,
      ...(typeof fields.iconKey === 'string'
        ? { iconKey: fields.iconKey }
        : {}),
    })
    return Response.json(
      { id: app.id, sortOrder: app.sortOrder },
      { status: 201 },
    )
  } catch (error) {
    console.error('App create failed:', error)
    return jsonError(500, 'Failed to create app')
  }
}
