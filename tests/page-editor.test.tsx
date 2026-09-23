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
  vi.restoreAllMocks()
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
  initialShowTags: false,
  initialShowCreatedDate: false,
  initialShowUpdatedDate: false,
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
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ visibility: 'public' })
  })

  it("switching mode swaps the sub-panel and PATCHes the new mode, clearing the other mode's fields", async () => {
    render(<PageEditor {...BASE_PROPS} initialArticleIds={[1]} />)
    fireEvent.click(screen.getByLabelText('Auto by category/tag'))
    await screen.findByLabelText('Category or tag filter')
    expect(screen.queryByLabelText('Add article')).toBeNull()
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      mode: 'auto',
      articleIds: [],
    })
  })

  it('switching back to manual mode clears the auto-mode filter', async () => {
    render(
      <PageEditor {...BASE_PROPS} initialMode="auto" initialCategoryId={1} />,
    )
    fireEvent.click(screen.getByLabelText('Manually curated'))
    await screen.findByLabelText('Add article')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      mode: 'manual',
      categoryId: null,
      tagId: null,
    })
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

  it('shows the server error message when a PATCH responds with an error body', async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ error: 'slug taken' }), {
          status: 500,
        }),
    )
    render(<PageEditor {...BASE_PROPS} />)
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'New title' },
    })
    await screen.findByText('Save failed')
    expect(document.querySelector('.page-editor-error')?.textContent).toBe(
      'slug taken',
    )
  })

  it('shows an error message when the PATCH fetch itself throws', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new Error('network down')
    })
    render(<PageEditor {...BASE_PROPS} />)
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'New title' },
    })
    await screen.findByText('Save failed')
    expect(
      document.querySelector('.page-editor-error')?.textContent,
    ).toBeTruthy()
  })

  it('deleting confirms, then DELETEs and navigates away', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const navigate = vi.fn()
    render(<PageEditor {...BASE_PROPS} navigate={navigate} />)
    fireEvent.click(screen.getByText('Delete'))
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/app/pages'))
  })
})

describe('PageEditor — tile display options', () => {
  it('renders the three display checkboxes, unchecked by default', () => {
    render(<PageEditor {...BASE_PROPS} />)
    for (const label of [
      'Show tags',
      'Show date created',
      'Show date modified',
    ]) {
      const checkbox = screen.getByLabelText(label) as HTMLInputElement
      expect(checkbox.checked).toBe(false)
    }
  })

  it('reflects the initial values when already on', () => {
    render(
      <PageEditor
        {...BASE_PROPS}
        initialShowTags={true}
        initialShowCreatedDate={true}
      />,
    )
    expect(
      (screen.getByLabelText('Show tags') as HTMLInputElement).checked,
    ).toBe(true)
    expect(
      (screen.getByLabelText('Show date created') as HTMLInputElement).checked,
    ).toBe(true)
    expect(
      (screen.getByLabelText('Show date modified') as HTMLInputElement).checked,
    ).toBe(false)
  })

  it('toggling "Show tags" PATCHes immediately and flips the checkbox', async () => {
    render(<PageEditor {...BASE_PROPS} />)
    const checkbox = screen.getByLabelText('Show tags') as HTMLInputElement
    fireEvent.click(checkbox)

    await vi.waitFor(() => expect(checkbox.checked).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ showTags: true })
  })

  it('toggling "Show date created" and "Show date modified" PATCH independently', async () => {
    render(<PageEditor {...BASE_PROPS} />)
    const created = screen.getByLabelText(
      'Show date created',
    ) as HTMLInputElement
    fireEvent.click(created)
    await vi.waitFor(() => expect(created.checked).toBe(true))
    const [, firstInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(JSON.parse(String(firstInit.body))).toEqual({
      showCreatedDate: true,
    })

    const updated = screen.getByLabelText(
      'Show date modified',
    ) as HTMLInputElement
    fireEvent.click(updated)
    await vi.waitFor(() => expect(updated.checked).toBe(true))
    const [, secondInit] = fetchMock.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ]
    expect(JSON.parse(String(secondInit.body))).toEqual({
      showUpdatedDate: true,
    })
  })
})
