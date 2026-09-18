/**
 * Validates a page's URL slug (peterjur.co/<slug>) before it ever reaches
 * the database's unique constraint — format, and collision with an
 * existing top-level route. Returns null when valid, an error message
 * string otherwise (same "value or error string" convention used across
 * this codebase's request-body parsers).
 */

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * The site's actual top-level routes today (`a`, `t`, `app`, `api` — see
 * src/pages/) plus `admin`, reserved defensively even though no such route
 * exists yet, since it's a word an owner might expect to be special.
 */
const RESERVED_SLUGS = new Set(['a', 't', 'app', 'api', 'admin'])

export function validateSlug(slug: string): string | null {
  if (!SLUG_PATTERN.test(slug)) {
    return 'slug must be lowercase letters, digits and hyphens only (no leading, trailing, or doubled hyphens)'
  }
  if (RESERVED_SLUGS.has(slug)) {
    return `"${slug}" is reserved and can't be used as a slug`
  }
  return null
}
