// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PageEditor } from '../src/components/PageEditor'

const fetchMock = vi.fn(
  async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
)

beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const BASE_PROPS = {
  pageId: 7,
  initialSlug: 'travel',
  initialTitle: 'Travel',
  initialVisibility: 'private' as const,
  initialMode: 'manual' as const,
  initialArticleIds: [],
  initialCategoryId: null,
  initialTagId: null,
  initialSortKey: 'created_desc' as const,
  categories: [{ id: 1, name: 'Travel' }],
  tags: [{ id: 10, name: 'japan' }],
  articles: [
    { id: 1, title: 'First post' },
    { id: 2, title: 'Second post' },
  ],
  debounceMs: 20,
}

describe('PageEditor', () => {
  it('renders title, slug, visibility toggle, and the manual-mode picker by default', () => {
    render(<PageEditor {...BASE_PROPS} />)
    expect(screen.getByLabelText('Title')).toBeTruthy()
    expect(screen.getByLabelText('Slug')).toBeTruthy()
    expect(screen.getByText('Make public')).toBeTruthy()
    expect(screen.getByLabelText('Add article')).toBeTruthy()
  })

  it('debounces a title edit into one PATCH', async () => {
    render(<PageEditor {...BASE_PROPS} />)
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'New title' },
    })
    await screen.findByText('Saved')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ title: 'New title' })
  })

  it('toggling visibility PATCHes immediately and flips the button label', async () => {
    render(<PageEditor {...BASE_PROPS} />)
    fireEvent.click(screen.getByText('Make public'))
    await screen.findByText('Make private')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ visibility: 'public' })
  })

  it('switching mode swaps the sub-panel and PATCHes the new mode', async () => {
    render(<PageEditor {...BASE_PROPS} />)
    fireEvent.click(screen.getByLabelText('Auto by category/tag'))
    await screen.findByLabelText('Category or tag filter')
    expect(screen.queryByLabelText('Add article')).toBeNull()
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ mode: 'auto' })
  })

  it('picking a category in auto mode PATCHes categoryId/tagId', async () => {
    render(<PageEditor {...BASE_PROPS} initialMode="auto" />)
    fireEvent.change(screen.getByLabelText('Category or tag filter'), {
      target: { value: 'category:1' },
    })
    await screen.findByText('Saved')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      categoryId: 1,
      tagId: null,
    })
  })

  it('adding an article in manual mode PATCHes articleIds, optimistically', async () => {
    render(<PageEditor {...BASE_PROPS} />)
    fireEvent.change(screen.getByLabelText('Add article'), {
      target: { value: '2' },
    })
    // Optimistic: the new article shows up before the PATCH resolves.
    expect(screen.getByText('Second post')).toBeTruthy()
    await screen.findByText('Saved')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ articleIds: [2] })
  })

  it('rolls back articleIds on a failed save', async () => {
    // mockImplementationOnce, not mockImplementation: this must only affect
    // this test's one PATCH — a blanket override would leak into later
    // tests since beforeEach only calls mockClear(), not mockReset().
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ error: 'nope' }), { status: 500 }),
    )
    render(<PageEditor {...BASE_PROPS} initialArticleIds={[1]} />)
    fireEvent.change(screen.getByLabelText('Add article'), {
      target: { value: '2' },
    })
    // Optimistic: added to the selected (ordered) list immediately.
    expect(screen.getByRole('list').textContent).toContain('Second post')
    await screen.findByText('Save failed')
    // Rolled back: no longer in the selected list. (It's still offered in
    // the "Add article" dropdown — correctly, since it's available again —
    // so a page-wide text query would find it there too.)
    expect(screen.getByRole('list').textContent).not.toContain('Second post')
  })

  it('deleting confirms, then DELETEs and navigates away', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const navigate = vi.fn()
    render(<PageEditor {...BASE_PROPS} navigate={navigate} />)
    fireEvent.click(screen.getByText('Delete'))
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/app/pages'))
  })
})
