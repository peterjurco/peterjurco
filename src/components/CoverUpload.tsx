import { useRef, useState } from 'react'
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
  /** Swaps the trigger button's label from "Add image" to "Edit image" — pass true once a cover is already set. */
  hasExisting?: boolean
}

/**
 * The native file input renders as plain unstyled text ("Choose file / No
 * file chosen") in every browser, so it's kept in the DOM but visually
 * hidden and driven by a real, styled trigger button instead — the
 * standard "hidden input + button click()" pattern. The input keeps its
 * aria-label and stays a normal DOM node (not `display: none` via the
 * `hidden` attribute) so it's still reachable by keyboard/AT and by tests.
 */
export function CoverUpload({
  onUploaded,
  onUploadingChange,
  disabled,
  hasExisting = false,
}: CoverUploadProps) {
  const [status, setStatus] = useState<Status>('')
  const uploading = status === 'Uploading…'
  const inputRef = useRef<HTMLInputElement>(null)

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
        ref={inputRef}
        className="cover-upload-input"
        type="file"
        aria-label="Cover image"
        tabIndex={-1}
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
      <button
        type="button"
        className="admin-btn"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
      >
        {hasExisting ? 'Edit image' : 'Add image'}
      </button>
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
