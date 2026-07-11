import { env } from 'cloudflare:workers'
import type { APIRoute } from 'astro'
import { getAppDb } from '../../../db'
import { jsonError, parseId, unauthorized } from '../../../lib/api'
import { parseAppFields } from '../../../lib/apps/app-fields'
import { appExists, deleteApp, updateApp } from '../../../lib/apps/repo'

/**
 * PATCH /api/apps/:id — partial update (name, url, iconKey — null clears —
 * and/or sortOrder, used by the admin UI's up/down reorder).
 * DELETE /api/apps/:id — removes the app.
 *
 * Owner-only (defense in depth beyond the middleware).
 */

export const PATCH: APIRoute = async ({ locals, params, request }) => {
  if (!locals.user) return unauthorized()

  const id = parseId(params.id)
  if (id === null) return jsonError(400, 'Invalid app id')

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
  if (Object.keys(fields).length === 0) {
    return jsonError(400, 'no updatable fields')
  }

  try {
    const db = getAppDb()
    // updateApp's returning() doubles as the existence check.
    if ((await updateApp(db, id, fields, env)) === null) {
      return jsonError(404, 'App not found')
    }
    return Response.json({ ok: true })
  } catch (error) {
    console.error('App patch failed:', error)
    return jsonError(500, 'Failed to update app')
  }
}

export const DELETE: APIRoute = async ({ locals, params }) => {
  if (!locals.user) return unauthorized()

  const id = parseId(params.id)
  if (id === null) return jsonError(400, 'Invalid app id')

  try {
    const db = getAppDb()
    if (!(await appExists(db, id))) {
      return jsonError(404, 'App not found')
    }
    await deleteApp(db, id, env)
    return Response.json({ ok: true })
  } catch (error) {
    console.error('App delete failed:', error)
    return jsonError(500, 'Failed to delete app')
  }
}
