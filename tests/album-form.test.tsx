// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AlbumForm } from '../src/components/AlbumForm'

const fetchMock = vi.fn(
  async () => new Response(JSON.stringify({ id: 7 }), { status: 201 }),
)
const navigate = vi.fn()

beforeEach(() => {
  fetchMock.mockClear()
  navigate.mockClear()
  fetchMock.mockImplementation(
    async () => new Response(JSON.stringify({ id: 7 }), { status: 201 }),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function fill(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('AlbumForm — create', () => {
  it('POSTs name, url and parsed tags, then navigates to the list', async () => {
    render(<AlbumForm navigate={navigate} />)
    fill('Name', 'Analogue 2024')
    fill('Google Photos URL', 'https://photos.app.goo.gl/AbC123')
    fill('Tags', 'family, analogue')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/app/photos'))
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('/api/photos/albums')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'Analogue 2024',
      googlePhotosUrl: 'https://photos.app.goo.gl/AbC123',
      coverImageKey: null,
      tags: ['family', 'analogue'],
    })
  })

  it('rejects a non-Google-Photos URL without calling the API', async () => {
    render(<AlbumForm navigate={navigate} />)
    fill('Name', 'Bad link')
    fill('Google Photos URL', 'https://evil.com/album')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText(/must be a Google Photos link/i)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('requires a name', async () => {
    render(<AlbumForm navigate={navigate} />)
    fill('Google Photos URL', 'https://photos.app.goo.gl/AbC123')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText(/name is required/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('AlbumForm — edit', () => {
  it('PATCHes the album with the edited fields', async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    render(
      <AlbumForm
        albumId={42}
        initialName="Old name"
        initialGooglePhotosUrl="https://photos.app.goo.gl/Old"
        initialTags={['family']}
        initialCoverImageKey="covers/old.jpg"
        navigate={navigate}
      />,
    )
    fill('Name', 'New name')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/app/photos'))
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('/api/photos/albums/42')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'New name',
      googlePhotosUrl: 'https://photos.app.goo.gl/Old',
      coverImageKey: 'covers/old.jpg',
      tags: ['family'],
    })
  })

  it('deletes the album after confirmation', async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )
    render(
      <AlbumForm
        albumId={42}
        initialName="Doomed"
        initialGooglePhotosUrl="https://photos.app.goo.gl/Old"
        navigate={navigate}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/app/photos'))
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('/api/photos/albums/42')
    expect(init.method).toBe('DELETE')
  })

  it('ignores a second Save while one is in flight (double-submit guard)', async () => {
    let resolveFetch: (response: Response) => void = () => {}
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    render(
      <AlbumForm
        albumId={42}
        initialName="Once"
        initialGooglePhotosUrl="https://photos.app.goo.gl/Old"
        navigate={navigate}
      />,
    )
    const save = screen.getByRole('button', {
      name: 'Save',
    }) as HTMLButtonElement

    fireEvent.click(save)
    fireEvent.click(save)
    expect(save.disabled).toBe(true)

    resolveFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/app/photos'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('disables Save and Delete while a cover upload is in flight', async () => {
    // The presign fetch never resolves — the upload stays in flight.
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}))
    render(
      <AlbumForm
        albumId={42}
        initialName="Uploading"
        initialGooglePhotosUrl="https://photos.app.goo.gl/Old"
        navigate={navigate}
      />,
    )
    const input = screen.getByLabelText('Cover image') as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File(['bytes'], 'c.png', { type: 'image/png' })] },
    })

    await screen.findByText('Uploading…')
    const save = screen.getByRole('button', {
      name: 'Save',
    }) as HTMLButtonElement
    const del = screen.getByRole('button', {
      name: 'Delete',
    }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(del.disabled).toBe(true)

    // Wait for the presign call to be issued, then attempt a submit: it must
    // not fire the album request while the upload is still in flight.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    fireEvent.click(save)
    expect(fetchMock).toHaveBeenCalledTimes(1) // still just the presign call
  })

  it('shows the failure state when saving errors', async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ error: 'x' }), { status: 500 }),
    )
    render(
      <AlbumForm
        albumId={42}
        initialName="Keeps"
        initialGooglePhotosUrl="https://photos.app.goo.gl/Old"
        navigate={navigate}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('Save failed')
    expect(navigate).not.toHaveBeenCalled()
  })
})
