import { useState } from 'react'

/**
 * Admin CRUD for the three taxonomies (REQUIREMENTS "Admin" — edit
 * categories and tags): article categories, article tags and photo tags.
 * Each section is a simple list — click a name to rename inline — plus an
 * add-form. Photo tags additionally carry a public/private toggle; flipping
 * a PUBLIC tag private, or deleting one, warns that its `/t/:publicId` share
 * link stops working (the API allows it regardless — this is a UI-only
 * guard rail). One shared busy flag per section blocks double-submits.
 */

export interface TaxonomyItem {
  id: number
  name: string
}

export interface PhotoTagItem extends TaxonomyItem {
  visibility: 'private' | 'public'
}

interface TaxonomyAdminProps {
  initialCategories: TaxonomyItem[]
  initialArticleTags: TaxonomyItem[]
  initialPhotoTags: PhotoTagItem[]
}

type Status = '' | 'Saving…' | 'Save failed' | 'Deleting…' | 'Delete failed'

async function jsonFetch(
  url: string,
  method: string,
  body: unknown,
): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return response.ok
  } catch {
    return false
  }
}

/** Generic list + rename + delete + add for a `{id, name}` taxonomy. */
function TaxonomySection({
  title,
  apiBase,
  items,
  onChange,
}: {
  title: string
  apiBase: string
  items: TaxonomyItem[]
  onChange: (next: TaxonomyItem[]) => void
}) {
  const [status, setStatus] = useState<Status>('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [newName, setNewName] = useState('')

  const busy = status === 'Saving…' || status === 'Deleting…'

  async function rename(id: number): Promise<void> {
    if (busy) return
    const name = editingName.trim()
    if (name.length === 0) return
    setStatus('Saving…')
    const ok = await jsonFetch(`${apiBase}/${id}`, 'PATCH', { name })
    if (ok) {
      onChange(items.map((item) => (item.id === id ? { ...item, name } : item)))
      setEditingId(null)
      setStatus('')
    } else {
      setStatus('Save failed')
    }
  }

  async function remove(item: TaxonomyItem): Promise<void> {
    if (busy) return
    if (!window.confirm(`Delete "${item.name}"? This cannot be undone.`)) return
    setStatus('Deleting…')
    const ok = await jsonFetch(`${apiBase}/${item.id}`, 'DELETE', undefined)
    if (ok) {
      onChange(items.filter((entry) => entry.id !== item.id))
      setStatus('')
    } else {
      setStatus('Delete failed')
    }
  }

  async function add(): Promise<void> {
    if (busy) return
    const name = newName.trim()
    if (name.length === 0) return
    setStatus('Saving…')
    try {
      const response = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (response.ok) {
        const created = (await response.json()) as { id: number; name: string }
        onChange([...items, created])
        setNewName('')
        setStatus('')
      } else {
        setStatus('Save failed')
      }
    } catch {
      setStatus('Save failed')
    }
  }

  return (
    <section className="taxonomy-section">
      <h2>{title}</h2>
      {items.length === 0 && <p>None yet.</p>}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {editingId === item.id ? (
              <>
                <input
                  type="text"
                  aria-label={`Rename ${item.name}`}
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void rename(item.id)}
                >
                  Save
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditingId(null)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="taxonomy-name"
                  onClick={() => {
                    setEditingId(item.id)
                    setEditingName(item.name)
                  }}
                >
                  {item.name}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(item)}
                >
                  Delete
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void add()
        }}
      >
        <input
          type="text"
          aria-label={`New ${title.toLowerCase()} name`}
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <button type="submit" disabled={busy}>
          Add
        </button>
        <span aria-live="polite">{status}</span>
      </form>
    </section>
  )
}

const PHOTO_TAGS_API = '/api/taxonomy/photo-tags'

function PhotoTagsSection({
  items,
  onChange,
}: {
  items: PhotoTagItem[]
  onChange: (next: PhotoTagItem[]) => void
}) {
  const [status, setStatus] = useState<Status>('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [newName, setNewName] = useState('')

  const busy = status === 'Saving…' || status === 'Deleting…'

  async function rename(id: number): Promise<void> {
    if (busy) return
    const name = editingName.trim()
    if (name.length === 0) return
    setStatus('Saving…')
    const ok = await jsonFetch(`${PHOTO_TAGS_API}/${id}`, 'PATCH', { name })
    if (ok) {
      onChange(items.map((item) => (item.id === id ? { ...item, name } : item)))
      setEditingId(null)
      setStatus('')
    } else {
      setStatus('Save failed')
    }
  }

  async function toggleVisibility(item: PhotoTagItem): Promise<void> {
    if (busy) return
    const nextVisibility = item.visibility === 'public' ? 'private' : 'public'
    if (
      item.visibility === 'public' &&
      nextVisibility === 'private' &&
      !window.confirm(
        `Make "${item.name}" private? Its public share link (/t/…) will stop working.`,
      )
    ) {
      return
    }
    setStatus('Saving…')
    const ok = await jsonFetch(`${PHOTO_TAGS_API}/${item.id}`, 'PATCH', {
      visibility: nextVisibility,
    })
    if (ok) {
      onChange(
        items.map((entry) =>
          entry.id === item.id
            ? { ...entry, visibility: nextVisibility }
            : entry,
        ),
      )
      setStatus('')
    } else {
      setStatus('Save failed')
    }
  }

  async function remove(item: PhotoTagItem): Promise<void> {
    if (busy) return
    const message =
      item.visibility === 'public'
        ? `Delete "${item.name}"? Its public share link (/t/…) will stop working. This cannot be undone.`
        : `Delete "${item.name}"? This cannot be undone.`
    if (!window.confirm(message)) return
    setStatus('Deleting…')
    const ok = await jsonFetch(
      `${PHOTO_TAGS_API}/${item.id}`,
      'DELETE',
      undefined,
    )
    if (ok) {
      onChange(items.filter((entry) => entry.id !== item.id))
      setStatus('')
    } else {
      setStatus('Delete failed')
    }
  }

  async function add(): Promise<void> {
    if (busy) return
    const name = newName.trim()
    if (name.length === 0) return
    setStatus('Saving…')
    try {
      const response = await fetch(PHOTO_TAGS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (response.ok) {
        const created = (await response.json()) as PhotoTagItem
        onChange([...items, created])
        setNewName('')
        setStatus('')
      } else {
        setStatus('Save failed')
      }
    } catch {
      setStatus('Save failed')
    }
  }

  return (
    <section className="taxonomy-section">
      <h2>Photo tags</h2>
      {items.length === 0 && <p>None yet.</p>}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {editingId === item.id ? (
              <>
                <input
                  type="text"
                  aria-label={`Rename ${item.name}`}
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void rename(item.id)}
                >
                  Save
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditingId(null)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="taxonomy-name"
                  onClick={() => {
                    setEditingId(item.id)
                    setEditingName(item.name)
                  }}
                >
                  {item.name}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void toggleVisibility(item)}
                >
                  {item.visibility === 'public'
                    ? 'Make private'
                    : 'Make public'}
                </button>
                <span className={`badge badge-${item.visibility}`}>
                  {item.visibility}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(item)}
                >
                  Delete
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void add()
        }}
      >
        <input
          type="text"
          aria-label="New photo tag name"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <button type="submit" disabled={busy}>
          Add
        </button>
        <span aria-live="polite">{status}</span>
      </form>
    </section>
  )
}

export function TaxonomyAdmin({
  initialCategories,
  initialArticleTags,
  initialPhotoTags,
}: TaxonomyAdminProps) {
  const [categories, setCategories] = useState(initialCategories)
  const [articleTags, setArticleTags] = useState(initialArticleTags)
  const [photoTags, setPhotoTags] = useState(initialPhotoTags)

  return (
    <div className="taxonomy-admin">
      <TaxonomySection
        title="Article categories"
        apiBase="/api/taxonomy/article-categories"
        items={categories}
        onChange={setCategories}
      />
      <TaxonomySection
        title="Article tags"
        apiBase="/api/taxonomy/article-tags"
        items={articleTags}
        onChange={setArticleTags}
      />
      <PhotoTagsSection items={photoTags} onChange={setPhotoTags} />
    </div>
  )
}
