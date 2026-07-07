// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeaturedReorder } from '../src/components/FeaturedReorder'

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

const ITEMS = [
  { id: 11, title: 'First' },
  { id: 22, title: 'Second' },
  { id: 33, title: 'Third' },
]

function renderList(items = ITEMS) {
  return render(<FeaturedReorder items={items} />)
}

function renderedTitles(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((item) => item.querySelector('a')?.textContent ?? '')
}

/**
 * Flushes pending microtasks (act-wrapped). `persist` is invoked
 * synchronously from the click handler, so one flush is enough to prove no
 * fetch was scheduled — and to let settled fetch continuations run.
 */
async function flushMicrotasks(): Promise<void> {
  await act(async () => {})
}

/** A promise with its resolver exposed — lets a test settle fetches out of order. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function lastPostedIds(): number[] {
  const [url, init] = fetchMock.mock.calls.at(-1) as unknown as [
    string,
    RequestInit,
  ]
  expect(url).toBe('/api/articles/featured-order')
  expect(init.method).toBe('POST')
  const body = JSON.parse(String(init.body)) as { orderedIds: number[] }
  return body.orderedIds
}

describe('FeaturedReorder — rendering', () => {
  it('renders featured articles as editor links, in order', () => {
    renderList()
    expect(renderedTitles()).toEqual(['First', 'Second', 'Third'])
    const [link] = screen.getAllByRole('link')
    expect(link?.getAttribute('href')).toBe('/app/articles/11')
  })

  it('shows an empty state when nothing is featured', () => {
    renderList([])
    expect(screen.getByText('No featured articles yet.')).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('disambiguates duplicate titles in button labels by position', () => {
    renderList([
      { id: 1, title: 'Dup' },
      { id: 2, title: 'Dup' },
    ])
    expect(
      screen.getByRole('button', { name: 'Move Dup (position 1) up' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Move Dup (position 2) up' }),
    ).toBeTruthy()
  })
})

describe('FeaturedReorder — keyboard reordering', () => {
  it('moves an item up, posts the new id sequence, updates optimistically', async () => {
    renderList()
    fireEvent.click(
      screen.getByRole('button', { name: 'Move Third (position 3) up' }),
    )

    // Optimistic: DOM order flips before the POST resolves.
    expect(renderedTitles()).toEqual(['First', 'Third', 'Second'])

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(lastPostedIds()).toEqual([11, 33, 22])
  })

  it('moves an item down and posts the new id sequence', async () => {
    renderList()
    fireEvent.click(
      screen.getByRole('button', { name: 'Move First (position 1) down' }),
    )

    expect(renderedTitles()).toEqual(['Second', 'First', 'Third'])
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(lastPostedIds()).toEqual([22, 11, 33])
  })

  it('ignores moves past the ends without posting', async () => {
    renderList()
    fireEvent.click(
      screen.getByRole('button', { name: 'Move First (position 1) up' }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Move Third (position 3) down' }),
    )

    await flushMicrotasks()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(renderedTitles()).toEqual(['First', 'Second', 'Third'])
  })
})

describe('FeaturedReorder — drag and drop', () => {
  it('dropping an item on another emits the expected id sequence', async () => {
    renderList()
    const items = screen.getAllByRole('listitem')
    const first = items[0] as HTMLElement
    const third = items[2] as HTMLElement

    fireEvent.dragStart(first)
    fireEvent.dragOver(third)
    fireEvent.drop(third)

    expect(renderedTitles()).toEqual(['Second', 'Third', 'First'])
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(lastPostedIds()).toEqual([22, 33, 11])
  })

  it('dropping an item on itself is a no-op', async () => {
    renderList()
    const [first] = screen.getAllByRole('listitem')
    fireEvent.dragStart(first as HTMLElement)
    fireEvent.drop(first as HTMLElement)

    await flushMicrotasks()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(renderedTitles()).toEqual(['First', 'Second', 'Third'])
  })
})

describe('FeaturedReorder — failure rollback', () => {
  it('rolls back the optimistic order when the POST fails', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: 'nope' }), { status: 500 }),
    )
    renderList()
    fireEvent.click(
      screen.getByRole('button', { name: 'Move Third (position 3) up' }),
    )
    expect(renderedTitles()).toEqual(['First', 'Third', 'Second'])

    await waitFor(() =>
      expect(renderedTitles()).toEqual(['First', 'Second', 'Third']),
    )
    expect(screen.getByText('Save failed')).toBeTruthy()
  })

  it('rolls back when the POST throws (network down)', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('offline')
    })
    renderList()
    fireEvent.click(
      screen.getByRole('button', { name: 'Move First (position 1) down' }),
    )
    expect(renderedTitles()).toEqual(['Second', 'First', 'Third'])

    await waitFor(() =>
      expect(renderedTitles()).toEqual(['First', 'Second', 'Third']),
    )
    expect(screen.getByText('Save failed')).toBeTruthy()
  })
})

describe('FeaturedReorder — overlapping saves', () => {
  it('ignores a stale failure after a newer save was confirmed', async () => {
    const requestA = deferred<Response>()
    const requestB = deferred<Response>()
    fetchMock
      .mockImplementationOnce(() => requestA.promise)
      .mockImplementationOnce(() => requestB.promise)

    renderList()

    // Move A (in flight): Third up → [First, Third, Second].
    fireEvent.click(
      screen.getByRole('button', { name: 'Move Third (position 3) up' }),
    )
    // Move B while A is pending: Third up again → [Third, First, Second].
    fireEvent.click(
      screen.getByRole('button', { name: 'Move Third (position 2) up' }),
    )
    expect(renderedTitles()).toEqual(['Third', 'First', 'Second'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(lastPostedIds()).toEqual([33, 11, 22])

    // The newer request (B) succeeds first — its order is confirmed.
    requestB.resolve(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy())

    // The stale request (A) then fails. It must NOT roll back past B's
    // confirmed order, and must not overwrite B's status.
    requestA.resolve(
      new Response(JSON.stringify({ error: 'nope' }), { status: 500 }),
    )
    await flushMicrotasks()
    expect(renderedTitles()).toEqual(['Third', 'First', 'Second'])
    expect(screen.getByText('Saved')).toBeTruthy()
    expect(screen.queryByText('Save failed')).toBeNull()
  })
})
