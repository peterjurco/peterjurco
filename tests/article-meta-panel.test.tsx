// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArticleMetaPanel } from '../src/components/ArticleMetaPanel'

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

interface PanelOverrides {
  initialTags?: string[]
  navigate?: (url: string) => void
}

function renderPanel({ initialTags = [], navigate }: PanelOverrides = {}) {
  return render(
    <ArticleMetaPanel
      articleId={7}
      publicId="pub-7"
      initialTitle="Hello"
      initialVisibility="private"
      initialCategoryId={null}
      initialTags={initialTags}
      initialIsFeatured={false}
      categories={[{ id: 1, name: 'Essays' }]}
      debounceMs={30}
      navigate={navigate}
    />,
  )
}

function patchCalls(): Array<{
  init: RequestInit
  body: Record<string, unknown>
}> {
  return (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)
    .map(([, init]) => init)
    .filter((init) => init?.method === 'PATCH')
    .map((init) => ({
      init,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    }))
}

describe('ArticleMetaPanel — debounced field patches', () => {
  it('never loses a field: title + tags edited within the window arrive together', async () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'New title' },
    })
    const tags = screen.getByLabelText('Tags')
    fireEvent.change(tags, { target: { value: 'travel, food' } })
    fireEvent.keyDown(tags, { key: 'Enter' })

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    // Let the debounce window elapse — nothing further may fire.
    await new Promise((resolve) => setTimeout(resolve, 60))

    const sent = patchCalls()
    const merged = Object.assign({}, ...sent.map((call) => call.body))
    expect(merged.title).toBe('New title')
    expect(merged.tags).toEqual(['travel', 'food'])
    expect(sent).toHaveLength(1) // one merged PATCH, not one per field
  })

  it('collapses consecutive title edits into one PATCH with the final value', async () => {
    renderPanel()
    const title = screen.getByLabelText('Title')
    fireEvent.change(title, { target: { value: 'A' } })
    fireEvent.change(title, { target: { value: 'AB' } })
    fireEvent.change(title, { target: { value: 'ABC' } })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(patchCalls()[0]?.body).toEqual({ title: 'ABC' })
  })

  it('flushes pending edits on unmount with keepalive', async () => {
    const { unmount } = renderPanel()
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Almost lost' },
    })
    unmount() // before the debounce elapses

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [call] = patchCalls()
    expect(call?.init.keepalive).toBe(true)
    expect(call?.body).toEqual({ title: 'Almost lost' })
  })
})

describe('ArticleMetaPanel — tags commit on blur/Enter only', () => {
  it('does not PATCH on tag keystrokes', async () => {
    renderPanel()
    const tags = screen.getByLabelText('Tags')
    for (const value of ['t', 'tr', 'tra', 'travel']) {
      fireEvent.change(tags, { target: { value } })
    }
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.blur(tags)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(patchCalls()[0]?.body).toEqual({ tags: ['travel'] })
  })

  it('skips the PATCH when the committed tag set is unchanged', async () => {
    renderPanel({ initialTags: ['travel'] })
    const tags = screen.getByLabelText('Tags')
    fireEvent.blur(tags)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('ArticleMetaPanel — immediate actions', () => {
  it('PATCHes a visibility toggle immediately', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Make public' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(patchCalls()[0]?.body).toEqual({ visibility: 'public' })
    // Local state flips on success.
    await screen.findByRole('button', { name: 'Make private' })
  })

  it('merges a pending title edit into an immediate visibility PATCH', async () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Both fields' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Make public' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(patchCalls()[0]?.body).toEqual({
      title: 'Both fields',
      visibility: 'public',
    })
  })
})

describe('ArticleMetaPanel — delete', () => {
  it('asks for confirmation, DELETEs, then redirects to the list', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const navigate = vi.fn()
    renderPanel({ navigate })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app/articles'))
    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('/api/articles/7')
    expect(init.method).toBe('DELETE')
  })

  it('does nothing when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const navigate = vi.fn()
    renderPanel({ navigate })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('ArticleMetaPanel — tab title sync', () => {
  it('sets document.title to the initial title on mount', () => {
    renderPanel()
    expect(document.title).toBe('Hello — peterjur.co')
  })

  it('updates document.title live as the title is typed, no page reload', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'New title' },
    })
    expect(document.title).toBe('New title — peterjur.co')
  })

  it('falls back to "Untitled" when the title is cleared', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: '' },
    })
    expect(document.title).toBe('Untitled — peterjur.co')
  })
})
