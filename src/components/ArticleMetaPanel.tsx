import { useRef, useState } from 'react'
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
}

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
}: ArticleMetaPanelProps) {
  const [title, setTitle] = useState(initialTitle)
  const [visibility, setVisibility] = useState(initialVisibility)
  const [categoryId, setCategoryId] = useState(initialCategoryId)
  const [tagsText, setTagsText] = useState(initialTags.join(', '))
  const [isFeatured, setIsFeatured] = useState(initialIsFeatured)
  const [status, setStatus] = useState<MetaState>('')
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setStatus('Saving…')
    try {
      const response = await fetch(`/api/articles/${articleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setStatus(response.ok ? 'Saved' : 'Save failed')
      return response.ok
    } catch {
      setStatus('Save failed')
      return false
    }
  }

  function patchDebounced(body: Record<string, unknown>): void {
    clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      void patch(body)
    }, 600)
  }

  function parseTags(text: string): string[] {
    return text
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
  }

  async function toggleVisibility(): Promise<void> {
    const next = visibility === 'private' ? 'public' : 'private'
    if (await patch({ visibility: next })) setVisibility(next)
  }

  async function toggleFeatured(): Promise<void> {
    const next = !isFeatured
    if (await patch({ isFeatured: next })) setIsFeatured(next)
  }

  async function remove(): Promise<void> {
    if (!window.confirm('Delete this article? This cannot be undone.')) return
    const response = await fetch(`/api/articles/${articleId}`, {
      method: 'DELETE',
    })
    if (response.ok) {
      window.location.href = '/app/articles'
    } else {
      setStatus('Save failed')
    }
  }

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
            void patch({ categoryId: next })
          }}
        >
          <option value="">No category</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          aria-label="Tags"
          placeholder="tags, comma, separated"
          value={tagsText}
          onChange={(event) => {
            setTagsText(event.target.value)
            patchDebounced({ tags: parseTags(event.target.value) })
          }}
        />
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
        <span className="article-meta-status" aria-live="polite">
          {status}
        </span>
      </div>
    </div>
  )
}
