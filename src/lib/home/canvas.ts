/**
 * Shared home-canvas constants and types — importable from BOTH server code
 * (repo, API validation, .astro pages) and client islands (canvas editor),
 * so it must stay free of DB/env imports.
 *
 * COORDINATE SYSTEM (the one contract the editor and the public renderer
 * share): every tile stores `x`, `y`, `width`, `height` as PERCENTAGES of a
 * fixed-aspect canvas — `x`/`width` relative to the canvas width, `y`/`height`
 * relative to the canvas height. The canvas itself always renders at 100%
 * of the available width with `aspect-ratio: CANVAS_ASPECT` (a 5:7 poster
 * proportion — tall enough for the 10–50-tile wall REQUIREMENTS asks for),
 * so tiles scale proportionally at every viewport and keep their aspect
 * stable. Rotation is stored in degrees around the tile center.
 */

/** Canvas proportion, width : height. Rendered as CSS `aspect-ratio`. */
export const CANVAS_ASPECT = { width: 5, height: 7 } as const

/** CSS value for the canvas container. */
export const CANVAS_ASPECT_CSS = `${CANVAS_ASPECT.width} / ${CANVAS_ASPECT.height}`

/** Per-tile border, stored in the `border` jsonb column (null = no border). */
export interface TileBorder {
  /** CSS pixels at the reference canvas size. */
  width: number
  /** Any CSS color, e.g. `#f0e7d3`. */
  color: string
}

/**
 * Hover effects a tile can opt into. `develop` is the DESIGN default (slow
 * filter-only reveal); `none` keeps the resting grade static.
 */
export const HOVER_EFFECTS = ['develop', 'none'] as const
export type HoverEffect = (typeof HOVER_EFFECTS)[number]

/**
 * Validation ranges shared by the API and the editor clamps. `x`/`y` allow
 * generous off-canvas slack so a tile can bleed past the edges by design.
 */
export const TILE_RANGES = {
  x: { min: -50, max: 150 },
  y: { min: -50, max: 150 },
  width: { min: 1, max: 100 },
  height: { min: 0.5, max: 150 },
  rotation: { min: -45, max: 45 },
} as const
