// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppsAdmin } from '../src/components/AppsAdmin'

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

const APPS = [
  {
    id: 1,
    name: 'Alpha',
    url: 'https://alpha.example',
    iconKey: null,
    sortOrder: 0,
  },
  {
    id: 2,
    name: 'Beta',
    url: 'https://beta.example',
    iconKey: null,
    sortOrder: 1,
  },
]

describe('AppsAdmin — reorder', () => {
  it('swaps sort_order with the neighbor and PATCHes both apps', async () => {
    render(<AppsAdmin initialApps={APPS} />)

    fireEvent.click(screen.getByRole('button', { name: 'Move Beta up' }))

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const calls = (
      fetchMock.mock.calls as unknown as [string, RequestInit][]
    ).map(([url, init]) => [url, JSON.parse(String(init.body))] as const)
    expect(calls).toEqual(
      expect.arrayContaining([
        ['/api/apps/2', { sortOrder: 0 }],
        ['/api/apps/1', { sortOrder: 1 }],
      ]),
    )

    // Beta now renders first.
    await vi.waitFor(() => {
      const names = screen.getAllByRole('link').map((link) => link.textContent)
      expect(names).toEqual(['Beta', 'Alpha'])
    })
  })

  it('disables Move up for the first row and Move down for the last', () => {
    render(<AppsAdmin initialApps={APPS} />)
    expect(
      (
        screen.getByRole('button', {
          name: 'Move Alpha up',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect(
      (
        screen.getByRole('button', {
          name: 'Move Beta down',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })
})

describe('AppsAdmin — delete', () => {
  it('removes the app after confirmation', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )
    render(<AppsAdmin initialApps={APPS} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])

    await vi.waitFor(() => expect(screen.queryByText('Alpha')).toBeNull())
    expect(fetchMock).toHaveBeenCalledWith('/api/apps/1', { method: 'DELETE' })
  })

  it('does nothing when the confirmation is declined', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false),
    )
    render(<AppsAdmin initialApps={APPS} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])

    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByText('Alpha')).not.toBeNull()
  })
})

describe('AppsAdmin — add', () => {
  it('POSTs the new app and appends it to the list', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ id: 3, sortOrder: 2 }), { status: 201 }),
    )
    render(<AppsAdmin initialApps={APPS} />)

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Gamma' },
    })
    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: 'https://gamma.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await screen.findByText('Gamma')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('/api/apps')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'Gamma',
      url: 'https://gamma.example',
      iconKey: null,
    })
  })

  it('rejects a non-https URL without calling the API', async () => {
    render(<AppsAdmin initialApps={[]} />)

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Bad' },
    })
    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: 'http://insecure.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await screen.findByText(/must start with https:\/\//i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires a name', async () => {
    render(<AppsAdmin initialApps={[]} />)

    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: 'https://ok.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await screen.findByText(/name is required/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores a second Add while one is in flight (double-submit guard)', async () => {
    let resolveFetch: (response: Response) => void = () => {}
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    render(<AppsAdmin initialApps={[]} />)

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Once' },
    })
    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: 'https://once.example' },
    })
    const add = screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement

    fireEvent.click(add)
    fireEvent.click(add)
    expect(add.disabled).toBe(true)

    resolveFetch(
      new Response(JSON.stringify({ id: 9, sortOrder: 0 }), { status: 201 }),
    )
    await screen.findByText('Once')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
