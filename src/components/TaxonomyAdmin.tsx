import { useState } from 'react'
import './taxonomy-admin.css'

/**
 * Admin CRUD for the three taxonomies (REQUIREMENTS "Admin" — edit
 * categories and tags): article categories, article tags and photo tags.
 * Each section is a simple list — click a name to rename inline — plus an
 * add-form. Photo tags additionally carry a public/private toggle; flipping
 * a PUBLIC tag private, or deleting one, warns that its `/t/:publicId` share
 * link stops working (the API allows it regardless — this is a UI-only
 * guard rail). `useTaxonomyCrud` holds the rename/delete/add plumbing (incl.
 * the busy guard against double-submits) shared by both section kinds.
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

/**
 * Rename/delete/add plumbing shared by every taxonomy section, including
 * photo tags (which layer a visibility toggle on top via their own
 * `jsonFetch` call, reusing this hook's `busy`/`status`).
 */
function useTaxonomyCrud<T extends TaxonomyItem>(
  apiBase: string,
  items: T[],
  onChange: (next: T[]) => void,
) {
  const [status, setStatus] = useState<Status>('')
  const busy = status === 'Saving…' || status === 'Deleting…'

  async function rename(id: number, name: string): Promise<void> {
    if (busy || name.length === 0) return
    setStatus('Saving…')
    const ok = await jsonFetch(`${apiBase}/${id}`, 'PATCH', { name })
    if (ok) {
      onChange(items.map((item) => (item.id === id ? { ...item, name } : item)))
      setStatus('')
    } else {
      setStatus('Save failed')
    }
  }

  async function remove(item: T, confirmMessage: string): Promise<void> {
    if (busy) return
    if (!window.confirm(confirmMessage)) return
    setStatus('Deleting…')
    const ok = await jsonFetch(`${apiBase}/${item.id}`, 'DELETE', undefined)
    if (ok) {
      onChange(items.filter((entry) => entry.id !== item.id))
      setStatus('')
    } else {
      setStatus('Delete failed')
    }
  }

  async function add(name: string): Promise<void> {
    if (busy || name.length === 0) return
    setStatus('Saving…')
    try {
      const response = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (response.ok) {
        const created = (await response.json()) as T
        onChange([...items, created])
        setStatus('')
        return
      }
      setStatus('Save failed')
    } catch {
      setStatus('Save failed')
    }
  }

  return { status, busy, setStatus, rename, remove, add }
}

/** Click-to-edit name: a plain button, swapped for an input + Save/Cancel. */
function EditableName({
  name,
  busy,
  onRename,
}: {
  name: string
  busy: boolean
  onRename: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)

  if (!editing) {
    return (
      <button
        type="button"
        className="taxonomy-name"
        onClick={() => {
          setDraft(name)
          setEditing(true)
        }}
      >
        {name}
      </button>
    )
  }

  return (
    <>
      <input
        type="text"
        aria-label={`Rename ${name}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          onRename(draft.trim())
          setEditing(false)
        }}
      >
        Save
      </button>
      <button type="button" disabled={busy} onClick={() => setEditing(false)}>
        Cancel
      </button>
    </>
  )
}

/** Add-form: a labeled text input plus a submit button. */
function AddForm({
  label,
  busy,
  status,
  onAdd,
}: {
  label: string
  busy: boolean
  status: Status
  onAdd: (name: string) => void
}) {
  const [name, setName] = useState('')
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onAdd(name.trim())
        setName('')
      }}
    >
      <input
        type="text"
        aria-label={label}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <button type="submit" disabled={busy}>
        Add
      </button>
      <span
        className={status === 'Save failed' ? 'is-error' : ''}
        aria-live="polite"
      >
        {status}
      </span>
    </form>
  )
}

/** List + rename + delete + add for a plain `{id, name}` taxonomy. */
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
  const { status, busy, rename, remove, add } = useTaxonomyCrud(
    apiBase,
    items,
    onChange,
  )

  return (
    <section className="taxonomy-section">
      <h2>{title}</h2>
      {items.length === 0 && <p>None yet.</p>}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <EditableName
              name={item.name}
              busy={busy}
              onRename={(name) => void rename(item.id, name)}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void remove(
                  item,
                  `Delete "${item.name}"? This cannot be undone.`,
                )
              }
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <AddForm
        label={`New ${title.toLowerCase()} name`}
        busy={busy}
        status={status}
        onAdd={(name) => void add(name)}
      />
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
  const { status, busy, setStatus, rename, remove, add } = useTaxonomyCrud(
    PHOTO_TAGS_API,
    items,
    onChange,
  )

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

  function deleteMessage(item: PhotoTagItem): string {
    return item.visibility === 'public'
      ? `Delete "${item.name}"? Its public share link (/t/…) will stop working. This cannot be undone.`
      : `Delete "${item.name}"? This cannot be undone.`
  }

  return (
    <section className="taxonomy-section">
      <h2>Photo tags</h2>
      {items.length === 0 && <p>None yet.</p>}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <EditableName
              name={item.name}
              busy={busy}
              onRename={(name) => void rename(item.id, name)}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void toggleVisibility(item)}
            >
              {item.visibility === 'public' ? 'Make private' : 'Make public'}
            </button>
            <span className={`badge badge-${item.visibility}`}>
              {item.visibility}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove(item, deleteMessage(item))}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <AddForm
        label="New photo tag name"
        busy={busy}
        status={status}
        onAdd={(name) => void add(name)}
      />
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
