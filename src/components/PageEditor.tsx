import { useEffect, useRef, useState } from 'react'
import type { PageMode, PageSortKey, PageVisibility } from '../lib/pages/repo'
import type { CategoryOption, TagOption } from './PageAutoFilter'
import { PageAutoFilter } from './PageAutoFilter'
import type { ArticleOption } from './PageManualArticles'
import { PageManualArticles } from './PageManualArticles'
import './page-editor.css'

export type { ArticleOption, CategoryOption, TagOption }

interface PageEditorProps {
  pageId: number
  initialSlug: string
  initialTitle: string
  initialVisibility: PageVisibility
  initialMode: PageMode
  initialArticleIds: number[]
  initialCategoryId: number | null
  initialTagId: number | null
  initialSortKey: PageSortKey
  initialShowTags: boolean
  initialShowCreatedDate: boolean
  initialShowUpdatedDate: boolean
  categories: CategoryOption[]
  tags: TagOption[]
  articles: ArticleOption[]
  /** Debounce before the title/slug autosave PATCH fires. Overridable for tests. */
  debounceMs?: number
  /** Test hook — defaults to a real browser navigation. */
  navigate?: (url: string) => void
}

type Status = '' | 'Saving…' | 'Saved' | 'Save failed'

/**
 * The page editor: owns all state and persistence (one shared
 * pendingPatch/debounce, same pattern as ArticleMetaPanel.tsx), and composes
 * PageAutoFilter/PageManualArticles as controlled sub-views — neither of
 * them fetches on its own, which avoids losing an in-progress edit if the
 * user flips mode and back before a reload (they'd otherwise remount from
 * stale initial props).
 */
export function PageEditor({
  pageId,
  initialSlug,
  initialTitle,
  initialVisibility,
  initialMode,
  initialArticleIds,
  initialCategoryId,
  initialTagId,
  initialSortKey,
  initialShowTags,
  initialShowCreatedDate,
  initialShowUpdatedDate,
  categories,
  tags,
  articles,
  debounceMs = 600,
  navigate = (url) => {
    window.location.href = url
  },
}: PageEditorProps) {
  const [slug, setSlug] = useState(initialSlug)
  const [title, setTitle] = useState(initialTitle)
  const [visibility, setVisibility] = useState(initialVisibility)
  const [mode, setMode] = useState(initialMode)
  const [articleIds, setArticleIds] = useState(initialArticleIds)
  const [categoryId, setCategoryId] = useState(initialCategoryId)
  const [tagId, setTagId] = useState(initialTagId)
  const [sortKey, setSortKey] = useState(initialSortKey)
  const [showTags, setShowTags] = useState(initialShowTags)
  const [showCreatedDate, setShowCreatedDate] = useState(initialShowCreatedDate)
  const [showUpdatedDate, setShowUpdatedDate] = useState(initialShowUpdatedDate)
  const [status, setStatus] = useState<Status>('')
  const [error, setError] = useState('')
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pendingPatch = useRef<Record<string, unknown>>({})

  function hasPendingEdits(): boolean {
    return Object.keys(pendingPatch.current).length > 0
  }

  /** One PATCH, right now. Returns whether it succeeded. */
  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setStatus('Saving…')
    setError('')
    try {
      const response = await fetch(`/api/pages/${pageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!hasPendingEdits()) {
        setStatus(response.ok ? 'Saved' : 'Save failed')
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        setError(payload?.error ?? 'Save failed')
      }
      return response.ok
    } catch {
      if (!hasPendingEdits()) setStatus('Save failed')
      setError('Network error — please check your connection and try again.')
      return false
    }
  }

  /** Sends everything pending, plus `fields`, right now — as one PATCH. */
  async function flushPatch(
    fields: Record<string, unknown> = {},
  ): Promise<boolean> {
    clearTimeout(debounceTimer.current)
    const body = { ...pendingPatch.current, ...fields }
    pendingPatch.current = {}
    if (Object.keys(body).length === 0) return true
    return patch(body)
  }

  /** Merges `fields` into the pending patch; one shared timer flushes it. */
  function patchDebounced(fields: Record<string, unknown>): void {
    Object.assign(pendingPatch.current, fields)
    setStatus('Saving…')
    clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => void flushPatch(), debounceMs)
  }

  async function toggleVisibility(): Promise<void> {
    const next: PageVisibility = visibility === 'private' ? 'public' : 'private'
    if (await flushPatch({ visibility: next })) setVisibility(next)
  }

  /**
   * Switching modes clears the OTHER mode's fields (design spec: "Switching
   * modes in the UI clears the other mode's fields") — otherwise a stale
   * articleIds list or category/tag filter from a prior stint in the other
   * mode would silently resurface if the admin switches back later.
   */
  async function changeMode(next: PageMode): Promise<void> {
    const clearFields =
      next === 'auto'
        ? { articleIds: [] as number[] }
        : { categoryId: null, tagId: null }
    if (await flushPatch({ mode: next, ...clearFields })) {
      setMode(next)
      if (next === 'auto') {
        setArticleIds([])
      } else {
        setCategoryId(null)
        setTagId(null)
      }
    }
  }

  async function changeFilter(filter: {
    categoryId: number | null
    tagId: number | null
  }): Promise<void> {
    if (await flushPatch(filter)) {
      setCategoryId(filter.categoryId)
      setTagId(filter.tagId)
    }
  }

  async function changeSortKey(next: PageSortKey): Promise<void> {
    if (await flushPatch({ sortKey: next })) setSortKey(next)
  }

  async function toggleShowTags(): Promise<void> {
    const next = !showTags
    if (await flushPatch({ showTags: next })) setShowTags(next)
  }

  async function toggleShowCreatedDate(): Promise<void> {
    const next = !showCreatedDate
    if (await flushPatch({ showCreatedDate: next })) setShowCreatedDate(next)
  }

  async function toggleShowUpdatedDate(): Promise<void> {
    const next = !showUpdatedDate
    if (await flushPatch({ showUpdatedDate: next })) setShowUpdatedDate(next)
  }

  /** Optimistic — the list should feel instant while dragging/picking. */
  async function changeArticleIds(next: number[]): Promise<void> {
    const previous = articleIds
    setArticleIds(next)
    if (!(await flushPatch({ articleIds: next }))) {
      setArticleIds((current) => (current === next ? previous : current))
    }
  }

  async function remove(): Promise<void> {
    if (!window.confirm('Delete this page? This cannot be undone.')) return
    const response = await fetch(`/api/pages/${pageId}`, { method: 'DELETE' })
    if (response.ok) {
      navigate('/app/pages')
    } else {
      setStatus('Save failed')
    }
  }

  // Unsaved edits must survive navigation/unmount — same reasoning as
  // ArticleMetaPanel.tsx.
  useEffect(() => {
    const flushPendingWithKeepalive = () => {
      clearTimeout(debounceTimer.current)
      const body = pendingPatch.current
      pendingPatch.current = {}
      if (Object.keys(body).length === 0) return
      void fetch(`/api/pages/${pageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
      })
    }
    window.addEventListener('pagehide', flushPendingWithKeepalive)
    return () => {
      window.removeEventListener('pagehide', flushPendingWithKeepalive)
      flushPendingWithKeepalive()
    }
  }, [pageId])

  useEffect(() => {
    if (status !== 'Saving…') return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [status])

  return (
    <div className="page-editor">
      <input
        className="page-editor-title"
        type="text"
        aria-label="Title"
        placeholder="Untitled"
        value={title}
        onChange={(event) => {
          setTitle(event.target.value)
          patchDebounced({ title: event.target.value })
        }}
      />
      <div className="page-editor-row">
        <label className="page-editor-slug">
          peterjur.co/
          <input
            type="text"
            aria-label="Slug"
            value={slug}
            onChange={(event) => {
              setSlug(event.target.value)
              patchDebounced({ slug: event.target.value })
            }}
          />
        </label>
        <button type="button" onClick={() => void toggleVisibility()}>
          {visibility === 'private' ? 'Make public' : 'Make private'}
        </button>
        {visibility === 'public' && (
          <a href={`/${slug}`} target="_blank" rel="noreferrer">
            Public link
          </a>
        )}
        <button
          type="button"
          className="page-editor-delete"
          onClick={() => void remove()}
        >
          Delete
        </button>
      </div>
      <div className="page-editor-row page-editor-mode">
        <label>
          <input
            type="radio"
            name="mode"
            checked={mode === 'manual'}
            onChange={() => void changeMode('manual')}
          />
          Manually curated
        </label>
        <label>
          <input
            type="radio"
            name="mode"
            aria-label="Auto by category/tag"
            checked={mode === 'auto'}
            onChange={() => void changeMode('auto')}
          />
          Auto by category/tag
        </label>
      </div>
      <div className="page-editor-row page-editor-display">
        <label>
          <input
            type="checkbox"
            checked={showTags}
            onChange={() => void toggleShowTags()}
          />
          Show tags
        </label>
        <label>
          <input
            type="checkbox"
            checked={showCreatedDate}
            onChange={() => void toggleShowCreatedDate()}
          />
          Show date created
        </label>
        <label>
          <input
            type="checkbox"
            checked={showUpdatedDate}
            onChange={() => void toggleShowUpdatedDate()}
          />
          Show date modified
        </label>
      </div>
      {error && <p className="page-editor-error">{error}</p>}
      <span
        className={`page-editor-status${status === 'Saved' ? ' is-success' : ''}${status === 'Save failed' ? ' is-error' : ''}`}
        aria-live="polite"
      >
        {status}
      </span>
      {mode === 'auto' ? (
        <PageAutoFilter
          categories={categories}
          tags={tags}
          categoryId={categoryId}
          tagId={tagId}
          sortKey={sortKey}
          onChangeFilter={(filter) => void changeFilter(filter)}
          onChangeSortKey={(next) => void changeSortKey(next)}
        />
      ) : (
        <PageManualArticles
          articles={articles}
          articleIds={articleIds}
          onChange={(next) => void changeArticleIds(next)}
        />
      )}
    </div>
  )
}
