// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaxonomyAdmin } from '../src/components/TaxonomyAdmin'

const fetchMock = vi.fn(
  async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
)

beforeEach(() => {
  fetchMock.mockClear()
  fetchMock.mockImplementation(
    async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const CATEGORIES = [{ id: 1, name: 'Essays' }]
const ARTICLE_TAGS = [{ id: 2, name: 'hiking' }]
const PHOTO_TAGS = [
  { id: 3, name: 'family', visibility: 'private' as const },
  { id: 4, name: 'travel', visibility: 'public' as const },
]

function renderAdmin() {
  return render(
    <TaxonomyAdmin
      initialCategories={CATEGORIES}
      initialArticleTags={ARTICLE_TAGS}
      initialPhotoTags={PHOTO_TAGS}
    />,
  )
}

describe('TaxonomyAdmin — article categories', () => {
  it('renames a category inline', async () => {
    renderAdmin()
    fireEvent.click(screen.getByRole('button', { name: 'Essays' }))
    fireEvent.change(screen.getByLabelText('Rename Essays'), {
      target: { value: 'Long-form' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByRole('button', { name: 'Long-form' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/taxonomy/article-categories/1',
      expect.objectContaining({ method: 'PATCH' }),
    )
  })

  it('deletes a category after confirmation', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )
    renderAdmin()
    const section = screen.getByText('Article categories').closest('section')
    if (!section) throw new Error('section not found')
    fireEvent.click(within(section).getByRole('button', { name: 'Delete' }))

    await vi.waitFor(() => expect(screen.queryByText('Essays')).toBeNull())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/taxonomy/article-categories/1',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('adds a new category', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ id: 5, name: 'New cat' }), {
          status: 201,
        }),
    )
    renderAdmin()
    fireEvent.change(screen.getByLabelText('New article categories name'), {
      target: { value: 'New cat' },
    })
    const section = screen.getByText('Article categories').closest('section')
    if (!section) throw new Error('section not found')
    fireEvent.click(within(section).getByRole('button', { name: 'Add' }))

    await screen.findByRole('button', { name: 'New cat' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/taxonomy/article-categories',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})

describe('TaxonomyAdmin — article tags', () => {
  it('deletes a tag after confirmation', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )
    renderAdmin()
    const section = screen.getByText('Article tags').closest('section')
    if (!section) throw new Error('section not found')
    fireEvent.click(within(section).getByRole('button', { name: 'Delete' }))

    await vi.waitFor(() => expect(screen.queryByText('hiking')).toBeNull())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/taxonomy/article-tags/2',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})

describe('TaxonomyAdmin — photo tags', () => {
  it('toggles a private tag to public without confirmation', async () => {
    renderAdmin()
    const row = screen.getByText('family').closest('li')
    if (!row) throw new Error('row not found')
    fireEvent.click(within(row).getByRole('button', { name: 'Make public' }))

    await within(row).findByText('public')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/taxonomy/photo-tags/3',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ visibility: 'public' }),
      }),
    )
  })

  it('warns before making a public tag private, and aborts when declined', async () => {
    const confirmMock = vi.fn(() => false)
    vi.stubGlobal('confirm', confirmMock)
    renderAdmin()
    const row = screen.getByText('travel').closest('li')
    if (!row) throw new Error('row not found')
    fireEvent.click(within(row).getByRole('button', { name: 'Make private' }))

    expect(confirmMock).toHaveBeenCalledWith(
      expect.stringContaining('share link'),
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('proceeds making a public tag private when confirmed', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )
    renderAdmin()
    const row = screen.getByText('travel').closest('li')
    if (!row) throw new Error('row not found')
    fireEvent.click(within(row).getByRole('button', { name: 'Make private' }))

    await within(row).findByText('private')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/taxonomy/photo-tags/4',
      expect.objectContaining({ method: 'PATCH' }),
    )
  })

  it('warns before deleting a public tag', async () => {
    const confirmMock = vi.fn(() => false)
    vi.stubGlobal('confirm', confirmMock)
    renderAdmin()
    const row = screen.getByText('travel').closest('li')
    if (!row) throw new Error('row not found')
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))

    expect(confirmMock).toHaveBeenCalledWith(
      expect.stringContaining('share link'),
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('deletes a private tag with a plain confirmation (no share-link warning)', async () => {
    const confirmMock = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmMock)
    renderAdmin()
    const row = screen.getByText('family').closest('li')
    if (!row) throw new Error('row not found')
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))

    await vi.waitFor(() => expect(screen.queryByText('family')).toBeNull())
    expect(confirmMock).toHaveBeenCalledWith(
      expect.not.stringContaining('share link'),
    )
  })
})
