import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  readLinkPosts,
  runLinksToAlbums,
} from '../../scripts/migrate-wp/links-to-albums'
import {
  articleCategories,
  articles,
  articleTags,
  articleTagsMap,
  photoAlbums,
  photoAlbumsTagsMap,
} from '../../src/db/schema'
import {
  createMigratedArticle,
  getByLegacyWpId,
} from '../../src/lib/articles/repo'
import { createTestDb } from '../helpers/test-db'
import {
  createTestWpConnection,
  insertWpPost,
  resetWpSchema,
  setWpLinksTo,
} from '../helpers/test-wp-db'

/**
 * Exercises the link-format-post → photo-album conversion end-to-end
 * against a real disposable MySQL double (WP) and real Postgres (test DB).
 */

const wpConn = createTestWpConnection()
const { db, close } = createTestDb()

async function resetPostgres(): Promise<void> {
  await db.delete(photoAlbumsTagsMap)
  await db.delete(photoAlbums)
  await db.delete(articleTagsMap)
  await db.delete(articles)
  await db.delete(articleTags)
  await db.delete(articleCategories)
}

/** Seeds a migrated article the same shape import.ts would have created. */
async function seedMigratedArticle(
  legacyWpId: number,
  fields: { title: string; featuredPhotoKey?: string | null } = {
    title: 'placeholder',
  },
): Promise<void> {
  await createMigratedArticle(db as never, legacyWpId, {
    title: fields.title,
    content: { type: 'doc', content: [] } as never,
    visibility: 'private',
    featuredPhotoKey: fields.featuredPhotoKey ?? null,
    categoryId: null,
    createdAt: new Date('2020-01-01T00:00:00Z'),
    updatedAt: new Date('2020-01-01T00:00:00Z'),
  })
}

beforeEach(async () => {
  await resetWpSchema(wpConn)
  await resetPostgres()
})

afterAll(async () => {
  await wpConn.end()
  await close()
})

describe('readLinkPosts', () => {
  it('reads posts with _links_to postmeta, ignoring posts without it', async () => {
    await insertWpPost(wpConn, {
      id: 1,
      title: 'Kriváň',
      content: '',
      status: 'publish',
    })
    await setWpLinksTo(wpConn, 1, 'https://photos.app.goo.gl/abc123')
    await insertWpPost(wpConn, {
      id: 2,
      title: 'A normal article',
      content: '<p>Real text</p>',
      status: 'publish',
    })

    const posts = await readLinkPosts(wpConn)
    expect(posts).toEqual([
      { wpId: 1, title: 'Kriváň', linksTo: 'https://photos.app.goo.gl/abc123' },
    ])
  })
})

describe('runLinksToAlbums — dry-run', () => {
  it('reports would-convert and makes zero writes', async () => {
    await insertWpPost(wpConn, {
      id: 1,
      title: 'Kriváň',
      content: '',
      status: 'publish',
    })
    await setWpLinksTo(wpConn, 1, 'https://photos.app.goo.gl/abc123')
    await seedMigratedArticle(1, { title: 'Kriváň' })

    const results = await runLinksToAlbums({
      wpConn,
      db: db as never,
      apply: false,
    })

    expect(results).toEqual([
      {
        wpId: 1,
        title: 'Kriváň',
        linksTo: 'https://photos.app.goo.gl/abc123',
        status: 'would-convert',
      },
    ])
    expect(await db.select().from(photoAlbums)).toHaveLength(0)
    expect(await getByLegacyWpId(db as never, 1)).not.toBeNull()
  })
})

describe('runLinksToAlbums — apply', () => {
  it('creates an album reusing the article cover, then deletes the article', async () => {
    await insertWpPost(wpConn, {
      id: 1,
      title: 'Kriváň',
      content: '',
      status: 'publish',
    })
    await setWpLinksTo(wpConn, 1, 'https://photos.app.goo.gl/abc123')
    await seedMigratedArticle(1, {
      title: 'Kriváň',
      featuredPhotoKey: 'articles/already-rehosted.jpg',
    })

    const results = await runLinksToAlbums({
      wpConn,
      db: db as never,
      apply: true,
    })

    expect(results[0]?.status).toBe('converted')
    const [album] = await db.select().from(photoAlbums)
    expect(album?.name).toBe('Kriváň')
    expect(album?.googlePhotosUrl).toBe('https://photos.app.goo.gl/abc123')
    expect(album?.coverImageKey).toBe('articles/already-rehosted.jpg')
    expect(await getByLegacyWpId(db as never, 1)).toBeNull()
  })

  it('is idempotent — a second run skips the already-converted post', async () => {
    await insertWpPost(wpConn, {
      id: 1,
      title: 'Kriváň',
      content: '',
      status: 'publish',
    })
    await setWpLinksTo(wpConn, 1, 'https://photos.app.goo.gl/abc123')
    await seedMigratedArticle(1, { title: 'Kriváň' })

    await runLinksToAlbums({ wpConn, db: db as never, apply: true })
    const secondRun = await runLinksToAlbums({
      wpConn,
      db: db as never,
      apply: true,
    })

    expect(secondRun[0]?.status).toBe('skipped-no-article')
    expect(await db.select().from(photoAlbums)).toHaveLength(1)
  })

  it('skips posts whose _links_to is not a Google Photos URL, leaving the article alone', async () => {
    await insertWpPost(wpConn, {
      id: 1,
      title: 'Some other link post',
      content: '',
      status: 'publish',
    })
    await setWpLinksTo(wpConn, 1, 'https://example.com/not-photos')
    await seedMigratedArticle(1, { title: 'Some other link post' })

    const results = await runLinksToAlbums({
      wpConn,
      db: db as never,
      apply: true,
    })

    expect(results[0]?.status).toBe('skipped-not-google-photos')
    expect(await db.select().from(photoAlbums)).toHaveLength(0)
    expect(await getByLegacyWpId(db as never, 1)).not.toBeNull()
  })

  it('skips when no migrated article exists for the post yet', async () => {
    await insertWpPost(wpConn, {
      id: 1,
      title: 'Not migrated yet',
      content: '',
      status: 'publish',
    })
    await setWpLinksTo(wpConn, 1, 'https://photos.app.goo.gl/abc123')

    const results = await runLinksToAlbums({
      wpConn,
      db: db as never,
      apply: true,
    })

    expect(results[0]?.status).toBe('skipped-no-article')
    expect(await db.select().from(photoAlbums)).toHaveLength(0)
  })
})
