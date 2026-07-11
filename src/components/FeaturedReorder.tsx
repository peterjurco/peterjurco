import { useRef, useState } from 'react'
import './featured-reorder.css'

export interface FeaturedItem {
  id: number
  title: string
}

interface FeaturedReorderProps {
  /** Featured articles in their persisted `featured_position` order. */
  items: FeaturedItem[]
}

type Status = '' | 'Saving…' | 'Saved' | 'Save failed'

/**
 * Drag-sortable list of featured articles for the authenticated homepage.
 *
 * Reordering is optimistic: the list re-renders immediately, then the new id
 * sequence is POSTed to `/api/articles/featured-order`; on failure the order
 * rolls back to what the server last confirmed. Overlapping saves settle
 * last-write-wins via a request-sequence ref — stale responses are ignored,
 * so an old failure never rolls back past a newer confirmed order.
 * Native HTML5 drag-and-drop
 * (no dependency) — the dragged index lives in a ref, not in dataTransfer,
 * which also keeps it testable under jsdom. The Move up/down buttons are the
 * keyboard-accessible path to the same reorder.
 */
export function FeaturedReorder({ items: initialItems }: FeaturedReorderProps) {
  const [items, setItems] = useState(initialItems)
  const [status, setStatus] = useState<Status>('')
  const dragIndex = useRef<number | null>(null)
  const requestSeq = useRef(0)

  async function persist(
    next: FeaturedItem[],
    previous: FeaturedItem[],
  ): Promise<void> {
    const seq = ++requestSeq.current
    setItems(next) // optimistic
    setStatus('Saving…')
    let ok = false
    try {
      const response = await fetch('/api/articles/featured-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: next.map((item) => item.id) }),
      })
      ok = response.ok
    } catch {
      ok = false
    }
    // Only the latest request may settle the UI. A stale failure must not
    // roll back past an order a newer request has already confirmed, and a
    // stale response must not overwrite the newer request's status.
    if (seq !== requestSeq.current) return
    if (ok) {
      setStatus('Saved')
    } else {
      setItems(previous)
      setStatus('Save failed')
    }
  }

  function move(from: number, to: number): void {
    if (from === to || to < 0 || to >= items.length) return
    const next = [...items]
    const [moved] = next.splice(from, 1)
    if (!moved) return
    next.splice(to, 0, moved)
    void persist(next, items)
  }

  if (items.length === 0) {
    return <p className="featured-empty">No featured articles yet.</p>
  }

  return (
    <div className="featured-reorder">
      <ol>
        {items.map((item, index) => (
          <li
            key={item.id}
            draggable
            onDragStart={() => {
              dragIndex.current = index
            }}
            onDragOver={(event) => {
              // Required to make the element a valid drop target.
              event.preventDefault()
            }}
            onDrop={(event) => {
              event.preventDefault()
              const from = dragIndex.current
              dragIndex.current = null
              if (from !== null) move(from, index)
            }}
            onDragEnd={() => {
              dragIndex.current = null
            }}
          >
            <span className="featured-grip" aria-hidden="true">
              ⠿
            </span>
            <a href={`/app/articles/${item.id}`}>{item.title || 'Untitled'}</a>
            <span className="featured-controls">
              {/* The 1-based position disambiguates duplicate titles. */}
              <button
                type="button"
                aria-label={`Move ${item.title || 'Untitled'} (position ${index + 1}) up`}
                onClick={() => move(index, index - 1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move ${item.title || 'Untitled'} (position ${index + 1}) down`}
                onClick={() => move(index, index + 1)}
              >
                ↓
              </button>
            </span>
          </li>
        ))}
      </ol>
      <span
        className={`featured-status${status === 'Saved' ? ' is-success' : ''}${status === 'Save failed' ? ' is-error' : ''}`}
        aria-live="polite"
      >
        {status}
      </span>
    </div>
  )
}
