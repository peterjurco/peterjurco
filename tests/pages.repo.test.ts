import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { articleCategories, articleTags, pages } from '../src/db/schema'
import {
  createPage,
  deletePage,
  getById,
  getBySlug,
  listForOwner,
  pageExists,
  SlugTakenError,
  setArticleIds,
  setAutoFilter,
  setMode,
  setSortKey,
  setVisibility,
  updatePage,
} from '../src/lib/pages/repo'
import { createTestDb } from './helpers/test-db'

const { db, close } = createTestDb()

beforeEach(async () => {
  await db.delete(pages)
})

afterAll(async () => {
  await close()
})

describe('createPage', () => {
  it('creates a private, manual-mode page with defaults', async () => {
    const page = await createPage(db, { slug: 'travel', title: 'Travel' })
    expect(page.slug).toBe('travel')
    expect(page.title).toBe('Travel')
    expect(page.visibility).toBe('private')
    expect(page.mode).toBe('manual')
    expect(page.articleIds).toEqual([])
    expect(page.categoryId).toBeNull()
    expect(page.tagId).toBeNull()
    expect(page.sortKey).toBe('created_desc')
  })

  it('throws SlugTakenError on a duplicate slug', async () => {
    await createPage(db, { slug: 'travel', title: 'Travel' })
    await expect(
      createPage(db, { slug: 'travel', title: 'Travel again' }),
    ).rejects.toThrow(SlugTakenError)
  })
})

describe('getById / getBySlug / pageExists', () => {
  it('getById finds any visibility; getBySlug only public ones', async () => {
    const page = await createPage(db, { slug: 'private-one', title: 'x' })
    expect((await getById(db, page.id))?.slug).toBe('private-one')
    expect(await getBySlug(db, 'private-one')).toBeNull()

    await db
      .update(pages)
      .set({ visibility: 'public' })
      .where(eq(pages.id, page.id))
    expect((await getBySlug(db, 'private-one'))?.id).toBe(page.id)
  })

  it('returns null / false for an unknown id', async () => {
    expect(await getById(db, 999999)).toBeNull()
    expect(await pageExists(db, 999999)).toBe(false)
  })
})

describe('listForOwner', () => {
  it('lists every page regardless of visibility, newest-updated first', async () => {
    const first = await createPage(db, { slug: 'first', title: 'First' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await createPage(db, { slug: 'second', title: 'Second' })
    const list = await listForOwner(db)
    expect(list.map((page) => page.id)).toEqual([second.id, first.id])
  })
})

describe('deletePage', () => {
  it('removes the row', async () => {
    const page = await createPage(db, { slug: 'doomed', title: 'x' })
    await deletePage(db, page.id)
    expect(await getById(db, page.id)).toBeNull()
  })
})

describe('updatePage', () => {
  it('updates slug and/or title', async () => {
    const page = await createPage(db, { slug: 'old-slug', title: 'Old' })
    const updated = await updatePage(db, page.id, {
      slug: 'new-slug',
      title: 'New',
    })
    expect(updated?.slug).toBe('new-slug')
    expect(updated?.title).toBe('New')
  })

  it('returns null for an unknown id', async () => {
    expect(await updatePage(db, 999999, { title: 'x' })).toBeNull()
  })

  it('throws SlugTakenError when renaming into a slug another page already owns', async () => {
    await createPage(db, { slug: 'taken', title: 'x' })
    const page = await createPage(db, { slug: 'free', title: 'y' })
    await expect(updatePage(db, page.id, { slug: 'taken' })).rejects.toThrow(
      SlugTakenError,
    )
  })
})

describe('setVisibility / setMode / setSortKey', () => {
  it('each updates its own column', async () => {
    const page = await createPage(db, { slug: 'p', title: 'x' })
    await setVisibility(db, page.id, 'public')
    await setMode(db, page.id, 'auto')
    await setSortKey(db, page.id, 'title_asc')
    const updated = await getById(db, page.id)
    expect(updated?.visibility).toBe('public')
    expect(updated?.mode).toBe('auto')
    expect(updated?.sortKey).toBe('title_asc')
  })
})

describe('setArticleIds', () => {
  it('replaces the ordered list', async () => {
    const page = await createPage(db, { slug: 'p', title: 'x' })
    await setArticleIds(db, page.id, [3, 1, 2])
    expect((await getById(db, page.id))?.articleIds).toEqual([3, 1, 2])
  })
})

describe('setAutoFilter', () => {
  it('setting a category clears any existing tag, and vice versa', async () => {
    // categoryId/tagId are real FKs (article_categories/article_tags), so
    // exercise this with rows that actually exist rather than arbitrary ids.
    // article_tags.name is unique and this DB isn't reset between test runs,
    // so the name must be unique per run.
    const unique = crypto.randomUUID()
    const [category] = await db
      .insert(articleCategories)
      .values({ name: `setAutoFilter-category-${unique}` })
      .returning()
    const [tag] = await db
      .insert(articleTags)
      .values({ name: `setAutoFilter-tag-${unique}` })
      .returning()
    if (!category || !tag) throw new Error('fixture insert returned no row')

    const page = await createPage(db, { slug: 'p', title: 'x' })
    await setAutoFilter(db, page.id, { categoryId: category.id })
    let updated = await getById(db, page.id)
    expect(updated?.categoryId).toBe(category.id)
    expect(updated?.tagId).toBeNull()

    await setAutoFilter(db, page.id, { tagId: tag.id })
    updated = await getById(db, page.id)
    expect(updated?.categoryId).toBeNull()
    expect(updated?.tagId).toBe(tag.id)

    await setAutoFilter(db, page.id, { categoryId: null, tagId: null })
    updated = await getById(db, page.id)
    expect(updated?.categoryId).toBeNull()
    expect(updated?.tagId).toBeNull()
  })
})
