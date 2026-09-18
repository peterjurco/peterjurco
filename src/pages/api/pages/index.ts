import type { APIRoute } from 'astro'
import { getAppDb } from '../../../db'
import { jsonError, unauthorized } from '../../../lib/api'
import { createPage, SlugTakenError } from '../../../lib/pages/repo'
import { validateSlug } from '../../../lib/pages/slug'

/**
 * POST /api/pages — creates a page. Body: `{slug, title}` → `{id}`.
 * Owner-only (defense in depth beyond the middleware).
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
  const { slug, title } = body as { slug?: unknown; title?: unknown }
  if (typeof slug !== 'string') return jsonError(400, 'slug must be a string')
  const slugError = validateSlug(slug)
  if (slugError) return jsonError(400, slugError)
  if (typeof title !== 'string') return jsonError(400, 'title must be a string')

  try {
    const page = await createPage(getAppDb(), { slug, title })
    return Response.json({ id: page.id }, { status: 201 })
  } catch (error) {
    if (error instanceof SlugTakenError) return jsonError(409, error.message)
    console.error('Page create failed:', error)
    return jsonError(500, 'Failed to create page')
  }
}
