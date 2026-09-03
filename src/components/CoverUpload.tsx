import { useState } from 'react'
import {
  ACCEPTED_IMAGE_TYPES,
  type UploadImageOptions,
  uploadImage,
} from '../lib/media/upload-image'

/**
 * Cover-image upload: file input → uploadImage('covers') → reports the
 * stored object key. The downscale/presign/PUT pipeline itself lives in
 * src/lib/media/upload-image.ts, shared with the article-body paste-upload
 * flow (src/lib/articles/image-paste-upload.ts).
 */

export async function uploadCover(
  file: File,
  options?: UploadImageOptions,
): Promise<string> {
  return uploadImage(file, 'covers', options)
}

type Status = '' | 'Uploading…' | 'Uploaded' | 'Upload failed' | 'Not an image'

interface CoverUploadProps {
  /** Called with the stored object key after a successful upload. */
  onUploaded: (key: string) => void
  /** Reports in-flight upload state so the parent can block submits. */
  onUploadingChange?: (uploading: boolean) => void
  disabled?: boolean
}

export function CoverUpload({
  onUploaded,
  onUploadingChange,
  disabled,
}: CoverUploadProps) {
  const [status, setStatus] = useState<Status>('')
  const uploading = status === 'Uploading…'

  async function handleFile(file: File): Promise<void> {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setStatus('Not an image')
      return
    }
    setStatus('Uploading…')
    onUploadingChange?.(true)
    try {
      const key = await uploadCover(file)
      setStatus('Uploaded')
      onUploaded(key)
    } catch {
      setStatus('Upload failed')
    } finally {
      onUploadingChange?.(false)
    }
  }

  return (
    <div className="cover-upload">
      <input
        type="file"
        aria-label="Cover image"
        accept={ACCEPTED_IMAGE_TYPES.join(',')}
        disabled={disabled || uploading}
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Reset the input so picking the same file again (e.g. retrying a
          // failed upload) still fires a change event.
          event.target.value = ''
          if (file) void handleFile(file)
        }}
      />
      <span
        className={
          status === 'Uploaded'
            ? 'is-success'
            : status === 'Upload failed' || status === 'Not an image'
              ? 'is-error'
              : ''
        }
        aria-live="polite"
      >
        {status === 'Not an image'
          ? 'That file is not a supported image (JPEG, PNG, WebP, AVIF, GIF).'
          : status}
      </span>
    </div>
  )
}
