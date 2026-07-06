/** Small helpers shared by JSON API endpoints. */

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status })
}

/** 401 helper for the defense-in-depth auth check inside every handler. */
export function unauthorized(): Response {
  return jsonError(401, 'Unauthorized')
}
