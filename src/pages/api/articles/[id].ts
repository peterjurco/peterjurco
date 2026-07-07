import type { APIRoute } from 'astro'
import { getAppDb } from '../../../db'
import { jsonError, parseId, unauthorized } from '../../../lib/api'
import {
  type ArticleContent,
  type ArticlesDb,
  type ArticleVisibility,
  articleExists,
  deleteArticle,
  setCategory,
  setFeatured,
  setTags,
  setVisibility,
  updateArticle,
} from '../../../lib/articles/repo'

/**
 * PATCH /api/articles/:id — partial update. Carries either the autosave
 * payload (content/title) or metadata (visibility/categoryId/tags/isFeatured).
 * DELETE /api/articles/:id — removes the article.
 *
 * Owner-only (defense in depth beyond the middleware) — public reads happen
 * exclusively through the SSR page `/a/:publicId`.
 */

interface ParsedPatch {
  title?: string
  content?: ArticleContent
  visibility?: ArticleVisibility
  categoryId?: number | null
  tags?: string[]
  isFeatured?: boolean
}

/** Returns the validated patch, or an error string naming the bad field. */
function parsePatch(body: Record<string, unknown>): ParsedPatch | string {
  const patch: ParsedPatch = {}
  if ('title' in body) {
    if (typeof body.title !== 'string') return 'title must be a string'
    patch.title = body.title
  }
  if ('content' in body) {
    const content = body.content
    if (
      typeof content !== 'object' ||
      content === null ||
      Array.isArray(content) ||
      (content as { type?: unknown }).type !== 'doc'
    ) {
      return 'content must be a ProseMirror doc object'
    }
    patch.content = content as ArticleContent
  }
  if ('visibility' in body) {
    if (body.visibility !== 'private' && body.visibility !== 'public') {
      return 'visibility must be "private" or "public"'
    }
    patch.visibility = body.visibility
  }
  if ('categoryId' in body) {
    if (body.categoryId !== null && !Number.isInteger(body.categoryId)) {
      return 'categoryId must be an integer or null'
    }
    patch.categoryId = body.categoryId as number | null
  }
  if ('tags' in body) {
    if (
      !Array.isArray(body.tags) ||
      body.tags.some((tag) => typeof tag !== 'string')
    ) {
      return 'tags must be an array of strings'
    }
    patch.tags = body.tags as string[]
  }
  if ('isFeatured' in body) {
    if (typeof body.isFeatured !== 'boolean') {
      return 'isFeatured must be a boolean'
    }
    patch.isFeatured = body.isFeatured
  }
  if (Object.keys(patch).length === 0) return 'no updatable fields'
  return patch
}

/** Applies the patch; returns false when the article doesn't exist. */
async function applyPatch(
  db: ArticlesDb,
  id: number,
  patch: ParsedPatch,
): Promise<boolean> {
  if (patch.title !== undefined || patch.content !== undefined) {
    // updateArticle's returning() doubles as the existence check.
    const updated = await updateArticle(db, id, {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
    })
    if (updated === null) return false
  } else if (!(await articleExists(db, id))) {
    return false
  }
  if (patch.visibility !== undefined) {
    await setVisibility(db, id, patch.visibility)
  }
  if (patch.categoryId !== undefined) {
    await setCategory(db, id, patch.categoryId)
  }
  if (patch.tags !== undefined) await setTags(db, id, patch.tags)
  if (patch.isFeatured !== undefined) {
    await setFeatured(db, id, patch.isFeatured)
  }
  return true
}

export const PATCH: APIRoute = async ({ locals, params, request }) => {
  if (!locals.user) return unauthorized()

  const id = parseId(params.id)
  if (id === null) return jsonError(400, 'Invalid article id')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError(400, 'Body must be JSON')
  }
  if (typeof body !== 'object' || body === null) {
    return jsonError(400, 'Body must be a JSON object')
  }
  const patch = parsePatch(body as Record<string, unknown>)
  if (typeof patch === 'string') return jsonError(400, patch)

  try {
    const db = getAppDb()
    if (!(await applyPatch(db, id, patch))) {
      return jsonError(404, 'Article not found')
    }
    return Response.json({ ok: true })
  } catch (error) {
    console.error('Article patch failed:', error)
    return jsonError(500, 'Failed to update article')
  }
}

export const DELETE: APIRoute = async ({ locals, params }) => {
  if (!locals.user) return unauthorized()

  const id = parseId(params.id)
  if (id === null) return jsonError(400, 'Invalid article id')

  try {
    const db = getAppDb()
    if (!(await articleExists(db, id))) {
      return jsonError(404, 'Article not found')
    }
    await deleteArticle(db, id)
    return Response.json({ ok: true })
  } catch (error) {
    console.error('Article delete failed:', error)
    return jsonError(500, 'Failed to delete article')
  }
}
