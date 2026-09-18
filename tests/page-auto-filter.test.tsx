// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageAutoFilter } from '../src/components/PageAutoFilter'

afterEach(() => {
  cleanup()
})

const CATEGORIES = [
  { id: 1, name: 'Travel' },
  { id: 2, name: 'Recipes' },
]
const TAGS = [
  { id: 10, name: 'japan' },
  { id: 11, name: 'slow-travel' },
]

describe('PageAutoFilter', () => {
  it('lists categories and tags in the filter select, grouped', () => {
    render(
      <PageAutoFilter
        categories={CATEGORIES}
        tags={TAGS}
        categoryId={null}
        tagId={null}
        sortKey="created_desc"
        onChangeFilter={vi.fn()}
        onChangeSortKey={vi.fn()}
      />,
    )
    expect(screen.getByRole('option', { name: 'Travel' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'japan' })).toBeTruthy()
  })

  it('displays the selected category as the select value', () => {
    render(
      <PageAutoFilter
        categories={CATEGORIES}
        tags={TAGS}
        categoryId={1}
        tagId={null}
        sortKey="created_desc"
        onChangeFilter={vi.fn()}
        onChangeSortKey={vi.fn()}
      />,
    )
    expect(
      (screen.getByLabelText('Category or tag filter') as HTMLSelectElement)
        .value,
    ).toBe('category:1')
  })

  it('displays the selected tag as the select value', () => {
    render(
      <PageAutoFilter
        categories={CATEGORIES}
        tags={TAGS}
        categoryId={null}
        tagId={10}
        sortKey="created_desc"
        onChangeFilter={vi.fn()}
        onChangeSortKey={vi.fn()}
      />,
    )
    expect(
      (screen.getByLabelText('Category or tag filter') as HTMLSelectElement)
        .value,
    ).toBe('tag:10')
  })

  it('selecting a category calls onChangeFilter with categoryId set and tagId null', () => {
    const onChangeFilter = vi.fn()
    render(
      <PageAutoFilter
        categories={CATEGORIES}
        tags={TAGS}
        categoryId={null}
        tagId={null}
        sortKey="created_desc"
        onChangeFilter={onChangeFilter}
        onChangeSortKey={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText('Category or tag filter'), {
      target: { value: 'category:1' },
    })
    expect(onChangeFilter).toHaveBeenCalledWith({ categoryId: 1, tagId: null })
  })

  it('selecting a tag calls onChangeFilter with tagId set and categoryId null', () => {
    const onChangeFilter = vi.fn()
    render(
      <PageAutoFilter
        categories={CATEGORIES}
        tags={TAGS}
        categoryId={1}
        tagId={null}
        sortKey="created_desc"
        onChangeFilter={onChangeFilter}
        onChangeSortKey={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText('Category or tag filter'), {
      target: { value: 'tag:10' },
    })
    expect(onChangeFilter).toHaveBeenCalledWith({ categoryId: null, tagId: 10 })
  })

  it('clearing the selection calls onChangeFilter with both ids null', () => {
    const onChangeFilter = vi.fn()
    render(
      <PageAutoFilter
        categories={CATEGORIES}
        tags={TAGS}
        categoryId={1}
        tagId={null}
        sortKey="created_desc"
        onChangeFilter={onChangeFilter}
        onChangeSortKey={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText('Category or tag filter'), {
      target: { value: '' },
    })
    expect(onChangeFilter).toHaveBeenCalledWith({
      categoryId: null,
      tagId: null,
    })
  })

  it('changing the sort dropdown calls onChangeSortKey', () => {
    const onChangeSortKey = vi.fn()
    render(
      <PageAutoFilter
        categories={CATEGORIES}
        tags={TAGS}
        categoryId={null}
        tagId={null}
        sortKey="created_desc"
        onChangeFilter={vi.fn()}
        onChangeSortKey={onChangeSortKey}
      />,
    )
    fireEvent.change(screen.getByLabelText('Sort order'), {
      target: { value: 'title_asc' },
    })
    expect(onChangeSortKey).toHaveBeenCalledWith('title_asc')
  })
})
