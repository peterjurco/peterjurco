import {
  ALLOWED_IMAGE_CONTENT_TYPES,
  MAX_UPLOAD_BYTES,
  objectKey,
  presignPut,
  type R2Env,
} from '../../src/lib/media/r2'

/**
 * Fetches an image from the still-live old WordPress site and re-uploads it
 * to R2 (owner decision: rehost now rather than preserving external URLs —
 * see plans/08-migration.md's revised scope). Reuses `presignPut` from
 * src/lib/media/r2.ts (mint a presigned PUT URL, then PUT the fetched bytes
 * ourselves) rather than adding a new direct-upload primitive.
 *
 * Never crashes the migration over one bad image: any failure (network
 * error, non-2xx, disallowed content type, oversize, upload failure) is
 * logged and resolves to `null` — callers fall back to the original WP URL
 * (inline images) or an unset `featuredPhotoKey` (featured image).
 */

export interface RehostDeps {
  /** The old site's hostname (from the dump's `# Home URL:` header) — only its images are ever fetched. */
  ownedHost: string
  /** `sourceUrl → R2 key` (or `null` for a known-failed URL), shared across a whole import run so repeats are free. */
  cache: Map<string, string | null>
  /** Injectable for tests — fetches the SOURCE image only; the R2 PUT always uses the real global `fetch`. */
  fetchSource?: typeof fetch
  /** Extra context (e.g. a WP post id) prefixed on warning logs. */
  context?: string
  logger?: (message: string) => void
}

/**
 * True when `url`'s host is the owned domain (or its `www.` variant) —
 * checked BEFORE any fetch is attempted, never as a fetch-failure fallback
 * (owner decision: never rehost content that isn't ours).
 */
export function isOwnedUrl(url: string, ownedHost: string): boolean {
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  const owned = ownedHost.toLowerCase()
  return hostname === owned || hostname === `www.${owned}`
}

function filenameFromUrl(url: string): string {
  const path = new URL(url).pathname
  const last = path.split('/').filter(Boolean).pop()
  return last ?? 'image'
}

function warn(deps: RehostDeps, sourceUrl: string, reason: string): void {
  const log = deps.logger ?? console.warn
  const prefix = deps.context ? `post ${deps.context}` : 'rehost-image'
  log(`[migrate-wp] ${prefix}: ${sourceUrl} — ${reason}`)
}

/**
 * Fetches `sourceUrl` and uploads it to R2, returning the new object key —
 * or `null` (never throws) when the URL isn't owned, or anything about the
 * fetch/validation/upload fails. Dedupes via `deps.cache`, including caching
 * failures so a bad URL is never retried within the same run.
 */
export async function rehostImage(
  env: R2Env,
  sourceUrl: string,
  deps: RehostDeps,
): Promise<string | null> {
  if (deps.cache.has(sourceUrl)) return deps.cache.get(sourceUrl) ?? null

  if (!isOwnedUrl(sourceUrl, deps.ownedHost)) {
    // Not cached: an external URL isn't a "failure", and it costs nothing to
    // re-check next time — only real fetch attempts are worth deduping.
    return null
  }

  const fail = (reason: string): null => {
    warn(deps, sourceUrl, reason)
    deps.cache.set(sourceUrl, null)
    return null
  }

  let response: Response
  try {
    response = await (deps.fetchSource ?? fetch)(sourceUrl, {
      redirect: 'follow',
    })
  } catch (error) {
    return fail(`fetch failed: ${(error as Error).message}`)
  }
  if (!response.ok) {
    return fail(`fetch returned ${response.status} ${response.statusText}`)
  }

  const contentType = response.headers
    .get('content-type')
    ?.split(';')[0]
    ?.trim()
  if (
    !contentType ||
    !(ALLOWED_IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType)
  ) {
    return fail(`disallowed content-type: ${contentType ?? '(none)'}`)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return fail(
      `too large: ${bytes.byteLength} bytes (max ${MAX_UPLOAD_BYTES})`,
    )
  }

  const key = objectKey('migrated', filenameFromUrl(sourceUrl))
  try {
    const putUrl = await presignPut(env, key, contentType)
    const put = await fetch(putUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: bytes,
    })
    if (!put.ok)
      return fail(`R2 upload failed: ${put.status} ${put.statusText}`)
  } catch (error) {
    return fail(`R2 upload failed: ${(error as Error).message}`)
  }

  deps.cache.set(sourceUrl, key)
  return key
}
