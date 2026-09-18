import { useRef } from 'react'

export interface ArticleOption {
  id: number
  title: string
}

interface PageManualArticlesProps {
  /** Every article available to pick from. */
  articles: ArticleOption[]
  /** Currently selected, in display order. */
  articleIds: number[]
  /** Called with the full new ordered list for ANY change — add, remove, or reorder. */
  onChange: (articleIds: number[]) => void
}

/**
 * Pure controlled component — manual-mode's article picker + drag-sortable
 * list. No fetch, no local persistence state; PageEditor owns that (same
 * split as PageAutoFilter). Drag-and-drop pattern adapted from
 * FeaturedReorder.tsx: native HTML5 DnD, dragged index in a ref (testable
 * under jsdom), ↑/↓ buttons as the keyboard-accessible equivalent.
 */
export function PageManualArticles({
  articles,
  articleIds,
  onChange,
}: PageManualArticlesProps) {
  const dragIndex = useRef<number | null>(null)

  const byId = new Map(articles.map((article) => [article.id, article]))
  const selected = articleIds
    .map((id) => byId.get(id))
    .filter((article): article is ArticleOption => article !== undefined)
  const available = articles.filter(
    (article) => !articleIds.includes(article.id),
  )

  function move(from: number, to: number): void {
    if (from === to || to < 0 || to >= articleIds.length) return
    const next = [...articleIds]
    const [moved] = next.splice(from, 1)
    if (moved === undefined) return
    next.splice(to, 0, moved)
    onChange(next)
  }

  return (
    <div className="page-manual-articles">
      <label>
        Add article
        <select
          aria-label="Add article"
          value=""
          onChange={(event) => {
            const id = Number(event.target.value)
            if (id) onChange([...articleIds, id])
          }}
        >
          <option value="">Choose an article…</option>
          {available.map((article) => (
            <option key={article.id} value={article.id}>
              {article.title || 'Untitled'}
            </option>
          ))}
        </select>
      </label>
      {selected.length === 0 ? (
        <p className="page-manual-empty">No articles added yet.</p>
      ) : (
        <ol>
          {selected.map((article, index) => (
            <li
              key={article.id}
              draggable
              onDragStart={() => {
                dragIndex.current = index
              }}
              onDragOver={(event) => {
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
              <span className="page-manual-grip" aria-hidden="true">
                ⠿
              </span>
              <span>{article.title || 'Untitled'}</span>
              <span className="page-manual-controls">
                <button
                  type="button"
                  aria-label={`Move ${article.title || 'Untitled'} (position ${index + 1}) up`}
                  onClick={() => move(index, index - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${article.title || 'Untitled'} (position ${index + 1}) down`}
                  onClick={() => move(index, index + 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${article.title || 'Untitled'}`}
                  onClick={() =>
                    onChange(articleIds.filter((id) => id !== article.id))
                  }
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
