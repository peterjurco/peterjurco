import type { PageSortKey } from '../lib/pages/repo'

export interface CategoryOption {
  id: number
  name: string
}

export interface TagOption {
  id: number
  name: string
}

const SORT_OPTIONS: { value: PageSortKey; label: string }[] = [
  { value: 'created_desc', label: 'Newest first' },
  { value: 'created_asc', label: 'Oldest first' },
  { value: 'title_asc', label: 'Title A→Z' },
  { value: 'title_desc', label: 'Title Z→A' },
]

interface PageAutoFilterProps {
  categories: CategoryOption[]
  tags: TagOption[]
  categoryId: number | null
  tagId: number | null
  sortKey: PageSortKey
  onChangeFilter: (filter: {
    categoryId: number | null
    tagId: number | null
  }) => void
  onChangeSortKey: (sortKey: PageSortKey) => void
}

/**
 * Pure controlled component — auto-mode's category-or-tag filter + sort
 * dropdown. No fetch, no local state; PageEditor owns persistence.
 */
export function PageAutoFilter({
  categories,
  tags,
  categoryId,
  tagId,
  sortKey,
  onChangeFilter,
  onChangeSortKey,
}: PageAutoFilterProps) {
  const value =
    categoryId !== null
      ? `category:${categoryId}`
      : tagId !== null
        ? `tag:${tagId}`
        : ''

  return (
    <div className="page-auto-filter">
      <label>
        Filter
        <select
          aria-label="Category or tag filter"
          value={value}
          onChange={(event) => {
            const raw = event.target.value
            if (raw === '') {
              onChangeFilter({ categoryId: null, tagId: null })
              return
            }
            const [kind, idText] = raw.split(':')
            const id = Number(idText)
            onChangeFilter(
              kind === 'category'
                ? { categoryId: id, tagId: null }
                : { categoryId: null, tagId: id },
            )
          }}
        >
          <option value="">Choose a category or tag…</option>
          <optgroup label="Category">
            {categories.map((category) => (
              <option
                key={`category:${category.id}`}
                value={`category:${category.id}`}
              >
                {category.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Tag">
            {tags.map((tag) => (
              <option key={`tag:${tag.id}`} value={`tag:${tag.id}`}>
                {tag.name}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <label>
        Sort
        <select
          aria-label="Sort order"
          value={sortKey}
          onChange={(event) =>
            onChangeSortKey(event.target.value as PageSortKey)
          }
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
