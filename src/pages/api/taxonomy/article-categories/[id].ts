import type { APIRoute } from 'astro'
import { getAppDb } from '../../../../db'
import { jsonError, parseId, unauthorized } from '../../../../lib/api'
import { parseName } from '../../../../lib/taxonomy/fields'
import {
  articleCategoryExists,
  deleteArticleCategory,
  renameArticleCategory,
} from '../../../../lib/taxonomy/repo'

/**
 * PATCH /api/taxonomy/article-categories/:id — renames the category.
 * DELETE /api/taxonomy/article-categories/:id — removes the category and
 * detaches (sets null on) any articles it was assigned to.
 *
 * Owner-only (defense in depth beyond the middleware).
 */

export const PATCH: APIRoute = async ({ locals, params, request }) => {
  if (!locals.user) return unauthorized()

  const id = parseId(params.id)
  if (id === null) return jsonError(400, 'Invalid category id')

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
    if ((await renameArticleCategory(db, id, fields.name)) === null) {
      return jsonError(404, 'Category not found')
    }
    return Response.json({ ok: true })
  } catch (error) {
    console.error('Category rename failed:', error)
    return jsonError(500, 'Failed to rename category')
  }
}

export const DELETE: APIRoute = async ({ locals, params }) => {
  if (!locals.user) return unauthorized()

  const id = parseId(params.id)
  if (id === null) return jsonError(400, 'Invalid category id')

  try {
    const db = getAppDb()
    if (!(await articleCategoryExists(db, id))) {
      return jsonError(404, 'Category not found')
    }
    await deleteArticleCategory(db, id)
    return Response.json({ ok: true })
  } catch (error) {
    console.error('Category delete failed:', error)
    return jsonError(500, 'Failed to delete category')
  }
}
