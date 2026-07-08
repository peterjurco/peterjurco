import type { PhotoTagVisibility } from '../photos/repo'

/**
 * Validates a create/rename body of the shape `{name}` — non-empty string.
 * Returns the trimmed name, or an error string.
 */
export function parseName(
  body: Record<string, unknown>,
): { name: string } | string {
  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return 'name must be a non-empty string'
  }
  return { name: body.name.trim() }
}

export interface PhotoTagPatchFields {
  name?: string
  visibility?: PhotoTagVisibility
}

/**
 * Validates a photo-tag PATCH body: `name` and/or `visibility` (the
 * public/private toggle — REQUIREMENTS "mark a tag as public"). Returns the
 * fields present, or an error string naming the bad one.
 */
export function parsePhotoTagPatch(
  body: Record<string, unknown>,
): PhotoTagPatchFields | string {
  const fields: PhotoTagPatchFields = {}
  if ('name' in body) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return 'name must be a non-empty string'
    }
    fields.name = body.name.trim()
  }
  if ('visibility' in body) {
    if (body.visibility !== 'private' && body.visibility !== 'public') {
      return 'visibility must be "private" or "public"'
    }
    fields.visibility = body.visibility
  }
  return fields
}
