import { useState } from 'react'
import { isGooglePhotosUrl } from '../lib/photos/album-url'
import { CoverUpload } from './CoverUpload'

/**
 * Add/edit form for a photo-hub album: name, Google Photos share URL, tags
 * (comma-separated, created on the fly server-side) and a cover uploaded to
 * R2 via CoverUpload. One explicit Save — unlike the always-editing article
 * page, an album is a small record edited rarely.
 */

interface AlbumFormProps {
  /** When set, the form edits (PATCH/DELETE) instead of creating (POST). */
  albumId?: number
  initialName?: string
  initialGooglePhotosUrl?: string
  initialTags?: string[]
  initialCoverImageKey?: string | null
  /** Test hook — defaults to a real browser navigation. */
  navigate?: (url: string) => void
}

type Status = '' | 'Saving…' | 'Save failed'

export function AlbumForm({
  albumId,
  initialName = '',
  initialGooglePhotosUrl = '',
  initialTags = [],
  initialCoverImageKey = null,
  navigate = (url) => {
    window.location.href = url
  },
}: AlbumFormProps) {
  const [name, setName] = useState(initialName)
  const [googlePhotosUrl, setGooglePhotosUrl] = useState(initialGooglePhotosUrl)
  const [tagsText, setTagsText] = useState(initialTags.join(', '))
  const [coverImageKey, setCoverImageKey] = useState(initialCoverImageKey)
  const [status, setStatus] = useState<Status>('')
  const [validationError, setValidationError] = useState('')

  function parseTags(text: string): string[] {
    return text
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
  }

  /** Returns the error message, or null when the form is submittable. */
  function validate(): string | null {
    if (name.trim().length === 0) return 'Name is required.'
    if (!isGooglePhotosUrl(googlePhotosUrl)) {
      return 'The link must be a Google Photos link (https://photos.app.goo.gl/… or https://photos.google.com/…).'
    }
    return null
  }

  async function save(): Promise<void> {
    const error = validate()
    if (error) {
      setValidationError(error)
      return
    }
    setValidationError('')
    setStatus('Saving…')
    try {
      const response = await fetch(
        albumId === undefined
          ? '/api/photos/albums'
          : `/api/photos/albums/${albumId}`,
        {
          method: albumId === undefined ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            googlePhotosUrl,
            coverImageKey,
            tags: parseTags(tagsText),
          }),
        },
      )
      if (response.ok) {
        navigate('/app/photos')
      } else {
        setStatus('Save failed')
      }
    } catch {
      setStatus('Save failed')
    }
  }

  async function remove(): Promise<void> {
    if (albumId === undefined) return
    if (!window.confirm('Delete this album? This cannot be undone.')) return
    try {
      const response = await fetch(`/api/photos/albums/${albumId}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        navigate('/app/photos')
      } else {
        setStatus('Save failed')
      }
    } catch {
      setStatus('Save failed')
    }
  }

  return (
    <form
      className="album-form"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <label>
        Name
        <input
          type="text"
          aria-label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Google Photos URL
        <input
          type="url"
          aria-label="Google Photos URL"
          placeholder="https://photos.app.goo.gl/…"
          value={googlePhotosUrl}
          onChange={(event) => setGooglePhotosUrl(event.target.value)}
        />
      </label>
      <label>
        Tags
        <input
          type="text"
          aria-label="Tags"
          placeholder="tags, comma, separated"
          value={tagsText}
          onChange={(event) => setTagsText(event.target.value)}
        />
      </label>
      <div>
        Cover {coverImageKey ? '(uploaded)' : '(none)'}
        <CoverUpload onUploaded={(key) => setCoverImageKey(key)} />
      </div>
      {validationError && <p role="alert">{validationError}</p>}
      <div className="album-form-actions">
        <button type="submit">Save</button>
        {albumId !== undefined && (
          <button type="button" onClick={() => void remove()}>
            Delete
          </button>
        )}
        <span aria-live="polite">{status}</span>
      </div>
    </form>
  )
}
