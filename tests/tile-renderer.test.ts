import { describe, expect, it } from 'vitest'
import type { RenderTile } from '../src/components/public/tile-render'
import {
  isRenderable,
  tileClasses,
  tileImageSrc,
  tileImageSrcs,
  tileStyle,
} from '../src/components/public/tile-render'

/**
 * The pure rendering contract behind TileRenderer.astro — classes, inline
 * style and image src(s) derived from a home_tiles row. The .astro wrapper
 * (single image vs CycleGroup island) is exercised end-to-end in
 * tests/public-home.e2e.test.ts.
 */

const PHOTO: RenderTile = {
  kind: 'photo',
  imageKeys: ['home/redhouse.webp'],
  textContent: null,
  cite: null,
  x: 2.5,
  y: 1,
  width: 48,
  height: 22.5,
  rotation: 0,
  border: null,
  hoverEffect: null,
  zIndex: 3,
  cycleIntervalMs: null,
}

const MARQUEE_QUOTE: RenderTile = {
  ...PHOTO,
  kind: 'quote',
  imageKeys: [],
  textContent: 'Everything has led to this',
  cite: '— on the road, somewhere north',
  rotation: -1.6,
}

describe('tileClasses', () => {
  it('photo tiles get the Develop hover by default (null and explicit)', () => {
    expect(tileClasses(PHOTO)).toBe('tile photo develop')
    expect(tileClasses({ ...PHOTO, hoverEffect: 'develop' })).toBe(
      'tile photo develop',
    )
  })

  it("hover_effect 'none' drops the develop class but keeps the resting grade", () => {
    expect(tileClasses({ ...PHOTO, hoverEffect: 'none' })).toBe('tile photo')
  })

  it('quote tiles render as marquee when cited, ink when not', () => {
    // Convention (see tile-render.ts): the cite line picks the treatment.
    expect(tileClasses(MARQUEE_QUOTE)).toBe('tile marquee')
    expect(tileClasses({ ...MARQUEE_QUOTE, cite: null })).toBe('tile quote-ink')
  })
})

describe('tileStyle', () => {
  it('positions and sizes in canvas percentages with stacking order', () => {
    const style = tileStyle(PHOTO)
    expect(style).toContain('left:2.5%')
    expect(style).toContain('top:1%')
    expect(style).toContain('width:48%')
    expect(style).toContain('height:22.5%')
    expect(style).toContain('z-index:3')
  })

  it('exposes rotation only as the --tilt custom property — never an inline transform', () => {
    const style = tileStyle(MARQUEE_QUOTE)
    expect(style).toContain('--tilt:-1.6deg')
    // An inline transform would out-specificity the hover steadying rule
    // (.marquee:hover rotates toward calc(var(--tilt) * .375)).
    expect(style).not.toContain('transform')
  })

  it('applies the stored border, omitting it when null', () => {
    expect(
      tileStyle({ ...PHOTO, border: { width: 4, color: '#f0e7d3' } }),
    ).toContain('border:4px solid #f0e7d3')
    expect(tileStyle(PHOTO)).not.toContain('border')
  })
})

describe('tileImageSrc — single-image tiles', () => {
  it('derives a ~1200px edge-transformed URL from the R2 key', () => {
    const src = tileImageSrc(PHOTO, {
      baseUrl: 'https://img.example.com',
      transforms: true,
    })
    expect(src).toBe(
      '/cdn-cgi/image/width=1200,format=auto/https://img.example.com/home/redhouse.webp',
    )
  })

  it('serves the original object URL when transforms are off (dev/tests)', () => {
    const src = tileImageSrc(PHOTO, {
      baseUrl: 'http://localhost:9000/bucket',
      transforms: false,
    })
    expect(src).toBe('http://localhost:9000/bucket/home/redhouse.webp')
  })

  it('resolves the FIRST key when a tile has several', () => {
    const src = tileImageSrc(
      { ...PHOTO, imageKeys: ['home/first.webp', 'home/second.webp'] },
      { baseUrl: 'http://localhost:9000/bucket', transforms: false },
    )
    expect(src).toBe('http://localhost:9000/bucket/home/first.webp')
  })

  it('throws on a photo tile without any image keys (data invariant)', () => {
    expect(() => tileImageSrc({ ...PHOTO, imageKeys: [] })).toThrow(
      /image key/i,
    )
  })
})

describe('tileImageSrcs — every image on a photo tile', () => {
  it('derives one URL per key, in stored order', () => {
    const srcs = tileImageSrcs(
      { ...PHOTO, imageKeys: ['home/a.webp', 'home/b.webp', 'home/c.webp'] },
      { baseUrl: 'http://localhost:9000/bucket', transforms: false },
    )
    expect(srcs).toEqual([
      'http://localhost:9000/bucket/home/a.webp',
      'http://localhost:9000/bucket/home/b.webp',
      'http://localhost:9000/bucket/home/c.webp',
    ])
  })

  it('returns an empty array for a tile with no images', () => {
    expect(tileImageSrcs({ ...PHOTO, imageKeys: [] })).toEqual([])
  })
})

describe('isRenderable — SSR guard against malformed rows', () => {
  it('accepts complete photo and quote tiles', () => {
    expect(isRenderable(PHOTO)).toBe(true)
    expect(isRenderable(MARQUEE_QUOTE)).toBe(true)
  })

  it('accepts a multi-image photo tile', () => {
    expect(isRenderable({ ...PHOTO, imageKeys: ['a.webp', 'b.webp'] })).toBe(
      true,
    )
  })

  it('rejects a photo tile without any image keys', () => {
    expect(isRenderable({ ...PHOTO, imageKeys: [] })).toBe(false)
    expect(isRenderable({ ...PHOTO, imageKeys: [''] })).toBe(false)
  })

  it('rejects a quote tile without text', () => {
    expect(isRenderable({ ...MARQUEE_QUOTE, textContent: null })).toBe(false)
    expect(isRenderable({ ...MARQUEE_QUOTE, textContent: '' })).toBe(false)
  })
})
