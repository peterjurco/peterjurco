/** Small helpers shared by JSON API endpoints. */

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status })
}

/** 401 helper for the defense-in-depth auth check inside every handler. */
export function unauthorized(): Response {
  return jsonError(401, 'Unauthorized')
}

/** Parses a positive-integer route param; null drives the 400 (API) / 404 (pages). */
export function parseId(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
