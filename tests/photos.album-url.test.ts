import { describe, expect, it } from 'vitest'
import { isGooglePhotosUrl } from '../src/lib/photos/album-url'

describe('isGooglePhotosUrl', () => {
  it('accepts Google Photos share links', () => {
    expect(isGooglePhotosUrl('https://photos.app.goo.gl/AbCdEf123')).toBe(true)
    expect(
      isGooglePhotosUrl('https://photos.google.com/share/AF1QipM...abc'),
    ).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isGooglePhotosUrl('http://photos.app.goo.gl/AbCdEf123')).toBe(false)
    expect(isGooglePhotosUrl('https://photos.app.goo.gl.evil.com/x')).toBe(
      false,
    )
    expect(isGooglePhotosUrl('https://evil.com/photos.google.com/')).toBe(false)
    expect(isGooglePhotosUrl('https://drive.google.com/file/d/x')).toBe(false)
    expect(isGooglePhotosUrl('javascript:alert(1)')).toBe(false)
    expect(isGooglePhotosUrl('')).toBe(false)
    expect(isGooglePhotosUrl('photos.google.com/share/x')).toBe(false)
  })
})
