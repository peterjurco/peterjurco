import {
  envImageUrlConfig,
  type ImageUrlConfig,
  keyFromUrl,
} from '../media/image-url'

/**
 * Every R2 object key referenced by `image` nodes in a stored article
 * document — used to diff old vs new content on save/delete so images
 * dropped from the body get cleaned up (src/lib/media/cleanup.ts), the same
 * way home tiles/photo albums/apps already do for their own image fields.
 *
 * A `src` that doesn't resolve back to a key (`keyFromUrl` returns null — a
 * hand-typed external URL from the toolbar's "Insert Image" prompt, say) is
 * silently skipped: it was never an R2 upload, so there's nothing to clean
 * up. Malformed input (not a doc, missing content) yields an empty list
 * rather than throwing — this runs on every save, so it must never be the
 * reason a save fails.
 */

interface JsonNode {
  type?: unknown
  attrs?: Record<string, unknown>
  content?: unknown
}

function collect(node: unknown, keys: string[], config: ImageUrlConfig): void {
  if (typeof node !== 'object' || node === null) return
  const { type, attrs, content } = node as JsonNode
  if (type === 'image' && typeof attrs?.src === 'string') {
    const key = keyFromUrl(attrs.src, config)
    if (key) keys.push(key)
  }
  if (Array.isArray(content)) {
    for (const child of content) collect(child, keys, config)
  }
}

export function extractImageKeys(
  content: unknown,
  config: ImageUrlConfig = envImageUrlConfig(),
): string[] {
  const keys: string[] = []
  collect(content, keys, config)
  return keys
}
