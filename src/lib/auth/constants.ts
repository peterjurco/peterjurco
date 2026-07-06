/**
 * "Stay signed in indefinitely on this device": sessions — and the cookie
 * carrying their token — live ~5 years. Single source of truth shared by
 * session.ts (DB expiry) and cookie.ts (cookie Max-Age).
 */
export const SESSION_TTL_MS = 5 * 365 * 24 * 60 * 60 * 1000
