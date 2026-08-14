/**
 * The public tag page (/t/:publicId) crops every album cover to one fixed
 * box per tag — a small, fixed preset list (not free-text) keeps the CSS
 * `aspect-ratio` value and the admin dropdown in lockstep with a single
 * source of truth.
 */
export const COVER_ASPECT_RATIOS = {
  '1/1': 'Square',
  '4/5': 'Portrait',
  '3/2': 'Classic',
  '16/9': 'Wide',
  '2/3': 'Tall',
} as const

export type CoverAspectRatio = keyof typeof COVER_ASPECT_RATIOS

/** Tags created before this feature (or left unset) fall back to this. */
export const DEFAULT_COVER_ASPECT_RATIO: CoverAspectRatio = '4/5'

export function isCoverAspectRatio(value: unknown): value is CoverAspectRatio {
  return typeof value === 'string' && value in COVER_ASPECT_RATIOS
}
