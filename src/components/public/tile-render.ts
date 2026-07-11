import type { TileBorder } from '../../lib/home/canvas'
import {
  envImageUrlConfig,
  type ImageUrlConfig,
  imageUrl,
} from '../../lib/media/image-url'

/**
 * Pure rendering rules for one home tile — kept out of TileRenderer.astro so
 * they are unit-testable. Styling itself lives in src/styles/public-home.css.
 *
 * QUOTE TREATMENT CONVENTION: DESIGN has two quote voices — the cream cinema
 * `marquee` (lightbox slat-lines, oxblood type) and the dark `quote-ink`.
 * A quote WITH a `cite` renders as the marquee, one WITHOUT renders as ink —
 * exactly how the two mock quotes differ. No extra schema field needed; the
 * owner steers the treatment from the editor by filling or clearing the cite.
 */

/** The slice of a home_tiles row the renderer needs. */
export interface RenderTile {
  kind: 'photo' | 'quote'
  imageKeys: string[]
  textContent: string | null
  cite: string | null
  x: number
  y: number
  width: number
  height: number
  rotation: number
  border: TileBorder | null
  hoverEffect: string | null
  zIndex: number
  cycleIntervalMs: number | null
}

/** Display width requested from the image edge — tiles top out well below it. */
export const TILE_IMAGE_WIDTH = 1200

/**
 * Guards SSR against malformed rows (the API enforces completeness, but the
 * DB schema cannot): a photo without any imageKeys would make tileImageSrc(s)
 * throw and 500 the whole homepage; a quote without text renders an empty
 * box. The page skips (and logs) such rows instead of failing the render.
 */
export function isRenderable(tile: RenderTile): boolean {
  // Falsy check mirrors requireCompleteTile ('' is as unrenderable as null).
  if (tile.kind === 'photo') return tile.imageKeys.some((key) => Boolean(key))
  return Boolean(tile.textContent)
}

export function tileClasses(tile: RenderTile): string {
  if (tile.kind === 'photo') {
    // `develop` is the DESIGN default; only an explicit 'none' opts out.
    return tile.hoverEffect === 'none' ? 'tile photo' : 'tile photo develop'
  }
  return tile.cite ? 'tile marquee' : 'tile quote-ink'
}

/**
 * Inline layout style: canvas-percentage box (see src/lib/home/canvas.ts),
 * stacking order, optional border. Rotation is exposed ONLY as the `--tilt`
 * custom property — the base `.tile` rule applies it, and quote hover rules
 * steady it via calc(); an inline `transform` would override those.
 */
export function tileStyle(tile: RenderTile): string {
  const parts = [
    `left:${tile.x}%`,
    `top:${tile.y}%`,
    `width:${tile.width}%`,
    `height:${tile.height}%`,
    `--tilt:${tile.rotation}deg`,
    `z-index:${tile.zIndex}`,
  ]
  if (tile.border) {
    parts.push(`border:${tile.border.width}px solid ${tile.border.color}`)
  }
  return parts.join(';')
}

/**
 * Display URL for a single-image photo tile (imageKeys.length === 1) via the
 * media layer (imageUrl). For multi-image tiles use tileImageSrcs instead —
 * this always resolves the FIRST key, so it must not be used once a tile may
 * have more than one image.
 */
export function tileImageSrc(
  tile: RenderTile,
  config: ImageUrlConfig = envImageUrlConfig(),
): string {
  const [firstKey] = tile.imageKeys
  if (!firstKey) {
    throw new Error(`Photo tile has no image key (kind=${tile.kind})`)
  }
  return imageUrl(firstKey, { width: TILE_IMAGE_WIDTH }, config)
}

/** Display URLs for every image on a photo tile, in stored order. */
export function tileImageSrcs(
  tile: RenderTile,
  config: ImageUrlConfig = envImageUrlConfig(),
): string[] {
  return tile.imageKeys.map((key) =>
    imageUrl(key, { width: TILE_IMAGE_WIDTH }, config),
  )
}
