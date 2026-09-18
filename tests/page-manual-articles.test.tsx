// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageManualArticles } from '../src/components/PageManualArticles'

afterEach(() => {
  cleanup()
})

const ARTICLES = [
  { id: 1, title: 'First post' },
  { id: 2, title: 'Second post' },
  { id: 3, title: 'Third post' },
]

describe('PageManualArticles', () => {
  it('shows an empty state when no articles are selected', () => {
    render(
      <PageManualArticles
        articles={ARTICLES}
        articleIds={[]}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText('No articles added yet.')).toBeTruthy()
  })

  it('lists selected articles in order, and the picker only offers the rest', () => {
    render(
      <PageManualArticles
        articles={ARTICLES}
        articleIds={[2, 1]}
        onChange={vi.fn()}
      />,
    )
    const items = screen.getAllByRole('listitem').map((el) => el.textContent)
    expect(items[0]).toContain('Second post')
    expect(items[1]).toContain('First post')
    expect(screen.queryByRole('option', { name: 'First post' })).toBeNull()
    expect(screen.getByRole('option', { name: 'Third post' })).toBeTruthy()
  })

  it('picking an article from the dropdown appends it', () => {
    const onChange = vi.fn()
    render(
      <PageManualArticles
        articles={ARTICLES}
        articleIds={[1]}
        onChange={onChange}
      />,
    )
    fireEvent.change(screen.getByLabelText('Add article'), {
      target: { value: '3' },
    })
    expect(onChange).toHaveBeenCalledWith([1, 3])
  })

  it('removing an article drops it from the list', () => {
    const onChange = vi.fn()
    render(
      <PageManualArticles
        articles={ARTICLES}
        articleIds={[1, 2]}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByLabelText('Remove First post'))
    expect(onChange).toHaveBeenCalledWith([2])
  })

  it('the move-down button on the first item reorders it after the second', () => {
    const onChange = vi.fn()
    render(
      <PageManualArticles
        articles={ARTICLES}
        articleIds={[1, 2]}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByLabelText('Move First post (position 1) down'))
    expect(onChange).toHaveBeenCalledWith([2, 1])
  })

  it('the move-up button on the last item is a no-op at the top', () => {
    const onChange = vi.fn()
    render(
      <PageManualArticles
        articles={ARTICLES}
        articleIds={[1, 2]}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByLabelText('Move First post (position 1) up'))
    expect(onChange).not.toHaveBeenCalled()
  })
})
