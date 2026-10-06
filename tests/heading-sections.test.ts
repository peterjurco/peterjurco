import { describe, expect, it } from 'vitest'
import { hiddenBlocks, sectionEnds } from '../src/lib/articles/heading-sections'

describe('sectionEnds', () => {
  it('ends a section at the next heading of the same level', () => {
    // H2, p, H2, p
    const ends = sectionEnds([2, null, 2, null])
    expect(ends.get(0)).toBe(2)
    expect(ends.get(2)).toBe(4)
  })

  it('keeps deeper headings inside their parent section', () => {
    // H2, p, H3, p, H2
    const ends = sectionEnds([2, null, 3, null, 2])
    expect(ends.get(0)).toBe(4)
    expect(ends.get(2)).toBe(4)
    expect(ends.get(4)).toBe(5)
  })

  it('ends a section at a heading of a HIGHER level', () => {
    // H3, p, H1, p
    const ends = sectionEnds([3, null, 1, null])
    expect(ends.get(0)).toBe(2)
    expect(ends.get(2)).toBe(4)
  })

  it('gives a trailing heading an empty section', () => {
    expect(sectionEnds([null, 2]).get(1)).toBe(2)
  })

  it('has no entries for non-headings', () => {
    expect(sectionEnds([null, null]).size).toBe(0)
  })
})

describe('hiddenBlocks', () => {
  // 0:H2  1:p  2:H3  3:p  4:H2  5:p
  const levels = [2, null, 3, null, 2, null]

  it('hides everything inside a collapsed section but not the heading', () => {
    expect(hiddenBlocks(levels, new Set([0]))).toEqual([
      false,
      true,
      true,
      true,
      false,
      false,
    ])
  })

  it('collapsing a nested heading only hides its own body', () => {
    expect(hiddenBlocks(levels, new Set([2]))).toEqual([
      false,
      false,
      false,
      true,
      false,
      false,
    ])
  })

  it('a collapsed parent hides a nested section whether or not the child is collapsed', () => {
    const both = hiddenBlocks(levels, new Set([0, 2]))
    const parentOnly = hiddenBlocks(levels, new Set([0]))
    expect(both).toEqual(parentOnly)
  })

  it('hides nothing when nothing is collapsed', () => {
    expect(hiddenBlocks(levels, new Set())).toEqual(levels.map(() => false))
  })
})
