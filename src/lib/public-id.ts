import { nanoid } from 'nanoid'

/**
 * Opaque, random, URL-safe public identifier (TECH_DECISIONS §9).
 *
 * Used in URLs for anything reachable without authentication (articles,
 * public photo tags) so unlisted resources cannot be enumerated. nanoid's
 * default alphabet is `A-Za-z0-9_-`; 21 chars ≈ UUIDv4 collision resistance.
 */
export function newPublicId(): string {
  return nanoid()
}
