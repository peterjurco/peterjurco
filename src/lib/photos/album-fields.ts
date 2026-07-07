import { isGooglePhotosUrl } from './album-url'

export interface AlbumFields {
  name?: string
  googlePhotosUrl?: string
  coverImageKey?: string | null
  tags?: string[]
}

/**
 * Validates any album fields present on a request body — shared by the
 * create (POST /api/photos/albums) and patch (PATCH /api/photos/albums/:id)
 * handlers. Returns the fields, or an error string naming the bad one.
 */
export function parseAlbumFields(
  body: Record<string, unknown>,
): AlbumFields | string {
  const fields: AlbumFields = {}
  if ('name' in body) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return 'name must be a non-empty string'
    }
    fields.name = body.name.trim()
  }
  if ('googlePhotosUrl' in body) {
    if (
      typeof body.googlePhotosUrl !== 'string' ||
      !isGooglePhotosUrl(body.googlePhotosUrl)
    ) {
      return 'googlePhotosUrl must be a Google Photos link (https://photos.app.goo.gl/… or https://photos.google.com/…)'
    }
    fields.googlePhotosUrl = body.googlePhotosUrl
  }
  if ('coverImageKey' in body) {
    if (body.coverImageKey !== null && typeof body.coverImageKey !== 'string') {
      return 'coverImageKey must be a string or null'
    }
    fields.coverImageKey = body.coverImageKey as string | null
  }
  if ('tags' in body) {
    if (
      !Array.isArray(body.tags) ||
      body.tags.some((tag) => typeof tag !== 'string')
    ) {
      return 'tags must be an array of strings'
    }
    fields.tags = body.tags as string[]
  }
  return fields
}
