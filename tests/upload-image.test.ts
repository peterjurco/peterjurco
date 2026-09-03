// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_EDGE_PX,
  MAX_UPLOAD_BYTES,
  targetDimensions,
  uploadImage,
} from '../src/lib/media/upload-image'

afterEach(() => {
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

  it('honors a custom max edge', () => {
    expect(targetDimensions(100, 50, 10)).toEqual({ width: 10, height: 5 })
  })

  it('rounds fractional targets to whole pixels', () => {
    expect(targetDimensions(3001, 2000)).toEqual({ width: 2560, height: 1706 })
  })

  it('exports the DESIGN cap of 2560px', () => {
    expect(MAX_EDGE_PX).toBe(2560)
  })
})

describe('uploadImage', () => {
  const file = new File(['png-bytes'], 'photo.png', { type: 'image/png' })
  /** Identity downscale — real canvas encoding is not exercised in jsdom. */
  const passthrough = async (input: File) => input as Blob

  it('sends the given prefix and resolves with the stored key', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/media/presign') {
        return Response.json({
          url: 'http://localhost:9000/bucket/articles/k.png?sig=x',
          key: 'articles/k.png',
        })
      }
      return new Response(null, { status: 200 })
    })

    const key = await uploadImage(file, 'articles', {
      fetchFn: fetchMock as typeof fetch,
      downscale: passthrough,
    })
    expect(key).toBe('articles/k.png')

    const [presignUrl, presignInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(presignUrl).toBe('/api/media/presign')
    expect(JSON.parse(String(presignInit.body))).toEqual({
      contentType: 'image/png',
      size: file.size,
      prefix: 'articles',
      filename: 'photo.png',
    })

    const [putUrl, putInit] = fetchMock.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ]
    expect(putUrl).toBe('http://localhost:9000/bucket/articles/k.png?sig=x')
    expect(putInit.method).toBe('PUT')
  })

  it('rejects when the presign request is refused', async () => {
    const fetchMock = vi.fn(
      async () => new Response('{"error":"nope"}', { status: 401 }),
    )
    await expect(
      uploadImage(file, 'articles', {
        fetchFn: fetchMock as typeof fetch,
        downscale: passthrough,
      }),
    ).rejects.toThrow(/presign/i)
  })

  it('rejects when the PUT to storage fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/media/presign'
        ? Response.json({ url: 'http://s3/put', key: 'articles/k.png' })
        : new Response(null, { status: 403 }),
    )
    await expect(
      uploadImage(file, 'articles', {
        fetchFn: fetchMock as typeof fetch,
        downscale: passthrough,
      }),
    ).rejects.toThrow(/upload/i)
  })

  it('rejects oversized files without hitting the network', async () => {
    const bigBlob = { size: MAX_UPLOAD_BYTES + 1, type: 'image/png' } as Blob
    const fetchMock = vi.fn()
    await expect(
      uploadImage(file, 'articles', {
        fetchFn: fetchMock as unknown as typeof fetch,
        downscale: async () => bigBlob,
      }),
    ).rejects.toThrow(/too large/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects unsupported content types without hitting the network', async () => {
    const badBlob = new Blob(['x'], { type: 'application/pdf' })
    const fetchMock = vi.fn()
    await expect(
      uploadImage(file, 'articles', {
        fetchFn: fetchMock as unknown as typeof fetch,
        downscale: async () => badBlob,
      }),
    ).rejects.toThrow(/unsupported/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
