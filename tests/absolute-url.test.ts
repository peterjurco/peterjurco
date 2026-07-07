import { describe, expect, it } from 'vitest'
import { absoluteUrl } from '../src/lib/absolute-url'

/**
 * og:image/twitter:image require absolute URLs, while imageUrl returns a
 * zone-RELATIVE `/cdn-cgi/image/…` path when transforms are on — the e2e
 * suites run with transforms off (absolute originals), so the relative case
 * is pinned here.
 */
describe('absoluteUrl', () => {
  it('absolutizes a zone-relative transform path against the page URL', () => {
    expect(
      absoluteUrl(
        '/cdn-cgi/image/width=1200,format=auto/https://media.peterjur.co/covers/a.jpg',
        'https://peterjur.co/t/AbC123',
      ),
    ).toBe(
      'https://peterjur.co/cdn-cgi/image/width=1200,format=auto/https://media.peterjur.co/covers/a.jpg',
    )
  })

  it('passes an already-absolute URL through unchanged (transforms off)', () => {
    expect(
      absoluteUrl(
        'http://localhost:9000/bucket/covers/a.jpg',
        'https://peterjur.co/t/AbC123',
      ),
    ).toBe('http://localhost:9000/bucket/covers/a.jpg')
  })

  it('accepts a URL base (Astro.url)', () => {
    expect(
      absoluteUrl('/cover.jpg', new URL('https://peterjur.co/t/AbC123?x=1')),
    ).toBe('https://peterjur.co/cover.jpg')
  })
})
