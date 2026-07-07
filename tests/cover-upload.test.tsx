// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CoverUpload,
  MAX_EDGE_PX,
  targetDimensions,
  uploadCover,
} from '../src/components/CoverUpload'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('targetDimensions', () => {
  it('returns null when the longest edge is within the cap', () => {
    expect(targetDimensions(2560, 1440)).toBeNull()
    expect(targetDimensions(1440, 2560)).toBeNull()
    expect(targetDimensions(800, 600)).toBeNull()
  })

  it('caps the longest edge and keeps the aspect ratio (landscape)', () => {
    expect(targetDimensions(5120, 2880)).toEqual({ width: 2560, height: 1440 })
  })

  it('caps the longest edge and keeps the aspect ratio (portrait)', () => {
    expect(targetDimensions(3000, 6000)).toEqual({ width: 1280, height: 2560 })
  })

  it('rounds fractional targets to whole pixels', () => {
    expect(targetDimensions(3001, 2000)).toEqual({ width: 2560, height: 1706 })
  })

  it('honors a custom max edge', () => {
    expect(targetDimensions(100, 50, 10)).toEqual({ width: 10, height: 5 })
  })

  it('exports the DESIGN cap of 2560px', () => {
    expect(MAX_EDGE_PX).toBe(2560)
  })
})

describe('uploadCover', () => {
  const file = new File(['png-bytes'], 'photo.png', { type: 'image/png' })
  /** Identity downscale — real canvas encoding is not exercised in jsdom. */
  const passthrough = async (input: File) => input as Blob

  it('presigns, PUTs the bytes and resolves with the stored key', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/media/presign') {
        return Response.json({
          url: 'http://localhost:9000/bucket/covers/k.png?sig=x',
          key: 'covers/k.png',
        })
      }
      return new Response(null, { status: 200 })
    })

    const key = await uploadCover(file, {
      fetchFn: fetchMock as typeof fetch,
      downscale: passthrough,
    })
    expect(key).toBe('covers/k.png')

    // 1st call: presign with the declared type/size/filename.
    const [presignUrl, presignInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(presignUrl).toBe('/api/media/presign')
    expect(JSON.parse(String(presignInit.body))).toEqual({
      contentType: 'image/png',
      size: file.size,
      filename: 'photo.png',
    })

    // 2nd call: PUT the bytes to the presigned URL.
    const [putUrl, putInit] = fetchMock.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ]
    expect(putUrl).toBe('http://localhost:9000/bucket/covers/k.png?sig=x')
    expect(putInit.method).toBe('PUT')
    expect((putInit.headers as Record<string, string>)['Content-Type']).toBe(
      'image/png',
    )
  })

  it('rejects when the presign request is refused', async () => {
    const fetchMock = vi.fn(
      async () => new Response('{"error":"nope"}', { status: 401 }),
    )
    await expect(
      uploadCover(file, {
        fetchFn: fetchMock as typeof fetch,
        downscale: passthrough,
      }),
    ).rejects.toThrow(/presign/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects when the PUT to storage fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/media/presign'
        ? Response.json({ url: 'http://s3/put', key: 'covers/k.png' })
        : new Response(null, { status: 403 }),
    )
    await expect(
      uploadCover(file, {
        fetchFn: fetchMock as typeof fetch,
        downscale: passthrough,
      }),
    ).rejects.toThrow(/upload/i)
  })

  it('uploads the downscaled blob, not the original file', async () => {
    const smaller = new Blob(['downscaled'], { type: 'image/webp' })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/media/presign'
        ? Response.json({ url: 'http://s3/put', key: 'covers/k.webp' })
        : new Response(null, { status: 200 }),
    )

    await uploadCover(file, {
      fetchFn: fetchMock as typeof fetch,
      downscale: async () => smaller,
    })

    const [, presignInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(JSON.parse(String(presignInit.body))).toMatchObject({
      contentType: 'image/webp',
      size: smaller.size,
    })
    const [, putInit] = fetchMock.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ]
    expect(putInit.body).toBe(smaller)
    expect((putInit.headers as Record<string, string>)['Content-Type']).toBe(
      'image/webp',
    )
  })
})

describe('CoverUpload component', () => {
  it('uploads the chosen file and reports the key', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/media/presign'
        ? Response.json({ url: 'http://s3/put', key: 'covers/done.png' })
        : new Response(null, { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const onUploaded = vi.fn()

    render(<CoverUpload onUploaded={onUploaded} />)
    const input = screen.getByLabelText('Cover image') as HTMLInputElement
    const file = new File(['bytes'], 'cover.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })

    await screen.findByText('Uploaded')
    expect(onUploaded).toHaveBeenCalledWith('covers/done.png')
  })

  it('rejects non-image files without calling the API', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const onUploaded = vi.fn()

    render(<CoverUpload onUploaded={onUploaded} />)
    const input = screen.getByLabelText('Cover image') as HTMLInputElement
    const file = new File(['%PDF'], 'not-an-image.pdf', {
      type: 'application/pdf',
    })
    fireEvent.change(input, { target: { files: [file] } })

    await screen.findByText(/not a supported image/i)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onUploaded).not.toHaveBeenCalled()
  })

  it('shows the failure state when the upload errors', async () => {
    const fetchMock = vi.fn(
      async () => new Response('{"error":"nope"}', { status: 500 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const onUploaded = vi.fn()

    render(<CoverUpload onUploaded={onUploaded} />)
    const input = screen.getByLabelText('Cover image') as HTMLInputElement
    const file = new File(['bytes'], 'cover.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [file] } })

    await screen.findByText('Upload failed')
    expect(onUploaded).not.toHaveBeenCalled()
  })

  it('resets the input after a failed upload so the same file retries', async () => {
    const fetchMock = vi.fn(
      async () => new Response('{"error":"nope"}', { status: 500 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<CoverUpload onUploaded={vi.fn()} />)
    const input = screen.getByLabelText('Cover image') as HTMLInputElement
    const file = new File(['bytes'], 'cover.png', { type: 'image/png' })

    fireEvent.change(input, { target: { files: [file] } })
    await screen.findByText('Upload failed')
    // The value was reset, so re-selecting the very same file fires change.
    expect(input.value).toBe('')

    fireEvent.change(input, { target: { files: [file] } })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await screen.findByText('Upload failed')
  })

  it('disables the input while an upload is in flight', async () => {
    // Presign never resolves — the upload stays in flight.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )

    render(<CoverUpload onUploaded={vi.fn()} />)
    const input = screen.getByLabelText('Cover image') as HTMLInputElement
    const file = new File(['bytes'], 'cover.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })

    await screen.findByText('Uploading…')
    expect(input.disabled).toBe(true)
  })

  it('reports upload state via onUploadingChange', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/media/presign'
        ? Response.json({ url: 'http://s3/put', key: 'covers/done.png' })
        : new Response(null, { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const onUploadingChange = vi.fn()

    render(
      <CoverUpload
        onUploaded={vi.fn()}
        onUploadingChange={onUploadingChange}
      />,
    )
    const input = screen.getByLabelText('Cover image') as HTMLInputElement
    const file = new File(['bytes'], 'cover.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })

    await screen.findByText('Uploaded')
    expect(onUploadingChange.mock.calls).toEqual([[true], [false]])
  })
})
