import { env } from 'cloudflare:workers'
import type { APIRoute } from 'astro'
import { jsonError, unauthorized } from '../../../lib/api'
import {
  ALLOWED_IMAGE_CONTENT_TYPES,
  MAX_UPLOAD_BYTES,
  objectKey,
  presignPut,
} from '../../../lib/media/r2'

/**
 * POST /api/media/presign — mints a short-lived presigned R2 PUT URL for an
 * image upload. Body: `{contentType, size, prefix, filename}` → `{url, key}`.
 *
 * Owner-only (defense in depth beyond the middleware). Upload policy is
 * enforced HERE — content type must be a real image type, the declared size
 * within the cap, and the storage prefix one of the allowlisted areas — so
 * no URL is ever minted for anything else. The approved content type is
 * then bound into the URL's signature (presignPut), so the holder can't PUT
 * a different type; the size stays a declared-value check only.
 */

/** Storage areas this endpoint will mint URLs for (src/lib/media/r2.ts objectKey prefix). */
const ALLOWED_PREFIXES = ['covers', 'articles'] as const
type Prefix = (typeof ALLOWED_PREFIXES)[number]

interface PresignRequest {
  contentType: string
  size: number
  prefix: Prefix
  filename: string
}

/** Returns the validated request, or an error string naming the bad field. */
function parseBody(body: Record<string, unknown>): PresignRequest | string {
  const { contentType, size, prefix, filename } = body
  if (
    typeof contentType !== 'string' ||
    !(ALLOWED_IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType)
  ) {
    return `contentType must be one of: ${ALLOWED_IMAGE_CONTENT_TYPES.join(', ')}`
  }
  if (!Number.isInteger(size) || (size as number) <= 0) {
    return 'size must be a positive integer (bytes)'
  }
  if ((size as number) > MAX_UPLOAD_BYTES) {
    return `size must be at most ${MAX_UPLOAD_BYTES} bytes`
  }
  if (
    typeof prefix !== 'string' ||
    !(ALLOWED_PREFIXES as readonly string[]).includes(prefix)
  ) {
    return `prefix must be one of: ${ALLOWED_PREFIXES.join(', ')}`
  }
  if (filename !== undefined && typeof filename !== 'string') {
    return 'filename must be a string'
  }
  return {
    contentType,
    size: size as number,
    prefix: prefix as Prefix,
    filename: (filename as string | undefined) ?? '',
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
  const parsed = parseBody(body as Record<string, unknown>)
  if (typeof parsed === 'string') return jsonError(400, parsed)

  try {
    // The filename is untrusted — objectKey keeps only a sane extension.
    const key = objectKey(parsed.prefix, parsed.filename)
    const url = await presignPut(env, key, parsed.contentType)
    return Response.json({ url, key })
  } catch (error) {
    console.error('Presign failed:', error)
    return jsonError(500, 'Failed to presign upload')
  }
}
