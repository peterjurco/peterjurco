import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  articleCategories,
  articles,
  articleTags,
  articleTagsMap,
} from '../src/db/schema'
import { listFeatured } from '../src/lib/articles/queries'
import {
  createArticle,
  createCategory,
  deleteArticle,
  EMPTY_DOC,
  getById,
  getByPublicId,
  listCategories,
  listForOwner,
  listTags,
  reorderFeatured,
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

describe('createArticle', () => {
  it('inserts a private, empty article with an opaque public id', async () => {
    const article = await createArticle(db)
    expect(article.publicId).toMatch(/^[A-Za-z0-9_-]{21}$/)
    expect(article.visibility).toBe('private')
    expect(article.title).toBe('')
    expect(article.content).toEqual(EMPTY_DOC)
    expect(article.isFeatured).toBe(false)
  })

  it('generates a distinct public id per article', async () => {
    const first = await createArticle(db)
    const second = await createArticle(db)
    expect(first.publicId).not.toBe(second.publicId)
  })
})

describe('updateArticle', () => {
  it('changes title/content and bumps updated_at', async () => {
    const article = await createArticle(db)
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      ],
    }
    // updated_at is millisecond-resolution — make sure the clock moved on.
    await new Promise((resolve) => setTimeout(resolve, 5))
    const updated = await updateArticle(db, article.id, {
      title: 'Hello',
      content,
    })
    expect(updated?.title).toBe('Hello')
    expect(updated?.content).toEqual(content)
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(
      article.updatedAt.getTime(),
    )
  })

  it('updates title alone without touching content', async () => {
    const article = await createArticle(db)
    const updated = await updateArticle(db, article.id, { title: 'Only title' })
    expect(updated?.title).toBe('Only title')
    expect(updated?.content).toEqual(EMPTY_DOC)
  })

  it('returns null for an unknown article', async () => {
    expect(await updateArticle(db, 999_999, { title: 'x' })).toBeNull()
  })
})

describe('setVisibility', () => {
  it('flips private → public → private', async () => {
    const article = await createArticle(db)
    await setVisibility(db, article.id, 'public')
    expect((await getById(db, article.id))?.visibility).toBe('public')
    await setVisibility(db, article.id, 'private')
    expect((await getById(db, article.id))?.visibility).toBe('private')
  })
})

describe('setFeatured', () => {
  it('toggles the featured flag', async () => {
    const article = await createArticle(db)
    await setFeatured(db, article.id, true)
    expect((await getById(db, article.id))?.isFeatured).toBe(true)
    await setFeatured(db, article.id, false)
    expect((await getById(db, article.id))?.isFeatured).toBe(false)
  })
})

describe('reorderFeatured', () => {
  async function createTitled(title: string) {
    const article = await createArticle(db)
    await updateArticle(db, article.id, { title })
    return article
  }

  it('writes positions from array index; listFeatured follows the new order', async () => {
    const a = await createTitled('a')
    const b = await createTitled('b')
    const c = await createTitled('c')
    for (const article of [a, b, c]) {
      await setFeatured(db, article.id, true)
    }

    await reorderFeatured(db, [b.id, c.id, a.id])
    expect((await listFeatured(db)).map((article) => article.id)).toEqual([
      b.id,
      c.id,
      a.id,
    ])

    await reorderFeatured(db, [a.id, b.id, c.id])
    expect((await listFeatured(db)).map((article) => article.id)).toEqual([
      a.id,
      b.id,
      c.id,
    ])
  })

  it('ignores non-featured and unknown ids', async () => {
    const featured = await createTitled('featured')
    await setFeatured(db, featured.id, true)
    const plain = await createTitled('plain')

    await reorderFeatured(db, [plain.id, 999_999, featured.id])

    expect((await listFeatured(db)).map((article) => article.id)).toEqual([
      featured.id,
    ])
    const [plainRow] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, plain.id))
    expect(plainRow?.featuredPosition).toBeNull()
  })
})

describe('getByPublicId', () => {
  it('returns public articles', async () => {
    const article = await createArticle(db)
    await updateArticle(db, article.id, { title: 'Shared' })
    await setVisibility(db, article.id, 'public')
    const found = await getByPublicId(db, article.publicId)
    expect(found?.title).toBe('Shared')
  })

  it('returns null for private articles — public reads must not leak', async () => {
    const article = await createArticle(db)
    expect(article.visibility).toBe('private')
    expect(await getByPublicId(db, article.publicId)).toBeNull()
  })

  it('returns null for unknown public ids', async () => {
    expect(await getByPublicId(db, 'does-not-exist-000000')).toBeNull()
  })
})

describe('listForOwner', () => {
  it('returns all articles regardless of visibility, newest-updated first', async () => {
    const older = await createArticle(db)
    await setVisibility(db, older.id, 'public')
    await new Promise((resolve) => setTimeout(resolve, 5))
    const newer = await createArticle(db)

    const list = await listForOwner(db)
    expect(list.map((article) => article.id)).toEqual([newer.id, older.id])
    expect(list.map((article) => article.visibility).sort()).toEqual([
      'private',
      'public',
    ])
  })

  it('includes the category name when set', async () => {
    const article = await createArticle(db)
    const category = await createCategory(db, 'Essays')
    await setCategory(db, article.id, category.id)
    const [row] = await listForOwner(db)
    expect(row?.categoryName).toBe('Essays')
  })
})

describe('setCategory', () => {
  it('wires and clears the category FK', async () => {
    const article = await createArticle(db)
    const category = await createCategory(db, 'Travel')
    await setCategory(db, article.id, category.id)
    expect((await getById(db, article.id))?.categoryId).toBe(category.id)

    await setCategory(db, article.id, null)
    expect((await getById(db, article.id))?.categoryId).toBeNull()
  })

  it('lists categories', async () => {
    await createCategory(db, 'B')
    await createCategory(db, 'A')
    const names = (await listCategories(db)).map((category) => category.name)
    expect(names).toEqual(['A', 'B'])
  })
})

describe('setTags', () => {
  it('creates missing tags by name and wires join rows', async () => {
    const article = await createArticle(db)
    await setTags(db, article.id, ['travel', 'photos'])
    const loaded = await getById(db, article.id)
    expect(loaded?.tags.map((tag) => tag.name).sort()).toEqual([
      'photos',
      'travel',
    ])
  })

  it('reuses existing tags instead of duplicating them', async () => {
    const first = await createArticle(db)
    const second = await createArticle(db)
    await setTags(db, first.id, ['travel'])
    await setTags(db, second.id, ['travel'])
    const allTags = await listTags(db)
    expect(allTags.filter((tag) => tag.name === 'travel')).toHaveLength(1)
  })

  it('replaces the tag set on re-assignment', async () => {
    const article = await createArticle(db)
    await setTags(db, article.id, ['old', 'kept'])
    await setTags(db, article.id, ['kept', 'new'])
    const loaded = await getById(db, article.id)
    expect(loaded?.tags.map((tag) => tag.name).sort()).toEqual(['kept', 'new'])
  })

  it('clears all tags with an empty list', async () => {
    const article = await createArticle(db)
    await setTags(db, article.id, ['solo'])
    await setTags(db, article.id, [])
    expect((await getById(db, article.id))?.tags).toEqual([])
  })

  it('garbage-collects tags left without any article references', async () => {
    const article = await createArticle(db)
    const other = await createArticle(db)
    await setTags(db, article.id, ['orphaned', 'shared'])
    await setTags(db, other.id, ['shared'])

    await setTags(db, article.id, [])

    // 'orphaned' had no remaining references — gone; 'shared' is still used
    // by the other article and survives.
    expect((await listTags(db)).map((tag) => tag.name)).toEqual(['shared'])
    expect((await getById(db, other.id))?.tags.map((tag) => tag.name)).toEqual([
      'shared',
    ])
  })

  it('enforces unique tag names at the database level', async () => {
    await db.insert(articleTags).values({ name: 'dup' })
    await expect(
      db.insert(articleTags).values({ name: 'dup' }),
    ).rejects.toThrow()
  })

  it('resolves a duplicate-name create race to a single tag row', async () => {
    const first = await createArticle(db)
    const second = await createArticle(db)
    // Both writers believe the tag is missing and try to create it —
    // ON CONFLICT DO NOTHING + re-select must leave one row, both mapped.
    await Promise.all([
      setTags(db, first.id, ['race']),
      setTags(db, second.id, ['race']),
    ])
    expect(
      (await listTags(db)).filter((tag) => tag.name === 'race'),
    ).toHaveLength(1)
    expect((await getById(db, first.id))?.tags.map((tag) => tag.name)).toEqual([
      'race',
    ])
    expect((await getById(db, second.id))?.tags.map((tag) => tag.name)).toEqual(
      ['race'],
    )
  })
})

describe('deleteArticle', () => {
  it('removes the article and its tag join rows', async () => {
    const article = await createArticle(db)
    await setTags(db, article.id, ['doomed'])
    await deleteArticle(db, article.id)
    expect(await getById(db, article.id)).toBeNull()
    // The tag itself survives — only the mapping goes.
    expect((await listTags(db)).map((tag) => tag.name)).toEqual(['doomed'])
  })
})
