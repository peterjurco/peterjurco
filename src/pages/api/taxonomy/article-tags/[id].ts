import type { APIRoute } from 'astro'
import { getAppDb } from '../../../../db'
import { jsonError, parseId, unauthorized } from '../../../../lib/api'
import { parseName } from '../../../../lib/taxonomy/fields'
import {
  articleTagExists,
  deleteArticleTag,
  renameArticleTag,
} from '../../../../lib/taxonomy/repo'

/**
 * PATCH /api/taxonomy/article-tags/:id — renames the tag.
 * DELETE /api/taxonomy/article-tags/:id — removes the tag and its join rows;
 * tagged articles are untouched.
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
  const fields = parseName(body as Record<string, unknown>)
  if (typeof fields === 'string') return jsonError(400, fields)

  try {
    const db = getAppDb()
    if ((await renameArticleTag(db, id, fields.name)) === null) {
      return jsonError(404, 'Tag not found')
    }
    return Response.json({ ok: true })
  } catch (error) {
    console.error('Article tag rename failed:', error)
    return jsonError(500, 'Failed to rename tag')
  }
}

export const DELETE: APIRoute = async ({ locals, params }) => {
  if (!locals.user) return unauthorized()

  const id = parseId(params.id)
  if (id === null) return jsonError(400, 'Invalid tag id')

  try {
    const db = getAppDb()
    if (!(await articleTagExists(db, id))) {
      return jsonError(404, 'Tag not found')
    }
    await deleteArticleTag(db, id)
    return Response.json({ ok: true })
  } catch (error) {
    console.error('Article tag delete failed:', error)
    return jsonError(500, 'Failed to delete tag')
  }
}
