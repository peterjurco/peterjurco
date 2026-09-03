/**
 * Shared image-upload pipeline: client-side downscale → presign → PUT to
 * R2. Used by both the cover-image picker (src/components/CoverUpload.tsx,
 * prefix 'covers') and the article-body paste handler
 * (src/lib/articles/image-paste-upload.ts, prefix 'articles').
 */

/** Mirror of the server-side allowlist (src/lib/media/r2.ts). Kept as a
 * local copy rather than importing r2.ts directly, so this client-bundled
 * module doesn't pull in R2/aws4fetch/env code that only runs server-side. */
export const ACCEPTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
]

/** Mirror of the server-side cap (src/lib/media/r2.ts MAX_UPLOAD_BYTES). */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024

/** Longest-edge cap before upload (DESIGN motion/upload note). */
export const MAX_EDGE_PX = 2560

/**
 * Target box for the client downscale: null when the image is already within
 * `maxEdge`; otherwise the capped dimensions, aspect ratio kept, rounded to
 * whole pixels.
 */
export function targetDimensions(
  width: number,
  height: number,
  maxEdge = MAX_EDGE_PX,
): { width: number; height: number } | null {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return null
  const scale = maxEdge / longest
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  }
}

/**
 * Default downscale: decode → draw onto a capped canvas → re-encode as WebP.
 * Every failure mode (no createImageBitmap, canvas taint, encoder refusal)
 * falls back to uploading the original bytes — the downscale is an
 * optimization, never a gate. GIFs are passed through (canvas would drop
 * animation frames).
 */
export async function downscaleImage(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') return file
  if (file.type === 'image/gif') return file
  try {
    const bitmap = await createImageBitmap(file)
    const target = targetDimensions(bitmap.width, bitmap.height)
    if (!target) {
      bitmap.close()
      return file
    }
    const canvas = document.createElement('canvas')
    canvas.width = target.width
    canvas.height = target.height
    const context = canvas.getContext('2d')
    if (!context) return file
    context.drawImage(bitmap, 0, 0, target.width, target.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', 0.9)
    })
    return blob ?? file
  } catch {
    return file
  }
}

export interface UploadImageOptions {
  /** Test hooks — default to the real fetch and canvas downscale. */
  fetchFn?: typeof fetch
  downscale?: (file: File) => Promise<Blob>
}

/**
 * The full upload orchestration: downscale → validate → presign → PUT.
 * `prefix` selects the storage area ('covers' | 'articles') and is sent to
 * the presign API, which validates it against its own allowlist. Resolves
 * with the stored R2 object key.
 */
export async function uploadImage(
  file: File,
  prefix: string,
  { fetchFn = fetch, downscale = downscaleImage }: UploadImageOptions = {},
): Promise<string> {
  const blob = await downscale(file)
  const contentType = blob.type || file.type

  if (!ACCEPTED_IMAGE_TYPES.includes(contentType)) {
    throw new Error('Unsupported image type')
  }
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Image too large (max ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB)`,
    )
  }

  const presign = await fetchFn('/api/media/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contentType,
      size: blob.size,
      prefix,
      filename: file.name,
    }),
  })
  if (!presign.ok) throw new Error(`Presign failed (${presign.status})`)
  const { url, key } = (await presign.json()) as { url: string; key: string }

  const put = await fetchFn(url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: blob,
  })
  if (!put.ok) throw new Error(`Upload failed (${put.status})`)
  return key
}
