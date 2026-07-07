import { useState } from 'react'

/**
 * Cover-image upload: file input → optional light client downscale (cap the
 * longest edge, per DESIGN/TECH_DECISIONS §5 hybrid note — speeds mobile
 * uploads; display sizes still come from edge transforms) → presigned PUT
 * straight to R2 (POST /api/media/presign) → reports the stored object key.
 */

/** Mirror of the server-side allowlist (src/lib/media/r2.ts). */
const ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
]

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
async function downscaleImage(file: File): Promise<Blob> {
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

interface UploadCoverOptions {
  /** Test hooks — default to the real fetch and canvas downscale. */
  fetchFn?: typeof fetch
  downscale?: (file: File) => Promise<Blob>
}

/**
 * The full upload orchestration: downscale → presign → PUT. Resolves with
 * the stored R2 object key.
 */
export async function uploadCover(
  file: File,
  { fetchFn = fetch, downscale = downscaleImage }: UploadCoverOptions = {},
): Promise<string> {
  const blob = await downscale(file)
  const contentType = blob.type || file.type

  const presign = await fetchFn('/api/media/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contentType,
      size: blob.size,
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

type Status = '' | 'Uploading…' | 'Uploaded' | 'Upload failed' | 'Not an image'

interface CoverUploadProps {
  /** Called with the stored object key after a successful upload. */
  onUploaded: (key: string) => void
  disabled?: boolean
}

export function CoverUpload({ onUploaded, disabled }: CoverUploadProps) {
  const [status, setStatus] = useState<Status>('')

  async function handleFile(file: File): Promise<void> {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setStatus('Not an image')
      return
    }
    setStatus('Uploading…')
    try {
      const key = await uploadCover(file)
      setStatus('Uploaded')
      onUploaded(key)
    } catch {
      setStatus('Upload failed')
    }
  }

  return (
    <div className="cover-upload">
      <input
        type="file"
        aria-label="Cover image"
        accept={ACCEPTED_TYPES.join(',')}
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void handleFile(file)
        }}
      />
      <span aria-live="polite">
        {status === 'Not an image'
          ? 'That file is not a supported image (JPEG, PNG, WebP, AVIF, GIF).'
          : status}
      </span>
    </div>
  )
}
