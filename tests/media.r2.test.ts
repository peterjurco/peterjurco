import { describe, expect, it } from 'vitest'
import { objectKey, presignPut } from '../src/lib/media/r2'

describe('objectKey', () => {
  it('produces an opaque key under the prefix, keeping only the extension', () => {
    const key = objectKey('covers', 'holiday photo.JPG')
    expect(key).toMatch(/^covers\/[A-Za-z0-9_-]{21}\.jpg$/)
  })

  it('never trusts the filename — path tricks yield no traversal', () => {
    const key = objectKey('covers', '../../etc/passwd')
    expect(key).toMatch(/^covers\/[A-Za-z0-9_-]{21}$/)
    expect(key).not.toContain('..')
  })

  it('drops missing or garbage extensions', () => {
    expect(objectKey('covers', 'noextension')).toMatch(
      /^covers\/[A-Za-z0-9_-]{21}$/,
    )
    expect(objectKey('covers', 'file.<script>')).toMatch(
      /^covers\/[A-Za-z0-9_-]{21}$/,
    )
    expect(objectKey('covers', 'file.verylongextension')).toMatch(
      /^covers\/[A-Za-z0-9_-]{21}$/,
    )
  })

  it('is collision-safe — two keys for the same filename differ', () => {
    expect(objectKey('covers', 'same.png')).not.toBe(
      objectKey('covers', 'same.png'),
    )
  })
})

describe('presignPut', () => {
  const env = {
    R2_ACCOUNT_ID: 'acct123',
    R2_ACCESS_KEY_ID: 'AKIATEST',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET: 'photos',
  }

  it('returns a short-lived SigV4 query-signed PUT URL on the R2 endpoint', async () => {
    const url = new URL(await presignPut(env, 'covers/abc.jpg'))
    expect(url.origin).toBe('https://acct123.r2.cloudflarestorage.com')
    expect(url.pathname).toBe('/photos/covers/abc.jpg')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600')
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(url.searchParams.get('X-Amz-Credential')).toContain('AKIATEST')
  })

  it('honors an endpoint override (MinIO in tests)', async () => {
    const url = new URL(
      await presignPut(
        { ...env, R2_ENDPOINT: 'http://localhost:9000' },
        'covers/abc.jpg',
      ),
    )
    expect(url.origin).toBe('http://localhost:9000')
    expect(url.pathname).toBe('/photos/covers/abc.jpg')
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy()
  })

  it('fails loudly when R2 config is missing', async () => {
    await expect(
      presignPut({ ...env, R2_BUCKET: undefined }, 'covers/abc.jpg'),
    ).rejects.toThrow('R2_BUCKET')
  })
})
