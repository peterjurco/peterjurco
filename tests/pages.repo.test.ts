import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  articleCategories,
  articles,
  articleTags,
  articleTagsMap,
  pages,
} from '../src/db/schema'
import {
  createArticle,
  createCategory,
  EMPTY_DOC,
  setVisibility as setArticleVisibility,
  setCategory,
  setTags,
} from '../src/lib/articles/repo'
import {
  createPage,
  deletePage,
  getById,
  getBySlug,
  getBySlugForOwner,
  listForOwner,
  pageExists,
  resolveArticlesForPage,
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

  it('getBySlugForOwner finds any visibility, unlike getBySlug', async () => {
    const page = await createPage(db, { slug: 'owner-preview', title: 'x' })
    expect((await getBySlugForOwner(db, 'owner-preview'))?.id).toBe(page.id)
    expect(await getBySlug(db, 'owner-preview')).toBeNull()
    expect(await getBySlugForOwner(db, 'no-such-slug')).toBeNull()
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

  it('updates the tile display flags independently, defaulting to false', async () => {
    const page = await createPage(db, { slug: 'display', title: 'x' })
    expect(page.showTags).toBe(false)
    expect(page.showCreatedDate).toBe(false)
    expect(page.showUpdatedDate).toBe(false)

    const withTags = await updatePage(db, page.id, { showTags: true })
    expect(withTags?.showTags).toBe(true)
    expect(withTags?.showCreatedDate).toBe(false)

    const withDates = await updatePage(db, page.id, {
      showCreatedDate: true,
      showUpdatedDate: true,
    })
    expect(withDates?.showTags).toBe(true)
    expect(withDates?.showCreatedDate).toBe(true)
    expect(withDates?.showUpdatedDate).toBe(true)
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

    // 1. Set tagId first, so the next step has something to clear.
    await setAutoFilter(db, page.id, { tagId: tag.id })
    let updated = await getById(db, page.id)
    expect(updated?.tagId).toBe(tag.id)
    expect(updated?.categoryId).toBeNull()

    // 2. Setting categoryId must clear the tagId that's actually there —
    // this is the direction a dropped `tagId: null` in that branch would miss.
    await setAutoFilter(db, page.id, { categoryId: category.id })
    updated = await getById(db, page.id)
    expect(updated?.categoryId).toBe(category.id)
    expect(updated?.tagId).toBeNull()

    // 3. Clearing both explicitly.
    await setAutoFilter(db, page.id, { categoryId: null, tagId: null })
    updated = await getById(db, page.id)
    expect(updated?.categoryId).toBeNull()
    expect(updated?.tagId).toBeNull()
  })
})

describe('resolveArticlesForPage', () => {
  beforeEach(async () => {
    await db.delete(articleTagsMap)
    await db.delete(articles)
    await db.delete(articleTags)
    await db.delete(articleCategories)
  })

  async function makeArticle(overrides: {
    title: string
    featuredPhotoKey?: string | null
    content?: Record<string, unknown>
    /** Defaults to 'private' (matching createArticle's own default) —
     * callers that need a tile to actually render must opt in explicitly. */
    visibility?: 'private' | 'public'
  }) {
    const article = await createArticle(db)
    await db
      .update(articles)
      .set({
        title: overrides.title,
        featuredPhotoKey: overrides.featuredPhotoKey ?? null,
        content: overrides.content ?? EMPTY_DOC,
      })
      .where(eq(articles.id, article.id))
    if (overrides.visibility === 'public') {
      await setArticleVisibility(db, article.id, 'public')
    }
    return article.id
  }

  it('manual mode: returns articles in stored order, skipping a stale id', async () => {
    const a = await makeArticle({ title: 'A', visibility: 'public' })
    const b = await makeArticle({ title: 'B', visibility: 'public' })
    const page = await createPage(db, { slug: 'p', title: 'x' })
    await setArticleIds(db, page.id, [b, 999999, a])

    const tiles = await resolveArticlesForPage(
      db,
      (await getById(db, page.id))!,
    )
    expect(tiles.map((tile) => tile.title)).toEqual(['B', 'A'])
  })

  it('manual mode: skips an article that has since been made private', async () => {
    const publicOne = await makeArticle({
      title: 'Public',
      visibility: 'public',
    })
    // Private is makeArticle's default — matches createArticle's own default
    // and what an article looks like if it's since been un-published.
    const privateOne = await makeArticle({ title: 'Private' })
    const page = await createPage(db, { slug: 'p', title: 'x' })
    await setArticleIds(db, page.id, [privateOne, publicOne])

    const tiles = await resolveArticlesForPage(
      db,
      (await getById(db, page.id))!,
    )
    expect(tiles.map((tile) => tile.title)).toEqual(['Public'])
  })

  it('manual mode: includePrivate includes a private article too', async () => {
    const publicOne = await makeArticle({
      title: 'Public',
      visibility: 'public',
    })
    const privateOne = await makeArticle({ title: 'Private' })
    const page = await createPage(db, { slug: 'p', title: 'x' })
    await setArticleIds(db, page.id, [privateOne, publicOne])

    const tiles = await resolveArticlesForPage(
      db,
      (await getById(db, page.id))!,
      { includePrivate: true },
    )
    expect(tiles.map((tile) => tile.title)).toEqual(['Private', 'Public'])
  })

  it('manual mode: resolves image from featuredPhotoKey first', async () => {
    const a = await makeArticle({
      title: 'A',
      featuredPhotoKey: 'covers/a.jpg',
      visibility: 'public',
    })
    const page = await createPage(db, { slug: 'p', title: 'x' })
    await setArticleIds(db, page.id, [a])

    const tiles = await resolveArticlesForPage(
      db,
      (await getById(db, page.id))!,
    )
    expect(tiles[0]?.imageKey).toBe('covers/a.jpg')
  })

  it('manual mode: falls back to the first body image, then null', async () => {
    const withBodyImage = await makeArticle({
      title: 'Body image',
      visibility: 'public',
      content: {
        type: 'doc',
        content: [
          {
            type: 'image',
            attrs: { src: 'https://media.test.local/articles/one.png' },
          },
        ],
      },
    })
    const withNoImage = await makeArticle({
      title: 'No image',
      visibility: 'public',
    })
    const page = await createPage(db, { slug: 'p', title: 'x' })
    await setArticleIds(db, page.id, [withBodyImage, withNoImage])

    process.env.PUBLIC_R2_PUBLIC_BASE_URL = 'https://media.test.local'
    process.env.PUBLIC_IMAGE_TRANSFORMS = 'off'
    const tiles = await resolveArticlesForPage(
      db,
      (await getById(db, page.id))!,
    )
    expect(tiles[0]?.imageKey).toBe('articles/one.png')
    expect(tiles[1]?.imageKey).toBeNull()
  })

  it('auto mode by category: only public articles in that category, sorted', async () => {
    const category = await createCategory(db, 'Travel')
    const pub1 = await makeArticle({ title: 'Older' })
    await setCategory(db, pub1, category.id)
    await setArticleVisibility(db, pub1, 'public')
    await new Promise((resolve) => setTimeout(resolve, 5))
    const pub2 = await makeArticle({ title: 'Newer' })
    await setCategory(db, pub2, category.id)
    await setArticleVisibility(db, pub2, 'public')
    const privateInCategory = await makeArticle({ title: 'Private' })
    await setCategory(db, privateInCategory, category.id)
    const otherCategoryArticle = await makeArticle({ title: 'Other' })
    await setArticleVisibility(db, otherCategoryArticle, 'public')

    const page = await createPage(db, { slug: 'p', title: 'x' })
    await setMode(db, page.id, 'auto')
    await setAutoFilter(db, page.id, { categoryId: category.id })

    const tiles = await resolveArticlesForPage(
      db,
      (await getById(db, page.id))!,
    )
    expect(tiles.map((tile) => tile.title)).toEqual(['Newer', 'Older'])

    const previewTiles = await resolveArticlesForPage(
      db,
      (await getById(db, page.id))!,
      { includePrivate: true },
    )
    expect(previewTiles.map((tile) => tile.title)).toEqual(
      expect.arrayContaining(['Newer', 'Older', 'Private']),
    )
  })

  it('auto mode by tag, sorted title_asc', async () => {
    const tagged1 = await makeArticle({ title: 'Zebra' })
    await setTags(db, tagged1, ['japan'])
    await setArticleVisibility(db, tagged1, 'public')
    const tagged2 = await makeArticle({ title: 'Alpha' })
    await setTags(db, tagged2, ['japan'])
    await setArticleVisibility(db, tagged2, 'public')
    const untagged = await makeArticle({ title: 'Untagged' })
    await setArticleVisibility(db, untagged, 'public')

    const [japanTag] = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.name, 'japan'))
    if (!japanTag) throw new Error('tag not found')

    const page = await createPage(db, { slug: 'p', title: 'x' })
    await setMode(db, page.id, 'auto')
    await setAutoFilter(db, page.id, { tagId: japanTag.id })
    await setSortKey(db, page.id, 'title_asc')

    const tiles = await resolveArticlesForPage(
      db,
      (await getById(db, page.id))!,
    )
    expect(tiles.map((tile) => tile.title)).toEqual(['Alpha', 'Zebra'])
  })

  it('auto mode with neither categoryId nor tagId set returns an empty list', async () => {
    const page = await createPage(db, { slug: 'p', title: 'x' })
    await setMode(db, page.id, 'auto')
    const tiles = await resolveArticlesForPage(
      db,
      (await getById(db, page.id))!,
    )
    expect(tiles).toEqual([])
  })

  it('always includes createdAt/updatedAt on every tile, regardless of showTags/showCreatedDate/showUpdatedDate', async () => {
    const a = await makeArticle({ title: 'A', visibility: 'public' })
    const page = await createPage(db, { slug: 'p', title: 'x' })
    await setArticleIds(db, page.id, [a])

    const tiles = await resolveArticlesForPage(
      db,
      (await getById(db, page.id))!,
    )
    expect(tiles[0]?.createdAt).toBeInstanceOf(Date)
    expect(tiles[0]?.updatedAt).toBeInstanceOf(Date)
  })

  it('manual mode: includes tags only when showTags is on', async () => {
    const a = await makeArticle({ title: 'A', visibility: 'public' })
    await setTags(db, a, ['travel', 'japan'])
    const page = await createPage(db, { slug: 'p', title: 'x' })
    await setArticleIds(db, page.id, [a])

    const withoutTags = await resolveArticlesForPage(
      db,
      (await getById(db, page.id))!,
    )
    expect(withoutTags[0]?.tags).toEqual([])

    await updatePage(db, page.id, { showTags: true })
    const withTags = await resolveArticlesForPage(
      db,
      (await getById(db, page.id))!,
    )
    expect(withTags[0]?.tags.sort()).toEqual(['japan', 'travel'])
  })

  it('auto mode: includes tags only when showTags is on', async () => {
    const category = await createCategory(db, 'Films')
    const a = await makeArticle({ title: 'A', visibility: 'public' })
    await setCategory(db, a, category.id)
    await setTags(db, a, ['scifi'])
    const page = await createPage(db, { slug: 'p', title: 'x' })
    await setMode(db, page.id, 'auto')
    await setAutoFilter(db, page.id, { categoryId: category.id })
    await updatePage(db, page.id, { showTags: true })

    const tiles = await resolveArticlesForPage(
      db,
      (await getById(db, page.id))!,
    )
    expect(tiles[0]?.tags).toEqual(['scifi'])
  })
})
