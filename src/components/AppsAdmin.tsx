import { useRef, useState } from 'react'
import { imageUrl } from '../lib/media/image-url'
import './apps-admin.css'
import { CoverUpload } from './CoverUpload'

/**
 * Admin CRUD for the "My apps" list (REQUIREMENTS "My apps"): a manually
 * ordered list of app links with an optional icon. Reordering posts the
 * whole new order to `/api/apps/reorder` (mirroring `FeaturedReorder` +
 * `featured-order`) rather than PATCHing two rows' `sort_order` in parallel —
 * a pairwise swap can leave two rows sharing a `sort_order` if only one of
 * its two independent requests fails; a full-list rewrite either lands
 * entirely or is rolled back entirely. One busy guard serializes every
 * mutation (move/add/delete/icon-upload), so overlapping moves can't happen
 * through this UI; the request-sequence guard is a cheap defense-in-depth
 * match for `FeaturedReorder`'s pattern in case that ever changes.
 */

export interface AppItem {
  id: number
  name: string
  url: string
  iconKey: string | null
  sortOrder: number
}

interface AppsAdminProps {
  initialApps: AppItem[]
}

type Status = '' | 'Saving…' | 'Save failed' | 'Deleting…' | 'Delete failed'

export function AppsAdmin({ initialApps }: AppsAdminProps) {
  const [apps, setApps] = useState(initialApps)
  const [status, setStatus] = useState<Status>('')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [iconKey, setIconKey] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [validationError, setValidationError] = useState('')
  const reorderSeq = useRef(0)

  // Derived, not stored: a request (or icon upload) is in flight. Guards the
  // double-submit race across reorder/delete/add.
  const busy = status === 'Saving…' || status === 'Deleting…' || uploading

  async function move(index: number, direction: -1 | 1): Promise<void> {
    if (busy) return
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= apps.length) return
    const previous = apps
    const next = [...apps]
    const [moved] = next.splice(index, 1)
    if (!moved) return
    next.splice(targetIndex, 0, moved)

    const seq = ++reorderSeq.current
    setApps(next) // optimistic
    setStatus('Saving…')
    let ok = false
    try {
      const response = await fetch('/api/apps/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: next.map((app) => app.id) }),
      })
      ok = response.ok
    } catch {
      ok = false
    }
    // Only the latest reorder may settle the UI — a stale failure must not
    // roll back past an order a newer request already confirmed.
    if (seq !== reorderSeq.current) return
    if (ok) {
      setApps(next.map((app, i) => ({ ...app, sortOrder: i })))
      setStatus('')
    } else {
      setApps(previous)
      setStatus('Save failed')
    }
  }

  async function remove(app: AppItem): Promise<void> {
    if (busy) return
    if (!window.confirm(`Delete "${app.name}"? This cannot be undone.`)) return
    setStatus('Deleting…')
    try {
      const response = await fetch(`/api/apps/${app.id}`, { method: 'DELETE' })
      if (response.ok) {
        setApps((current) => current.filter((entry) => entry.id !== app.id))
        setStatus('')
      } else {
        setStatus('Delete failed')
      }
    } catch {
      setStatus('Delete failed')
    }
  }

  function validate(): string | null {
    if (name.trim().length === 0) return 'Name is required.'
    if (!url.startsWith('https://')) return 'URL must start with https://.'
    return null
  }

  async function add(): Promise<void> {
    if (busy) return
    const error = validate()
    if (error) {
      setValidationError(error)
      return
    }
    setValidationError('')
    setStatus('Saving…')
    try {
      const response = await fetch('/api/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          url,
          iconKey,
        }),
      })
      if (response.ok) {
        const created = (await response.json()) as {
          id: number
          sortOrder: number
        }
        setApps((current) => [
          ...current,
          {
            id: created.id,
            name: name.trim(),
            url,
            iconKey,
            sortOrder: created.sortOrder,
          },
        ])
        setName('')
        setUrl('')
        setIconKey(null)
        setStatus('')
      } else {
        setStatus('Save failed')
      }
    } catch {
      setStatus('Save failed')
    }
  }

  return (
    <div className="apps-admin">
      {apps.length === 0 && <p>No apps yet.</p>}
      <ul className="apps-admin-list">
        {apps.map((app, index) => (
          <li key={app.id}>
            {app.iconKey && (
              <img src={imageUrl(app.iconKey, { width: 64 })} alt="" />
            )}
            <a href={app.url} target="_blank" rel="noreferrer">
              {app.name}
            </a>
            <span className="apps-admin-controls">
              <button
                type="button"
                disabled={busy || index === 0}
                onClick={() => void move(index, -1)}
                aria-label={`Move ${app.name} up`}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={busy || index === apps.length - 1}
                onClick={() => void move(index, 1)}
                aria-label={`Move ${app.name} down`}
              >
                ↓
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove(app)}
              >
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>

      <form
        className="apps-admin-form"
        onSubmit={(event) => {
          event.preventDefault()
          void add()
        }}
      >
        <h2>Add app</h2>
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
          URL
          <input
            type="url"
            aria-label="URL"
            placeholder="https://…"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <div>
          Icon {iconKey ? '(uploaded)' : '(none)'}
          <CoverUpload
            onUploaded={(key) => setIconKey(key)}
            onUploadingChange={setUploading}
            disabled={busy && !uploading}
          />
        </div>
        {validationError && <p role="alert">{validationError}</p>}
        <button type="submit" disabled={busy}>
          Add
        </button>
        <span
          className={
            status === 'Save failed' || status === 'Delete failed'
              ? 'is-error'
              : ''
          }
          aria-live="polite"
        >
          {status}
        </span>
      </form>
    </div>
  )
}
