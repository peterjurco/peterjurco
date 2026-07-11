import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { photoAlbums, photoAlbumsTagsMap, photoTags } from '../src/db/schema'
import { deleteObject } from '../src/lib/media/r2'
import {
  albumExists,
  createAlbum,
  createTag,
  deleteAlbum,
  getAlbumById,
  getPublicTagByPublicId,
  getTagById,
  listAlbums,
  listByTag,
  listTags,
  setAlbumTags,
  setTagVisibility,
  updateAlbum,
} from '../src/lib/photos/repo'
import { createTestDb } from './helpers/test-db'

vi.mock('../src/lib/media/r2', () => ({
  deleteObject: vi.fn().mockResolvedValue(undefined),
}))

const { db, close } = createTestDb()

// R2 credentials are irrelevant — deleteObject is mocked above, so no real
// network call is ever made.
const R2_ENV = {}

beforeEach(async () => {
  // FK order: join rows → albums → tags.
  await db.delete(photoAlbumsTagsMap)
  await db.delete(photoAlbums)
  await db.delete(photoTags)
  vi.mocked(deleteObject).mockReset().mockResolvedValue(undefined)
})

afterAll(async () => {
  await close()
})

const GPHOTOS_URL = 'https://photos.app.goo.gl/AbCdEf123'

describe('createAlbum / updateAlbum', () => {
  it('creates an album with name, link and optional cover key', async () => {
    const album = await createAlbum(db, {
      name: 'Analogue 2024',
      googlePhotosUrl: GPHOTOS_URL,
      coverImageKey: 'covers/abc.jpg',
    })
    expect(album.id).toBeGreaterThan(0)
    expect(album.name).toBe('Analogue 2024')
    expect(album.googlePhotosUrl).toBe(GPHOTOS_URL)
    expect(album.coverImageKey).toBe('covers/abc.jpg')
  })

  it('creates without a cover (nullable) and patches fields independently', async () => {
    const album = await createAlbum(db, {
      name: 'No cover yet',
      googlePhotosUrl: GPHOTOS_URL,
    })
    expect(album.coverImageKey).toBeNull()

    const renamed = await updateAlbum(db, album.id, { name: 'Renamed' }, R2_ENV)
    expect(renamed?.name).toBe('Renamed')
    expect(renamed?.googlePhotosUrl).toBe(GPHOTOS_URL)

    const covered = await updateAlbum(
      db,
      album.id,
      { coverImageKey: 'covers/new.webp' },
      R2_ENV,
    )
    expect(covered?.coverImageKey).toBe('covers/new.webp')

    const cleared = await updateAlbum(
      db,
      album.id,
      { coverImageKey: null },
      R2_ENV,
    )
    expect(cleared?.coverImageKey).toBeNull()
  })

  it('returns null when the album does not exist', async () => {
    expect(await updateAlbum(db, 999999, { name: 'ghost' }, R2_ENV)).toBeNull()
    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('bumps updated_at on update', async () => {
    const album = await createAlbum(db, {
      name: 'Stamps',
      googlePhotosUrl: GPHOTOS_URL,
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const updated = await updateAlbum(
      db,
      album.id,
      { name: 'Stamps v2' },
      R2_ENV,
    )
    expect(updated).not.toBeNull()
    if (!updated) throw new Error('unreachable')
    expect(updated.updatedAt.getTime()).toBeGreaterThan(
      album.updatedAt.getTime(),
    )
  })
})

describe('setAlbumTags', () => {
  it('creates missing tags on the fly — private, with an opaque public id', async () => {
    const album = await createAlbum(db, {
      name: 'Family',
      googlePhotosUrl: GPHOTOS_URL,
    })
    await setAlbumTags(db, album.id, ['family', 'analogue'])

    const tags = await listTags(db)
    expect(tags.map((tag) => tag.name).sort()).toEqual(['analogue', 'family'])
    for (const tag of tags) {
      expect(tag.visibility).toBe('private')
      expect(tag.publicId).toMatch(/^[A-Za-z0-9_-]{21}$/)
    }
  })

  it('reuses existing tags, keeping their visibility and public id', async () => {
    const tag = await createTag(db, 'family')
    await setTagVisibility(db, tag.id, 'public')

    const album = await createAlbum(db, {
      name: 'Summer',
      googlePhotosUrl: GPHOTOS_URL,
    })
    await setAlbumTags(db, album.id, ['family'])

    const tags = await listTags(db)
    expect(tags).toHaveLength(1)
    expect(tags[0]?.id).toBe(tag.id)
    expect(tags[0]?.visibility).toBe('public')
    expect(tags[0]?.publicId).toBe(tag.publicId)
  })

  it('replaces the set, trims blanks/dupes and GCs unreferenced tags', async () => {
    const album = await createAlbum(db, {
      name: 'GC me',
      googlePhotosUrl: GPHOTOS_URL,
    })
    const other = await createAlbum(db, {
      name: 'Keeps shared',
      googlePhotosUrl: GPHOTOS_URL,
    })
    await setAlbumTags(db, album.id, ['solo', 'shared'])
    await setAlbumTags(db, other.id, ['shared'])

    await setAlbumTags(db, album.id, [' fresh ', 'fresh', ''])

    const tags = await listTags(db)
    // `solo` (now unreferenced) is GCed; `shared` survives via `other`.
    expect(tags.map((tag) => tag.name).sort()).toEqual(['fresh', 'shared'])

    const albums = await listAlbums(db)
    const mine = albums.find((entry) => entry.id === album.id)
    expect(mine?.tags.map((tag) => tag.name)).toEqual(['fresh'])
  })

  it('keeps a PUBLIC tag alive when its last album drops it (share URL anchor)', async () => {
    const album = await createAlbum(db, {
      name: 'Shares',
      googlePhotosUrl: GPHOTOS_URL,
    })
    await setAlbumTags(db, album.id, ['travel'])
    const tag = (await listTags(db)).find((entry) => entry.name === 'travel')
    if (!tag) throw new Error('tag not created')
    await setTagVisibility(db, tag.id, 'public')

    await setAlbumTags(db, album.id, [])

    // The tag survives with zero albums — its /t/ URL keeps working.
    expect((await getTagById(db, tag.id))?.visibility).toBe('public')
    const shared = await getPublicTagByPublicId(db, tag.publicId)
    expect(shared?.name).toBe('travel')
    expect(shared?.albums).toEqual([])
  })

  it('GCs a PRIVATE tag when its last album drops it', async () => {
    const album = await createAlbum(db, {
      name: 'Private stuff',
      googlePhotosUrl: GPHOTOS_URL,
    })
    await setAlbumTags(db, album.id, ['fleeting'])
    const tag = (await listTags(db)).find((entry) => entry.name === 'fleeting')
    if (!tag) throw new Error('tag not created')

    await setAlbumTags(db, album.id, [])

    expect(await getTagById(db, tag.id)).toBeNull()
  })
})

describe('listAlbums / listByTag', () => {
  it('lists all albums with their tags, newest-updated first', async () => {
    const first = await createAlbum(db, {
      name: 'First',
      googlePhotosUrl: GPHOTOS_URL,
    })
    await createAlbum(db, {
      name: 'Second',
      googlePhotosUrl: GPHOTOS_URL,
    })
    await setAlbumTags(db, first.id, ['family'])

    const albums = await listAlbums(db)
    expect(albums.map((album) => album.name)).toEqual(['Second', 'First'])
    expect(albums[1]?.tags.map((tag) => tag.name)).toEqual(['family'])
    expect(albums[0]?.tags).toEqual([])

    // Touching an album floats it up.
    await new Promise((resolve) => setTimeout(resolve, 5))
    await updateAlbum(db, first.id, { name: 'First touched' }, R2_ENV)
    const reordered = await listAlbums(db)
    expect(reordered.map((album) => album.name)).toEqual([
      'First touched',
      'Second',
    ])
  })

  it('lists only the albums carrying the tag', async () => {
    const tagged = await createAlbum(db, {
      name: 'Tagged',
      googlePhotosUrl: GPHOTOS_URL,
    })
    await createAlbum(db, { name: 'Untagged', googlePhotosUrl: GPHOTOS_URL })
    await setAlbumTags(db, tagged.id, ['family'])
    const tag = (await listTags(db)).find((entry) => entry.name === 'family')
    if (!tag) throw new Error('tag not created')

    const albums = await listByTag(db, tag.id)
    expect(albums.map((album) => album.name)).toEqual(['Tagged'])
  })
})

describe('getAlbumById', () => {
  it('returns the album with tags, or null when missing', async () => {
    const album = await createAlbum(db, {
      name: 'Looked up',
      googlePhotosUrl: GPHOTOS_URL,
    })
    await setAlbumTags(db, album.id, ['b-tag', 'a-tag'])

    const found = await getAlbumById(db, album.id)
    expect(found?.name).toBe('Looked up')
    expect(found?.tags.map((tag) => tag.name)).toEqual(['a-tag', 'b-tag'])

    expect(await getAlbumById(db, 999999)).toBeNull()
  })
})

describe('deleteAlbum', () => {
  it('removes the album and its tag links', async () => {
    const album = await createAlbum(db, {
      name: 'Doomed',
      googlePhotosUrl: GPHOTOS_URL,
    })
    await setAlbumTags(db, album.id, ['family'])
    await deleteAlbum(db, album.id, R2_ENV)

    expect(await albumExists(db, album.id)).toBe(false)
    const links = await db
      .select()
      .from(photoAlbumsTagsMap)
      .where(eq(photoAlbumsTagsMap.albumId, album.id))
    expect(links).toEqual([])
  })
})

describe('R2 cleanup on cover removal/replacement', () => {
  it('deletes the cover when the album is deleted', async () => {
    const album = await createAlbum(db, {
      name: 'Doomed',
      googlePhotosUrl: GPHOTOS_URL,
      coverImageKey: 'covers/cover.jpg',
    })
    await deleteAlbum(db, album.id, R2_ENV)
    expect(deleteObject).toHaveBeenCalledExactlyOnceWith(
      R2_ENV,
      'covers/cover.jpg',
    )
  })

  it('does not call R2 when the deleted album had no cover', async () => {
    const album = await createAlbum(db, {
      name: 'No cover',
      googlePhotosUrl: GPHOTOS_URL,
    })
    await deleteAlbum(db, album.id, R2_ENV)
    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('deletes the OLD cover when it is replaced', async () => {
    const album = await createAlbum(db, {
      name: 'Cover album',
      googlePhotosUrl: GPHOTOS_URL,
      coverImageKey: 'covers/old.jpg',
    })
    await updateAlbum(db, album.id, { coverImageKey: 'covers/new.jpg' }, R2_ENV)
    expect(deleteObject).toHaveBeenCalledExactlyOnceWith(
      R2_ENV,
      'covers/old.jpg',
    )
  })

  it('deletes the OLD cover when it is explicitly cleared to null', async () => {
    const album = await createAlbum(db, {
      name: 'Cover album',
      googlePhotosUrl: GPHOTOS_URL,
      coverImageKey: 'covers/old.jpg',
    })
    await updateAlbum(db, album.id, { coverImageKey: null }, R2_ENV)
    expect(deleteObject).toHaveBeenCalledExactlyOnceWith(
      R2_ENV,
      'covers/old.jpg',
    )
  })

  it('does not call R2 when the patch never touches coverImageKey', async () => {
    const album = await createAlbum(db, {
      name: 'Cover album',
      googlePhotosUrl: GPHOTOS_URL,
      coverImageKey: 'covers/old.jpg',
    })
    await updateAlbum(db, album.id, { name: 'Renamed' }, R2_ENV)
    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('deletes the album even when R2 cleanup fails — best-effort, not a hard requirement', async () => {
    vi.mocked(deleteObject).mockRejectedValue(new Error('R2 unreachable'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const album = await createAlbum(db, {
      name: 'Doomed',
      googlePhotosUrl: GPHOTOS_URL,
      coverImageKey: 'covers/cover.jpg',
    })
    await expect(deleteAlbum(db, album.id, R2_ENV)).resolves.toBeUndefined()
    expect(await albumExists(db, album.id)).toBe(false)
    expect(consoleError).toHaveBeenCalled()

    consoleError.mockRestore()
  })

  it('updates the album even when R2 cleanup fails — best-effort, not a hard requirement', async () => {
    vi.mocked(deleteObject).mockRejectedValue(new Error('R2 unreachable'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const album = await createAlbum(db, {
      name: 'Cover album',
      googlePhotosUrl: GPHOTOS_URL,
      coverImageKey: 'covers/old.jpg',
    })
    const updated = await updateAlbum(
      db,
      album.id,
      { coverImageKey: 'covers/new.jpg' },
      R2_ENV,
    )
    expect(updated?.coverImageKey).toBe('covers/new.jpg')
    expect(consoleError).toHaveBeenCalled()

    consoleError.mockRestore()
  })
})

describe('tags: create / visibility / lookup', () => {
  it('creates a private tag with an opaque public id', async () => {
    const tag = await createTag(db, 'family')
    expect(tag.visibility).toBe('private')
    expect(tag.publicId).toMatch(/^[A-Za-z0-9_-]{21}$/)
  })

  it('returns the existing tag when the name is already taken', async () => {
    const first = await createTag(db, 'family')
    const again = await createTag(db, 'family')
    expect(again.id).toBe(first.id)
    expect(await listTags(db)).toHaveLength(1)
  })

  it('flips visibility via setTagVisibility', async () => {
    const tag = await createTag(db, 'family')
    await setTagVisibility(db, tag.id, 'public')
    expect((await getTagById(db, tag.id))?.visibility).toBe('public')
    await setTagVisibility(db, tag.id, 'private')
    expect((await getTagById(db, tag.id))?.visibility).toBe('private')
  })

  it('getTagById returns null for unknown ids', async () => {
    expect(await getTagById(db, 999999)).toBeNull()
  })
})

describe('getPublicTagByPublicId', () => {
  it('returns the tag and its albums only when the tag is public', async () => {
    const album = await createAlbum(db, {
      name: 'Shared album',
      googlePhotosUrl: GPHOTOS_URL,
      coverImageKey: 'covers/shared.jpg',
    })
    await setAlbumTags(db, album.id, ['family'])
    const tag = (await listTags(db)).find((entry) => entry.name === 'family')
    if (!tag) throw new Error('tag not created')

    // Private → unreachable via the public accessor (the leak test).
    expect(await getPublicTagByPublicId(db, tag.publicId)).toBeNull()

    await setTagVisibility(db, tag.id, 'public')
    const shared = await getPublicTagByPublicId(db, tag.publicId)
    expect(shared?.name).toBe('family')
    expect(shared?.albums.map((entry) => entry.name)).toEqual(['Shared album'])
    expect(shared?.albums[0]?.googlePhotosUrl).toBe(GPHOTOS_URL)
    expect(shared?.albums[0]?.coverImageKey).toBe('covers/shared.jpg')

    // Back to private → unreachable again.
    await setTagVisibility(db, tag.id, 'private')
    expect(await getPublicTagByPublicId(db, tag.publicId)).toBeNull()
  })

  it('returns null for unknown public ids', async () => {
    expect(await getPublicTagByPublicId(db, 'nope-nope-nope-nope-x')).toBeNull()
  })
})
