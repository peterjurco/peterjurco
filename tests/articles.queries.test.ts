import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  articleCategories,
  articles,
  articleTags,
  articleTagsMap,
} from '../src/db/schema'
import {
  getCategoryById,
  getTagById,
  listByCategory,
  listByTag,
  listFeatured,
  listRecent,
} from '../src/lib/articles/queries'
import {
  createArticle,
  createCategory,
  setCategory,
  setFeatured,
  setTags,
  setVisibility,
  updateArticle,
} from '../src/lib/articles/repo'
import { createTestDb } from './helpers/test-db'

const { db, close } = createTestDb()

beforeEach(async () => {
  // FK order: join rows → articles → taxonomy.
  await db.delete(articleTagsMap)
  await db.delete(articles)
  await db.delete(articleTags)
  await db.delete(articleCategories)
})

afterAll(async () => {
  await close()
})

/** updated_at is millisecond-resolution — force distinct timestamps. */
async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5))
}

async function createTitled(title: string) {
  const article = await createArticle(db)
  await updateArticle(db, article.id, { title })
  return article
}

describe('listByCategory', () => {
  it('returns only that category, both visibilities, newest-updated first', async () => {
    const category = await createCategory(db, 'Essays')
    const other = await createCategory(db, 'Travel')

    const older = await createTitled('older')
    await setCategory(db, older.id, category.id)
    await setVisibility(db, older.id, 'public')
    await tick()
    const newer = await createTitled('newer')
    await setCategory(db, newer.id, category.id)
    const elsewhere = await createTitled('elsewhere')
    await setCategory(db, elsewhere.id, other.id)
    await createTitled('uncategorized')

    const list = await listByCategory(db, category.id)
    expect(list.map((article) => article.id)).toEqual([newer.id, older.id])
    expect(list.map((article) => article.visibility).sort()).toEqual([
      'private',
      'public',
    ])
  })

  it('returns an empty list for a category with no articles', async () => {
    const category = await createCategory(db, 'Empty')
    expect(await listByCategory(db, category.id)).toEqual([])
  })
})

describe('listByTag', () => {
  it('returns only articles carrying the tag, newest-updated first', async () => {
    const older = await createTitled('older')
    await setTags(db, older.id, ['shared'])
    await setVisibility(db, older.id, 'public')
    await tick()
    const newer = await createTitled('newer')
    await setTags(db, newer.id, ['shared', 'extra'])
    const unrelated = await createTitled('unrelated')
    await setTags(db, unrelated.id, ['other'])

    const [tag] = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.name, 'shared'))
    if (!tag) throw new Error('tag not created')

    const list = await listByTag(db, tag.id)
    expect(list.map((article) => article.id)).toEqual([newer.id, older.id])
    expect(list.map((article) => article.visibility).sort()).toEqual([
      'private',
      'public',
    ])
  })

  it('returns an empty list for an unknown tag id', async () => {
    expect(await listByTag(db, 999_999)).toEqual([])
  })
})

describe('listRecent', () => {
  it('returns the latest N by updated_at descending', async () => {
    const first = await createTitled('first')
    await tick()
    const second = await createTitled('second')
    await tick()
    const third = await createTitled('third')

    const list = await listRecent(db, 2)
    expect(list.map((article) => article.id)).toEqual([third.id, second.id])
    expect(list.map((article) => article.id)).not.toContain(first.id)
  })

  it('floats a just-edited old article to the top', async () => {
    const edited = await createTitled('edited later')
    await tick()
    await createTitled('created later')
    await tick()
    await updateArticle(db, edited.id, { title: 'edited last' })

    const [top] = await listRecent(db, 10)
    expect(top?.id).toBe(edited.id)
  })
})

describe('listFeatured', () => {
  it('returns only featured articles ordered by featured_position ascending', async () => {
    const second = await createTitled('second')
    await setFeatured(db, second.id, true)
    const first = await createTitled('first')
    await setFeatured(db, first.id, true)
    await createTitled('not featured')

    await db
      .update(articles)
      .set({ featuredPosition: 1 })
      .where(eq(articles.id, second.id))
    await db
      .update(articles)
      .set({ featuredPosition: 0 })
      .where(eq(articles.id, first.id))

    const list = await listFeatured(db)
    expect(list.map((article) => article.id)).toEqual([first.id, second.id])
  })

  it('sorts newly-featured articles (null position) after positioned ones', async () => {
    const positioned = await createTitled('positioned')
    await setFeatured(db, positioned.id, true)
    await db
      .update(articles)
      .set({ featuredPosition: 0 })
      .where(eq(articles.id, positioned.id))
    const unpositioned = await createTitled('unpositioned')
    await setFeatured(db, unpositioned.id, true)

    const list = await listFeatured(db)
    expect(list.map((article) => article.id)).toEqual([
      positioned.id,
      unpositioned.id,
    ])
  })
})

describe('getCategoryById / getTagById', () => {
  it('returns the row when it exists, null otherwise', async () => {
    const category = await createCategory(db, 'Essays')
    expect((await getCategoryById(db, category.id))?.name).toBe('Essays')
    expect(await getCategoryById(db, 999_999)).toBeNull()

    const article = await createArticle(db)
    await setTags(db, article.id, ['travel'])
    const [tag] = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.name, 'travel'))
    if (!tag) throw new Error('tag not created')
    expect((await getTagById(db, tag.id))?.name).toBe('travel')
    expect(await getTagById(db, 999_999)).toBeNull()
  })
})
