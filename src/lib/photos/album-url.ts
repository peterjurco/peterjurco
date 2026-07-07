/**
 * An album's link must be a Google Photos share URL — the hub stores curated
 * links only, no Photos API (TECH_DECISIONS §8). Shared by the AlbumForm
 * island (inline validation) and the album API (defense in depth).
 */
export function isGooglePhotosUrl(value: string): boolean {
  return (
    value.startsWith('https://photos.app.goo.gl/') ||
    value.startsWith('https://photos.google.com/')
  )
}
