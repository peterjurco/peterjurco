import { describe, expect, it } from 'vitest'
import { imageUrl } from '../src/lib/media/image-url'

/** Explicit config — the env-reading default is exercised in the e2e tests. */
const config = {
  baseUrl: 'https://media.peterjur.co',
  transforms: true,
}

describe('imageUrl', () => {
  it('builds a Cloudflare Images transform URL for the R2 object', () => {
    expect(
      imageUrl('covers/abc123.jpg', { width: 480, quality: 80 }, config),
    ).toBe(
      '/cdn-cgi/image/width=480,quality=80,format=auto/https://media.peterjur.co/covers/abc123.jpg',
    )
  })

  it('carries width, height, quality and format params', () => {
    expect(
      imageUrl(
        'covers/abc123.jpg',
        { width: 800, height: 600, quality: 75, format: 'webp' },
        config,
      ),
    ).toBe(
      '/cdn-cgi/image/width=800,height=600,quality=75,format=webp/https://media.peterjur.co/covers/abc123.jpg',
    )
  })

  it('defaults to format=auto when no options are given', () => {
    expect(imageUrl('covers/abc123.jpg', {}, config)).toBe(
      '/cdn-cgi/image/format=auto/https://media.peterjur.co/covers/abc123.jpg',
    )
  })

  it('normalizes a trailing slash on the base URL', () => {
    expect(
      imageUrl(
        'covers/abc123.jpg',
        { width: 480 },
        { ...config, baseUrl: 'https://media.peterjur.co/' },
      ),
    ).toBe(
      '/cdn-cgi/image/width=480,format=auto/https://media.peterjur.co/covers/abc123.jpg',
    )
  })

  it('serves the original when transforms are disabled (dev/tests)', () => {
    expect(
      imageUrl(
        'covers/abc123.jpg',
        { width: 480 },
        { baseUrl: 'http://localhost:9000/test-bucket', transforms: false },
      ),
    ).toBe('http://localhost:9000/test-bucket/covers/abc123.jpg')
  })
})
