/**
 * Absolutizes a possibly-relative URL against a base. Share-card meta tags
 * (`og:image`, `twitter:image`) require absolute URLs, but `imageUrl`
 * (src/lib/media/image-url.ts) returns a zone-relative `/cdn-cgi/image/…`
 * path when transforms are on. Already-absolute inputs pass through
 * unchanged.
 */
export function absoluteUrl(maybeRelative: string, base: string | URL): string {
  return new URL(maybeRelative, base).href
}
