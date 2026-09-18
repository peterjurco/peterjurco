import { describe, expect, it } from 'vitest'
import { validateSlug } from '../src/lib/pages/slug'

describe('validateSlug', () => {
  it('accepts valid slugs', () => {
    for (const slug of ['travel', 'best-of-2026', 'a1', 'trip-to-japan-2024']) {
      expect(validateSlug(slug)).toBeNull()
    }
  })

  it('rejects invalid formats', () => {
    for (const slug of [
      '',
      'Travel',
      'my slug',
      '-travel',
      'travel-',
      'travel--2026',
      'travel_2026',
      'travel.html',
    ]) {
      expect(validateSlug(slug), slug).not.toBeNull()
    }
  })

  it('rejects reserved segments', () => {
    for (const slug of ['a', 't', 'app', 'api', 'admin']) {
      expect(validateSlug(slug), slug).not.toBeNull()
    }
  })
})
