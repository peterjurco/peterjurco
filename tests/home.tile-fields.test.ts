import { describe, expect, it } from 'vitest'
import {
  parseLayoutPayload,
  parseTileFields,
  requireCompleteTile,
} from '../src/lib/home/tile-fields'

/** A valid, complete photo-tile body. */
const PHOTO_BODY = {
  kind: 'photo',
  imageKeys: ['home/red.webp'],
  x: 2.5,
  y: 1,
  width: 48,
  height: 22.5,
  rotation: 0,
  border: { width: 4, color: '#f0e7d3' },
  hoverEffect: 'develop',
  zIndex: 1,
  cycleIntervalMs: null,
}

const QUOTE_BODY = {
  kind: 'quote',
  textContent: 'Everything has led to this',
  cite: '— somewhere north',
  x: 60,
  y: 10,
  width: 30,
  height: 15,
  rotation: -1.6,
  zIndex: 5,
}

describe('parseTileFields — per-field validation', () => {
  it('accepts a full photo tile and a full quote tile', () => {
    expect(parseTileFields(PHOTO_BODY)).toMatchObject({ kind: 'photo' })
    expect(parseTileFields(QUOTE_BODY)).toMatchObject({ kind: 'quote' })
  })

  it.each([
    ['kind', 'headline'],
    ['imageKeys', 'home/red.webp'], // not an array
    ['imageKeys', [42]],
    ['imageKeys', ['']],
    ['imageKeys', Array.from({ length: 51 }, (_, i) => `home/${i}.webp`)],
    ['textContent', 12],
    ['textContent', 'x'.repeat(2001)],
    ['cite', 'x'.repeat(501)],
    ['x', '10'],
    ['x', -51], // below off-canvas slack
    ['x', 151],
    ['y', Number.NaN],
    ['width', 0.5], // min 1
    ['width', 101],
    ['height', 0],
    ['height', 151],
    ['rotation', -46],
    ['rotation', 46],
    ['zIndex', 1.5], // must be an integer
    ['hoverEffect', 'warm'], // rejected DESIGN direction
    ['border', { width: 4 }], // missing color
    ['border', { width: -1, color: '#fff' }],
    ['border', 'thick'],
    ['cycleIntervalMs', 100], // below 500ms min
    ['cycleIntervalMs', 60001], // above 60s max
    ['cycleIntervalMs', 'fast'],
  ])('rejects bad %s = %j', (field, value) => {
    const result = parseTileFields({ ...PHOTO_BODY, [field]: value })
    expect(typeof result).toBe('string')
    expect(result).toContain(field)
  })

  it('allows generous off-canvas slack and the full rotation range', () => {
    expect(
      typeof parseTileFields({ ...PHOTO_BODY, x: -50, y: 150, rotation: 45 }),
    ).toBe('object')
  })

  it('accepts explicit nulls for clearable fields', () => {
    const parsed = parseTileFields({
      ...PHOTO_BODY,
      border: null,
      hoverEffect: null,
      cycleIntervalMs: null,
      cite: null,
    })
    expect(parsed).toMatchObject({ border: null, hoverEffect: null })
  })

  it('accepts a multi-image photo tile with a cycle interval in range', () => {
    const parsed = parseTileFields({
      ...PHOTO_BODY,
      imageKeys: ['home/red.webp', 'home/earth.webp'],
      cycleIntervalMs: 3000,
    })
    expect(parsed).toMatchObject({
      imageKeys: ['home/red.webp', 'home/earth.webp'],
      cycleIntervalMs: 3000,
    })
  })

  it('accepts an empty imageKeys array (incomplete tile — caught by requireCompleteTile)', () => {
    const parsed = parseTileFields({ ...PHOTO_BODY, imageKeys: [] })
    expect(parsed).toMatchObject({ imageKeys: [] })
  })
})

describe('requireCompleteTile — create/bulk entries', () => {
  it('demands the layout fields and kind', () => {
    const missing = requireCompleteTile({})
    expect(typeof missing).toBe('string')
  })

  it('photo tiles must carry at least one image key', () => {
    const { imageKeys, ...rest } = PHOTO_BODY
    const parsed = parseTileFields(rest)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(requireCompleteTile(parsed)).toContain('image')
  })

  it('rejects a photo tile with an explicit empty imageKeys array', () => {
    const parsed = parseTileFields({ ...PHOTO_BODY, imageKeys: [] })
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(requireCompleteTile(parsed)).toContain('image')
  })

  it('accepts a photo tile with exactly one image key', () => {
    const parsed = parseTileFields(PHOTO_BODY)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(requireCompleteTile(parsed)).toMatchObject({
      imageKeys: ['home/red.webp'],
    })
  })

  it('accepts a photo tile with several image keys', () => {
    const parsed = parseTileFields({
      ...PHOTO_BODY,
      imageKeys: ['home/red.webp', 'home/earth.webp', 'home/blue.webp'],
    })
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(requireCompleteTile(parsed)).toMatchObject({
      imageKeys: ['home/red.webp', 'home/earth.webp', 'home/blue.webp'],
    })
  })

  it('quote tiles must carry text content', () => {
    const { textContent, ...rest } = QUOTE_BODY
    const parsed = parseTileFields(rest)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(requireCompleteTile(parsed)).toContain('textContent')
  })

  it('passes complete tiles through as repo values', () => {
    const parsed = parseTileFields(QUOTE_BODY)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(requireCompleteTile(parsed)).toMatchObject({
      kind: 'quote',
      textContent: QUOTE_BODY.textContent,
      zIndex: 5,
    })
  })
})

describe('parseLayoutPayload — the PUT bulk body', () => {
  it('accepts { tiles: [...] } where entries may carry ids', () => {
    const result = parseLayoutPayload({
      tiles: [{ ...PHOTO_BODY, id: 3 }, QUOTE_BODY],
    })
    if (typeof result === 'string') throw new Error(result)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: 3, kind: 'photo' })
    expect(result[1]?.id).toBeUndefined()
  })

  it('accepts an empty canvas', () => {
    expect(parseLayoutPayload({ tiles: [] })).toEqual([])
  })

  it('rejects non-arrays, invalid entries and bad ids', () => {
    expect(typeof parseLayoutPayload({})).toBe('string')
    expect(typeof parseLayoutPayload({ tiles: 'nope' })).toBe('string')
    expect(
      typeof parseLayoutPayload({ tiles: [{ ...PHOTO_BODY, x: 999 }] }),
    ).toBe('string')
    expect(
      typeof parseLayoutPayload({ tiles: [{ ...PHOTO_BODY, id: -1 }] }),
    ).toBe('string')
    // An incomplete entry (no image keys on a photo) fails the bulk save too.
    const { imageKeys, ...incomplete } = PHOTO_BODY
    expect(typeof parseLayoutPayload({ tiles: [incomplete] })).toBe('string')
  })

  it('names the offending tile index in the error', () => {
    const result = parseLayoutPayload({
      tiles: [PHOTO_BODY, { ...PHOTO_BODY, rotation: 90 }],
    })
    expect(result).toContain('tiles[1]')
  })
})

describe('border.color — inline-style injection is rejected', () => {
  it('accepts hex colors only', () => {
    for (const color of ['#f0e7d3', '#17140F', '#abc', '#aabbccdd']) {
      const result = parseTileFields({ border: { width: 2, color } })
      expect(result, color).not.toBeTypeOf('string')
    }
  })

  it('rejects CSS-declaration smuggling and non-hex colors', () => {
    for (const color of [
      'red;background:url(https://evil.example/ping)',
      'url(https://evil.example)',
      'red',
      'rgb(1,2,3)',
      'var(--accent)',
      '',
    ]) {
      const result = parseTileFields({ border: { width: 2, color } })
      expect(result, color).toBeTypeOf('string')
    }
  })
})
