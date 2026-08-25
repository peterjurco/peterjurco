import { useEffect, useRef, useState } from 'react'
import { setSaveStatus } from '../lib/articles/save-status'
import './article-editor.css'

interface CategoryOption {
  id: number
  name: string
}

interface ArticleMetaPanelProps {
  articleId: number
  publicId: string
  initialTitle: string
  initialVisibility: 'private' | 'public'
  initialCategoryId: number | null
  initialTags: string[]
  initialIsFeatured: boolean
  categories: CategoryOption[]
  /** Every existing tag name, for the type-ahead dropdown. */
  allTagNames: string[]
  /** Most-used tag names per category id, for the quick-add chips. */
  topTagsByCategory: Record<number, string[]>
  /** Quick-add chips only show while the article is fresh — see [id].astro. */
  createdToday: boolean
  /** Debounce before the autosave PATCH fires. Overridable for tests. */
  debounceMs?: number
  /** Test hook — defaults to a real browser navigation. */
  navigate?: (url: string) => void
}

const MAX_TAG_SUGGESTIONS = 8

type MetaState = '' | 'Saving…' | 'Saved' | 'Save failed'

/**
 * Minimal metadata panel for the editor page: title, category, tags,
 * visibility toggle, featured flag, delete. Featured-photo upload arrives
 * with the media layer (Plan 5); taxonomy admin with Plan 7.
 */
export function ArticleMetaPanel({
  articleId,
  publicId,
  initialTitle,
  initialVisibility,
  initialCategoryId,
  initialTags,
  initialIsFeatured,
  categories,
  allTagNames,
  topTagsByCategory,
  createdToday,
  debounceMs = 600,
  navigate = (url) => {
    window.location.href = url
  },
}: ArticleMetaPanelProps) {
  const [title, setTitle] = useState(initialTitle)
  const [visibility, setVisibility] = useState(initialVisibility)
  const [categoryId, setCategoryId] = useState(initialCategoryId)
  const [tagsText, setTagsText] = useState(initialTags.join(', '))
  const [isFeatured, setIsFeatured] = useState(initialIsFeatured)
  const [status, setStatusRaw] = useState<MetaState>('')
  const [tagsFocused, setTagsFocused] = useState(false)
  /**
   * Quick-add chips dismissed with the × button — this article's session
   * only, not persisted. Reopening this article (or any other) starts fresh;
   * the underlying usage ranking never changes.
   */
  const [rejectedQuickTags, setRejectedQuickTags] = useState<Set<string>>(
    new Set(),
  )
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  /**
   * Fields edited but not yet PATCHed. Accumulated across debounced edits and
   * sent as ONE body, so a later edit never cancels an earlier field's save.
   */
  const pendingPatch = useRef<Record<string, unknown>>({})
  /** Last tag set sent to the server — commits are skipped when unchanged. */
  const committedTags = useRef(initialTags.join(' '))

  /** True while fields sit in pendingPatch waiting for the debounce timer. */
  function hasPendingEdits(): boolean {
    return Object.keys(pendingPatch.current).length > 0
  }

  /** Mirrors every transition into the page's shared save-status store. */
  function setStatus(next: MetaState): void {
    setStatusRaw(next)
    setSaveStatus(
      'meta',
      next === 'Saving…'
        ? 'saving'
        : next === 'Saved'
          ? 'saved'
          : next === 'Save failed'
            ? 'error'
            : 'idle',
    )
  }

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setStatus('Saving…')
    try {
      const response = await fetch(`/api/articles/${articleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      // Newer edits queued mid-flight keep the state dirty (and the
      // beforeunload guard armed) until their own flush resolves.
      if (!hasPendingEdits()) {
        setStatus(response.ok ? 'Saved' : 'Save failed')
      }
      return response.ok
    } catch {
      if (!hasPendingEdits()) setStatus('Save failed')
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

  function parseTags(text: string): string[] {
    return text
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
  }

  function commitTagList(tags: string[]): void {
    const normalized = tags.join(' ')
    if (normalized === committedTags.current) return
    committedTags.current = normalized
    void flushPatch({ tags })
  }

  /**
   * Typed tags PATCH on blur/Enter only — per-keystroke saves would create a
   * tag row for every prefix typed ("t", "tr", "tra", …).
   */
  function commitTags(): void {
    commitTagList(parseTags(tagsText))
  }

  /**
   * A tag added via the quick-add chips (below) is a single discrete click,
   * not an in-progress keystroke — commits immediately, same as a category
   * change, rather than waiting for blur/Enter.
   */
  function addTag(name: string): void {
    const current = parseTags(tagsText)
    if (current.includes(name)) return
    const next = [...current, name]
    setTagsText(next.join(', '))
    commitTagList(next)
  }

  /** Replaces the tag currently being typed with a full picked suggestion. */
  function selectSuggestion(name: string): void {
    const lastComma = tagsText.lastIndexOf(',')
    const prefix =
      lastComma === -1 ? '' : `${tagsText.slice(0, lastComma + 1)} `
    setTagsText(`${prefix}${name}, `)
  }

  /** Dismisses a quick-add chip without adding it — this article only. */
  function rejectQuickTag(name: string): void {
    setRejectedQuickTags((current) => new Set(current).add(name))
  }

  // Everything after the last comma is "still being typed" — matched against
  // every known tag name for the dropdown. Both the dropdown and the
  // quick-add chips exclude tags already present, so neither ever suggests
  // a duplicate.
  const tagsLastComma = tagsText.lastIndexOf(',')
  const tagFragment = (
    tagsLastComma === -1 ? tagsText : tagsText.slice(tagsLastComma + 1)
  ).trim()
  const chosenTags = new Set(parseTags(tagsText))
  const tagSuggestions =
    tagFragment.length === 0
      ? []
      : allTagNames
          .filter((name) =>
            name.toLowerCase().includes(tagFragment.toLowerCase()),
          )
          .filter((name) => !chosenTags.has(name) || name === tagFragment)
          .slice(0, MAX_TAG_SUGGESTIONS)
  const quickTags = (
    categoryId === null ? [] : (topTagsByCategory[categoryId] ?? [])
  ).filter((name) => !chosenTags.has(name) && !rejectedQuickTags.has(name))

  async function toggleVisibility(): Promise<void> {
    const next = visibility === 'private' ? 'public' : 'private'
    if (await flushPatch({ visibility: next })) setVisibility(next)
  }

  async function toggleFeatured(): Promise<void> {
    const next = !isFeatured
    if (await flushPatch({ isFeatured: next })) setIsFeatured(next)
  }

  async function remove(): Promise<void> {
    if (!window.confirm('Delete this article? This cannot be undone.')) return
    const response = await fetch(`/api/articles/${articleId}`, {
      method: 'DELETE',
    })
    if (response.ok) {
      navigate('/app/articles')
    } else {
      setStatus('Save failed')
    }
  }

  // Unsaved edits must survive navigation/unmount: flush whatever is still
  // pending with keepalive so the request outlives the page. Runs on React
  // unmount (client-side transitions) AND on pagehide — Astro is an MPA, so
  // hard navigations skip React cleanups entirely.
  useEffect(() => {
    const flushPendingWithKeepalive = () => {
      clearTimeout(debounceTimer.current)
      const body = pendingPatch.current
      pendingPatch.current = {}
      if (Object.keys(body).length === 0) return
      void fetch(`/api/articles/${articleId}`, {
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
  }, [articleId])

  // While an edit is pending or in flight, warn before the tab closes.
  useEffect(() => {
    if (status !== 'Saving…') return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [status])

  // Keep the tab title in sync as the title is edited — matches the format
  // the SSR page sets initially (src/pages/app/articles/[id].astro).
  useEffect(() => {
    document.title = `${title || 'Untitled'} — peterjur.co`
  }, [title])

  return (
    <div className="article-meta-panel">
      <input
        className="article-meta-title"
        type="text"
        aria-label="Title"
        placeholder="Untitled"
        value={title}
        onChange={(event) => {
          setTitle(event.target.value)
          patchDebounced({ title: event.target.value })
        }}
      />
      <div className="article-meta-row">
        <select
          aria-label="Category"
          value={categoryId ?? ''}
          onChange={(event) => {
            const next =
              event.target.value === '' ? null : Number(event.target.value)
            setCategoryId(next)
            void flushPatch({ categoryId: next })
          }}
        >
          <option value="">No category</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <div className="article-meta-tags-wrap">
          <input
            type="text"
            aria-label="Tags"
            placeholder="tags, comma, separated"
            value={tagsText}
            onChange={(event) => setTagsText(event.target.value)}
            onFocus={() => setTagsFocused(true)}
            onBlur={() => {
              setTagsFocused(false)
              commitTags()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitTags()
              }
            }}
          />
          {tagsFocused && tagSuggestions.length > 0 && (
            <ul className="article-meta-tag-dropdown">
              {tagSuggestions.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectSuggestion(name)}
                  >
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <label className="article-meta-flag">
          <input
            type="checkbox"
            checked={isFeatured}
            onChange={() => void toggleFeatured()}
          />
          Featured
        </label>
        <button type="button" onClick={() => void toggleVisibility()}>
          {visibility === 'private' ? 'Make public' : 'Make private'}
        </button>
        {visibility === 'public' && (
          <a href={`/a/${publicId}`} target="_blank" rel="noreferrer">
            Public link
          </a>
        )}
        <button
          type="button"
          className="article-meta-delete"
          onClick={() => void remove()}
        >
          Delete
        </button>
      </div>
      {createdToday && quickTags.length > 0 && (
        <div className="article-meta-quick-tags">
          <span className="eyebrow">Popular in category</span>
          {quickTags.map((name) => (
            <span key={name} className="article-meta-quick-tag">
              <button
                type="button"
                className="article-meta-quick-tag-add"
                onClick={() => addTag(name)}
              >
                + {name}
              </button>
              <button
                type="button"
                className="article-meta-quick-tag-reject"
                aria-label={`Don't suggest ${name}`}
                onClick={() => rejectQuickTag(name)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
