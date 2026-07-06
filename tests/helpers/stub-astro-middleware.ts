/**
 * Vitest stand-in for the `astro:middleware` virtual module (aliased in
 * vitest.config.ts) — the real defineMiddleware is an identity function too.
 */
export function defineMiddleware<T>(handler: T): T {
  return handler
}
