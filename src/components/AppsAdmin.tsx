import { useState } from 'react'
import { imageUrl } from '../lib/media/image-url'
import { CoverUpload } from './CoverUpload'

/**
 * Admin CRUD for the "My apps" list (REQUIREMENTS "My apps"): a manually
 * ordered list of app links with an optional icon. Reordering swaps
 * `sort_order` with the neighbor and PATCHes both — simplest correct
 * approach, no drag library needed for a handful of rows. One busy guard
 * covers reorder/delete/add/icon-upload so nothing double-submits.
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

async function patchSortOrder(id: number, sortOrder: number): Promise<boolean> {
  try {
    const response = await fetch(`/api/apps/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sortOrder }),
    })
    return response.ok
  } catch {
    return false
  }
}

export function AppsAdmin({ initialApps }: AppsAdminProps) {
  const [apps, setApps] = useState(initialApps)
  const [status, setStatus] = useState<Status>('')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [iconKey, setIconKey] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [validationError, setValidationError] = useState('')

  // Derived, not stored: a request (or icon upload) is in flight. Guards the
  // double-submit race across reorder/delete/add.
  const busy = status === 'Saving…' || status === 'Deleting…' || uploading

  async function move(index: number, direction: -1 | 1): Promise<void> {
    if (busy) return
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= apps.length) return
    const current = apps[index]
    const target = apps[targetIndex]
    if (!current || !target) return

    setStatus('Saving…')
    const [currentOk, targetOk] = await Promise.all([
      patchSortOrder(current.id, target.sortOrder),
      patchSortOrder(target.id, current.sortOrder),
    ])
    if (currentOk && targetOk) {
      const next = [...apps]
      next[index] = { ...target, sortOrder: current.sortOrder }
      next[targetIndex] = { ...current, sortOrder: target.sortOrder }
      setApps(next)
      setStatus('')
    } else {
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
        <span aria-live="polite">{status}</span>
      </form>
    </div>
  )
}
