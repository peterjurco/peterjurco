import { describe, expect, it } from 'vitest'
import { newPublicId } from '../src/lib/public-id'

describe('newPublicId', () => {
  it('returns a URL-safe string of at least 12 chars', () => {
    const id = newPublicId()
    expect(id.length).toBeGreaterThanOrEqual(12)
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('does not collide across 10k calls', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 10_000; i++) {
      ids.add(newPublicId())
    }
    expect(ids.size).toBe(10_000)
  })

  it('every generated id matches the URL-safe alphabet', () => {
    for (let i = 0; i < 1_000; i++) {
      expect(newPublicId()).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })
})
