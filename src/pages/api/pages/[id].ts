import type { APIRoute } from 'astro'
import { getAppDb } from '../../../db'
import { jsonError, parseId, unauthorized } from '../../../lib/api'
import {
  type AutoFilter,
  deletePage,
  type PageMode,
  type PageSortKey,
  type PagesDb,
  type PageVisibility,
  pageExists,
  SlugTakenError,
  setArticleIds,
  setAutoFilter,
  setMode,
  setSortKey,
  setVisibility,
  updatePage,
} from '../../../lib/pages/repo'
import { validateSlug } from '../../../lib/pages/slug'

/**
 * PATCH /api/pages/:id — partial update. DELETE /api/pages/:id — removes it.
 * Owner-only (defense in depth beyond the middleware) — public reads happen
 * exclusively through the SSR page `/:slug`.
 */

const SORT_KEYS = [
  'created_desc',
  'created_asc',
  'title_asc',
  'title_desc',
] as const

interface ParsedPatch {
  slug?: string
  title?: string
  visibility?: PageVisibility
  mode?: PageMode
  articleIds?: number[]
  categoryId?: number | null
  tagId?: number | null
  sortKey?: PageSortKey
  showTags?: boolean
  showCreatedDate?: boolean
  showUpdatedDate?: boolean
}

/** Returns the validated patch, or an error string naming the bad field. */
function parsePatch(body: Record<string, unknown>): ParsedPatch | string {
  const patch: ParsedPatch = {}
  if ('slug' in body) {
    if (typeof body.slug !== 'string') return 'slug must be a string'
    const slugError = validateSlug(body.slug)
    if (slugError) return slugError
    patch.slug = body.slug
  }
  if ('title' in body) {
    if (typeof body.title !== 'string') return 'title must be a string'
    patch.title = body.title
  }
  if ('visibility' in body) {
    if (body.visibility !== 'private' && body.visibility !== 'public') {
      return 'visibility must be "private" or "public"'
    }
    patch.visibility = body.visibility
  }
  if ('mode' in body) {
    if (body.mode !== 'manual' && body.mode !== 'auto') {
      return 'mode must be "manual" or "auto"'
    }
    patch.mode = body.mode
  }
  if ('articleIds' in body) {
    if (
      !Array.isArray(body.articleIds) ||
      body.articleIds.some((id) => !Number.isInteger(id) || (id as number) <= 0)
    ) {
      return 'articleIds must be an array of positive integers'
    }
    if (body.articleIds.length > 200) {
      return 'articleIds must contain at most 200 ids'
    }
    patch.articleIds = body.articleIds as number[]
  }
  if ('categoryId' in body) {
    if (body.categoryId !== null && !Number.isInteger(body.categoryId)) {
      return 'categoryId must be an integer or null'
    }
    patch.categoryId = body.categoryId as number | null
  }
  if ('tagId' in body) {
    if (body.tagId !== null && !Number.isInteger(body.tagId)) {
      return 'tagId must be an integer or null'
    }
    patch.tagId = body.tagId as number | null
  }
  if (
    patch.categoryId !== undefined &&
    patch.categoryId !== null &&
    patch.tagId !== undefined &&
    patch.tagId !== null
  ) {
    return 'cannot set both categoryId and tagId'
  }
  if ('sortKey' in body) {
    if (!(SORT_KEYS as readonly string[]).includes(body.sortKey as string)) {
      return `sortKey must be one of: ${SORT_KEYS.join(', ')}`
    }
    patch.sortKey = body.sortKey as PageSortKey
  }
  if ('showTags' in body) {
    if (typeof body.showTags !== 'boolean') {
      return 'showTags must be a boolean'
    }
    patch.showTags = body.showTags
  }
  if ('showCreatedDate' in body) {
    if (typeof body.showCreatedDate !== 'boolean') {
      return 'showCreatedDate must be a boolean'
    }
    patch.showCreatedDate = body.showCreatedDate
  }
  if ('showUpdatedDate' in body) {
    if (typeof body.showUpdatedDate !== 'boolean') {
      return 'showUpdatedDate must be a boolean'
    }
    patch.showUpdatedDate = body.showUpdatedDate
  }
  if (Object.keys(patch).length === 0) return 'no updatable fields'
  return patch
}

/** Derives the setAutoFilter argument from whichever of categoryId/tagId the patch touched. */
function autoFilterFromPatch(patch: ParsedPatch): AutoFilter | null {
  if (patch.categoryId === undefined && patch.tagId === undefined) return null
  if (patch.categoryId !== undefined && patch.categoryId !== null) {
    return { categoryId: patch.categoryId }
  }
  if (patch.tagId !== undefined && patch.tagId !== null) {
    return { tagId: patch.tagId }
  }
  return { categoryId: null, tagId: null }
}

/** Applies the patch; returns false when the page doesn't exist. */
async function applyPatch(
  db: PagesDb,
  id: number,
  patch: ParsedPatch,
): Promise<boolean> {
  const hasUpdatePageFields =
    patch.slug !== undefined ||
    patch.title !== undefined ||
    patch.showTags !== undefined ||
    patch.showCreatedDate !== undefined ||
    patch.showUpdatedDate !== undefined
  if (hasUpdatePageFields) {
    const updated = await updatePage(db, id, {
      ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.showTags !== undefined ? { showTags: patch.showTags } : {}),
      ...(patch.showCreatedDate !== undefined
        ? { showCreatedDate: patch.showCreatedDate }
        : {}),
      ...(patch.showUpdatedDate !== undefined
        ? { showUpdatedDate: patch.showUpdatedDate }
        : {}),
    })
    if (updated === null) return false
  } else if (!(await pageExists(db, id))) {
    return false
  }
  if (patch.visibility !== undefined)
    await setVisibility(db, id, patch.visibility)
  if (patch.mode !== undefined) await setMode(db, id, patch.mode)
  if (patch.articleIds !== undefined)
    await setArticleIds(db, id, patch.articleIds)
  const filter = autoFilterFromPatch(patch)
  if (filter) await setAutoFilter(db, id, filter)
  if (patch.sortKey !== undefined) await setSortKey(db, id, patch.sortKey)
  return true
}

export const PATCH: APIRoute = async ({ locals, params, request }) => {
  if (!locals.user) return unauthorized()

  const id = parseId(params.id)
  if (id === null) return jsonError(400, 'Invalid page id')

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
      return jsonError(404, 'Page not found')
    }
    return Response.json({ ok: true })
  } catch (error) {
    if (error instanceof SlugTakenError) return jsonError(409, error.message)
    console.error('Page patch failed:', error)
    return jsonError(500, 'Failed to update page')
  }
}

export const DELETE: APIRoute = async ({ locals, params }) => {
  if (!locals.user) return unauthorized()

  const id = parseId(params.id)
  if (id === null) return jsonError(400, 'Invalid page id')

  try {
    const db = getAppDb()
    if (!(await pageExists(db, id))) {
      return jsonError(404, 'Page not found')
    }
    await deletePage(db, id)
    return Response.json({ ok: true })
  } catch (error) {
    console.error('Page delete failed:', error)
    return jsonError(500, 'Failed to delete page')
  }
}
