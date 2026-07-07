/**
 * Display-size URLs for R2-stored images via Cloudflare Images
 * transformations (TECH_DECISIONS §5): originals stay pristine in R2 and the
 * edge derives any size on demand through the zone-local
 * `/cdn-cgi/image/<params>/<origin-url>` route.
 */

export interface ImageTransformOptions {
  width?: number
  height?: number
  quality?: number
  /** Output encoding; `auto` (default) lets the edge pick WebP/AVIF. */
  format?: string
}

export interface ImageUrlConfig {
  /** Public base URL of the R2 bucket (custom domain or r2.dev). */
  baseUrl: string
  /**
   * `false` serves the original object URL — for dev/tests, where no
   * Cloudflare zone handles `/cdn-cgi/image/*` (PUBLIC_IMAGE_TRANSFORMS=off).
   */
  transforms: boolean
}

/**
 * Default config from the build-time public env:
 * - `PUBLIC_R2_PUBLIC_BASE_URL` — public bucket / custom-domain base URL.
 * - `PUBLIC_IMAGE_TRANSFORMS=off` — disable `/cdn-cgi/image` (dev/tests).
 */
export function envImageUrlConfig(): ImageUrlConfig {
  return {
    baseUrl: import.meta.env.PUBLIC_R2_PUBLIC_BASE_URL ?? '',
    transforms: import.meta.env.PUBLIC_IMAGE_TRANSFORMS !== 'off',
  }
}

/** URL serving the R2 object `key` at the requested display size. */
export function imageUrl(
  key: string,
  options: ImageTransformOptions = {},
  config: ImageUrlConfig = envImageUrlConfig(),
): string {
  const base = config.baseUrl.replace(/\/+$/, '')
  const original = `${base}/${key}`
  if (!config.transforms) return original

  const params: string[] = []
  if (options.width !== undefined) params.push(`width=${options.width}`)
  if (options.height !== undefined) params.push(`height=${options.height}`)
  if (options.quality !== undefined) params.push(`quality=${options.quality}`)
  params.push(`format=${options.format ?? 'auto'}`)
  return `/cdn-cgi/image/${params.join(',')}/${original}`
}
