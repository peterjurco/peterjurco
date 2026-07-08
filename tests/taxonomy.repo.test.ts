import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  articleCategories,
  articles,
  articleTags,
  articleTagsMap,
  photoAlbums,
  photoAlbumsTagsMap,
  photoTags,
} from '../src/db/schema'
import { createCategory } from '../src/lib/articles/repo'
import { createAlbum, getTagById, setAlbumTags } from '../src/lib/photos/repo'
import {
  articleCategoryExists,
  articleTagExists,
  createArticleTag,
  deleteArticleCategory,
  deleteArticleTag,
  deletePhotoTag,
  renameArticleCategory,
  renameArticleTag,
  renamePhotoTag,
} from '../src/lib/taxonomy/repo'
import { createTestDb } from './helpers/test-db'

const { db, close } = createTestDb()

beforeEach(async () => {
  // FK order: join rows → articles/albums → categories/tags.
  await db.delete(articleTagsMap)
  await db.delete(articles)
  await db.delete(articleTags)
  await db.delete(articleCategories)
  await db.delete(photoAlbumsTagsMap)
  await db.delete(photoAlbums)
  await db.delete(photoTags)
})

afterAll(async () => {
  await close()
})

describe('article categories', () => {
  it('renames a category', async () => {
    const category = await createCategory(db, 'Essays')
    const renamed = await renameArticleCategory(db, category.id, 'Long-form')
    expect(renamed?.name).toBe('Long-form')
  })

  it('returns null renaming an unknown category', async () => {
    expect(await renameArticleCategory(db, 999999, 'ghost')).toBeNull()
  })

  it('deletes a category and detaches (sets null) its articles, which survive', async () => {
    const category = await createCategory(db, 'Doomed category')
    const [article] = await db
      .insert(articles)
      .values({
        publicId: 'taxonomy-repo-test-article-1',
        title: 'Categorized',
        content: { type: 'doc', content: [] },
        categoryId: category.id,
      })
      .returning()
    if (!article) throw new Error('failed to insert test article')

    await deleteArticleCategory(db, category.id)

    expect(await articleCategoryExists(db, category.id)).toBe(false)
    const [reloaded] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, article.id))
    expect(reloaded).toBeDefined()
    expect(reloaded?.categoryId).toBeNull()
    expect(reloaded?.title).toBe('Categorized')
  })

  it('articleCategoryExists is false for unknown ids', async () => {
    expect(await articleCategoryExists(db, 999999)).toBe(false)
  })
})

describe('article tags', () => {
  it('creates a tag, or returns the existing one on a duplicate name', async () => {
    const first = await createArticleTag(db, 'hiking')
    const again = await createArticleTag(db, 'hiking')
    expect(again.id).toBe(first.id)
  })

  it('renames a tag', async () => {
    const tag = await createArticleTag(db, 'old-name')
    const renamed = await renameArticleTag(db, tag.id, 'new-name')
    expect(renamed?.name).toBe('new-name')
  })

  it('returns null renaming an unknown tag', async () => {
    expect(await renameArticleTag(db, 999999, 'ghost')).toBeNull()
  })

  it('deletes a tag, removing its join rows, without deleting the tagged article', async () => {
    const tag = await createArticleTag(db, 'doomed-tag')
    const [article] = await db
      .insert(articles)
      .values({
        publicId: 'taxonomy-repo-test-article-2',
        title: 'Tagged',
        content: { type: 'doc', content: [] },
      })
      .returning()
    if (!article) throw new Error('failed to insert test article')
    await db
      .insert(articleTagsMap)
      .values({ articleId: article.id, tagId: tag.id })

    await deleteArticleTag(db, tag.id)

    expect(await articleTagExists(db, tag.id)).toBe(false)
    const links = await db
      .select()
      .from(articleTagsMap)
      .where(eq(articleTagsMap.tagId, tag.id))
    expect(links).toEqual([])
    const [reloaded] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, article.id))
    expect(reloaded).toBeDefined()
    expect(reloaded?.title).toBe('Tagged')
  })

  it('articleTagExists is false for unknown ids', async () => {
    expect(await articleTagExists(db, 999999)).toBe(false)
  })
})

describe('photo tags', () => {
  it('renames a tag, keeping its visibility and public id', async () => {
    const album = await createAlbum(db, {
      name: 'Renaming',
      googlePhotosUrl: 'https://photos.app.goo.gl/RenameTest',
    })
    await setAlbumTags(db, album.id, ['before'])
    const tag = (await db.select().from(photoTags)).find(
      (row) => row.name === 'before',
    )
    if (!tag) throw new Error('tag not created')

    const renamed = await renamePhotoTag(db, tag.id, 'after')
    expect(renamed?.name).toBe('after')
    expect(renamed?.publicId).toBe(tag.publicId)
    expect(renamed?.visibility).toBe(tag.visibility)
  })

  it('returns null renaming an unknown tag', async () => {
    expect(await renamePhotoTag(db, 999999, 'ghost')).toBeNull()
  })

  it('deletes a tag, removing its album links, without deleting the album', async () => {
    const album = await createAlbum(db, {
      name: 'Keeps album',
      googlePhotosUrl: 'https://photos.app.goo.gl/KeepAlbum',
    })
    await setAlbumTags(db, album.id, ['doomed-photo-tag'])
    const tag = (await db.select().from(photoTags)).find(
      (row) => row.name === 'doomed-photo-tag',
    )
    if (!tag) throw new Error('tag not created')

    await deletePhotoTag(db, tag.id)

    expect(await getTagById(db, tag.id)).toBeNull()
    const links = await db
      .select()
      .from(photoAlbumsTagsMap)
      .where(eq(photoAlbumsTagsMap.tagId, tag.id))
    expect(links).toEqual([])
    const [reloadedAlbum] = await db
      .select()
      .from(photoAlbums)
      .where(eq(photoAlbums.id, album.id))
    expect(reloadedAlbum).toBeDefined()
    expect(reloadedAlbum?.name).toBe('Keeps album')
  })

  it('deleting a PUBLIC tag also works (admin UI warns before calling this)', async () => {
    const album = await createAlbum(db, {
      name: 'Public tag album',
      googlePhotosUrl: 'https://photos.app.goo.gl/PublicTag',
    })
    await setAlbumTags(db, album.id, ['public-doomed'])
    const tag = (await db.select().from(photoTags)).find(
      (row) => row.name === 'public-doomed',
    )
    if (!tag) throw new Error('tag not created')
    await db
      .update(photoTags)
      .set({ visibility: 'public' })
      .where(eq(photoTags.id, tag.id))

    await deletePhotoTag(db, tag.id)

    expect(await getTagById(db, tag.id)).toBeNull()
  })
})
