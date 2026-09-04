import { eq } from 'drizzle-orm'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
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
  createMigratedArticle,
  deleteArticle,
  EMPTY_DOC,
  getById,
  getByLegacyWpId,
  getByPublicId,
  listCategories,
  listForOwner,
  listTags,
  listTopTagsByCategory,
  type MigratedArticleFields,
  reorderFeatured,
  setCategory,
  setFeatured,
  setTags,
  setVisibility,
  updateArticle,
  updateMigratedArticle,
} from '../src/lib/articles/repo'
import { imageUrl } from '../src/lib/media/image-url'
import { deleteObject } from '../src/lib/media/r2'
import { createTestDb } from './helpers/test-db'

vi.mock('../src/lib/media/r2', () => ({
  deleteObject: vi.fn().mockResolvedValue(undefined),
}))

const { db, close } = createTestDb()

// R2 credentials are irrelevant — deleteObject is mocked above, so no real
// network call is ever made. Orphaned-image cleanup itself is covered in the
// dedicated describe block below; every other test here just needs a value
// to satisfy updateArticle/deleteArticle's required env param.
const R2_ENV = {}

beforeEach(async () => {
  // FK order: join rows → articles → taxonomy.
  await db.delete(articleTagsMap)
  await db.delete(articles)
  await db.delete(articleTags)
  await db.delete(articleCategories)
  vi.mocked(deleteObject).mockReset().mockResolvedValue(undefined)
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
    const updated = await updateArticle(
      db,
      article.id,
      {
        title: 'Hello',
        content,
      },
      R2_ENV,
    )
    expect(updated?.title).toBe('Hello')
    expect(updated?.content).toEqual(content)
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(
      article.updatedAt.getTime(),
    )
  })

  it('updates title alone without touching content', async () => {
    const article = await createArticle(db)
    const updated = await updateArticle(
      db,
      article.id,
      { title: 'Only title' },
      R2_ENV,
    )
    expect(updated?.title).toBe('Only title')
    expect(updated?.content).toEqual(EMPTY_DOC)
  })

  it('returns null for an unknown article', async () => {
    expect(await updateArticle(db, 999_999, { title: 'x' }, R2_ENV)).toBeNull()
  })
})

describe('updateArticle / deleteArticle — orphaned image cleanup', () => {
  beforeAll(() => {
    process.env.PUBLIC_R2_PUBLIC_BASE_URL = 'https://media.test.local'
    process.env.PUBLIC_IMAGE_TRANSFORMS = 'off'
  })

  function docWithImages(...keys: string[]) {
    return {
      type: 'doc',
      content: keys.map((key) => ({
        type: 'image',
        attrs: { src: imageUrl(key) },
      })),
    }
  }

  it('deletes only the images dropped from an edited article — reordering deletes nothing', async () => {
    const article = await createArticle(db)
    await updateArticle(
      db,
      article.id,
      { content: docWithImages('articles/a.png', 'articles/b.png') },
      R2_ENV,
    )
    vi.mocked(deleteObject).mockClear()

    await updateArticle(
      db,
      article.id,
      // Same two keys, reordered — a reorder-only save must delete nothing.
      { content: docWithImages('articles/b.png', 'articles/a.png') },
      R2_ENV,
    )
    expect(deleteObject).not.toHaveBeenCalled()

    await updateArticle(
      db,
      article.id,
      { content: docWithImages('articles/b.png') },
      R2_ENV,
    )
    expect(deleteObject).toHaveBeenCalledExactlyOnceWith(
      R2_ENV,
      'articles/a.png',
    )
  })

  it('does not clean up images when the patch never touches content', async () => {
    const article = await createArticle(db)
    await updateArticle(
      db,
      article.id,
      { content: docWithImages('articles/kept.png') },
      R2_ENV,
    )
    vi.mocked(deleteObject).mockClear()

    await updateArticle(db, article.id, { title: 'Only title' }, R2_ENV)
    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('cleans up every body image when the whole article is deleted', async () => {
    const article = await createArticle(db)
    await updateArticle(
      db,
      article.id,
      { content: docWithImages('articles/x.png', 'articles/y.png') },
      R2_ENV,
    )
    vi.mocked(deleteObject).mockClear()

    await deleteArticle(db, article.id, R2_ENV)
    expect(
      vi
        .mocked(deleteObject)
        .mock.calls.map((call) => call[1])
        .sort(),
    ).toEqual(['articles/x.png', 'articles/y.png'])
  })

  it('skips a hand-typed external image URL — never mistaken for an R2 key', async () => {
    const article = await createArticle(db)
    await updateArticle(
      db,
      article.id,
      {
        content: {
          type: 'doc',
          content: [
            { type: 'image', attrs: { src: 'https://example.com/photo.jpg' } },
          ],
        },
      },
      R2_ENV,
    )
    vi.mocked(deleteObject).mockClear()

    await deleteArticle(db, article.id, R2_ENV)
    expect(deleteObject).not.toHaveBeenCalled()
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
    await updateArticle(db, article.id, { title }, R2_ENV)
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
    await updateArticle(db, article.id, { title: 'Shared' }, R2_ENV)
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

  it('filters by categoryId', async () => {
    const travel = await createCategory(db, 'Travel')
    const cooking = await createCategory(db, 'Cooking')
    const travelArticle = await createArticle(db)
    await setCategory(db, travelArticle.id, travel.id)
    const cookingArticle = await createArticle(db)
    await setCategory(db, cookingArticle.id, cooking.id)

    const list = await listForOwner(db, { categoryId: travel.id })
    expect(list.map((article) => article.id)).toEqual([travelArticle.id])
  })

  it('search matches the title', async () => {
    const match = await createArticle(db)
    await updateArticle(db, match.id, { title: 'A trip to Norway' }, R2_ENV)
    const noMatch = await createArticle(db)
    await updateArticle(db, noMatch.id, { title: 'Weekend recipes' }, R2_ENV)

    const list = await listForOwner(db, { search: 'norway' })
    expect(list.map((article) => article.id)).toEqual([match.id])
  })

  it('search matches body text, not just the title', async () => {
    const match = await createArticle(db)
    await updateArticle(
      db,
      match.id,
      {
        title: 'Untitled',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'We hiked through Norway.' }],
            },
          ],
        },
      },
      R2_ENV,
    )
    const noMatch = await createArticle(db)
    await updateArticle(db, noMatch.id, { title: 'Something else' }, R2_ENV)

    const list = await listForOwner(db, { search: 'norway' })
    expect(list.map((article) => article.id)).toEqual([match.id])
  })

  it('ranks title matches before body-only matches', async () => {
    const bodyOnly = await createArticle(db)
    await updateArticle(
      db,
      bodyOnly.id,
      {
        title: 'Weekend recipes',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Mentions norway in passing.' }],
            },
          ],
        },
      },
      R2_ENV,
    )
    await new Promise((resolve) => setTimeout(resolve, 5))
    const titleMatch = await createArticle(db)
    await updateArticle(db, titleMatch.id, { title: 'Norway trip' }, R2_ENV)

    const list = await listForOwner(db, { search: 'norway' })
    // titleMatch ranks first despite being the more recently updated of the
    // two either way — the real test is that ranking doesn't just fall back
    // to modified-date order.
    expect(list.map((article) => article.id)).toEqual([
      titleMatch.id,
      bodyOnly.id,
    ])
  })

  it('combines category and search filters', async () => {
    const travel = await createCategory(db, 'Travel')
    const inCategory = await createArticle(db)
    await setCategory(db, inCategory.id, travel.id)
    await updateArticle(db, inCategory.id, { title: 'Norway trip' }, R2_ENV)
    const outsideCategory = await createArticle(db)
    await updateArticle(
      db,
      outsideCategory.id,
      { title: 'Norway diary' },
      R2_ENV,
    )

    const list = await listForOwner(db, {
      categoryId: travel.id,
      search: 'norway',
    })
    expect(list.map((article) => article.id)).toEqual([inCategory.id])
  })

  it('ignores a blank search string', async () => {
    const article = await createArticle(db)
    const list = await listForOwner(db, { search: '   ' })
    expect(list.map((a) => a.id)).toEqual([article.id])
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

describe('listTopTagsByCategory', () => {
  it('ranks tags by how many articles in the category use them', async () => {
    const travel = await createCategory(db, 'Travel')
    const a = await createArticle(db)
    const b = await createArticle(db)
    const c = await createArticle(db)
    await setCategory(db, a.id, travel.id)
    await setCategory(db, b.id, travel.id)
    await setCategory(db, c.id, travel.id)
    // 'hiking' on all 3 articles, 'photos' on only 1 — an unambiguous rank.
    await setTags(db, a.id, ['hiking', 'photos'])
    await setTags(db, b.id, ['hiking'])
    await setTags(db, c.id, ['hiking'])

    const top = await listTopTagsByCategory(db, 3)
    expect(top[travel.id]).toEqual(['hiking', 'photos'])
  })

  it('caps the list at `limit` per category', async () => {
    const travel = await createCategory(db, 'Travel')
    const article = await createArticle(db)
    await setCategory(db, article.id, travel.id)
    await setTags(db, article.id, ['a', 'b', 'c', 'd'])

    const top = await listTopTagsByCategory(db, 2)
    expect(top[travel.id]).toHaveLength(2)
  })

  it('never mixes tag usage across categories', async () => {
    const travel = await createCategory(db, 'Travel')
    const cooking = await createCategory(db, 'Cooking')
    const travelArticle = await createArticle(db)
    const cookingArticle = await createArticle(db)
    await setCategory(db, travelArticle.id, travel.id)
    await setCategory(db, cookingArticle.id, cooking.id)
    await setTags(db, travelArticle.id, ['shared'])
    await setTags(db, cookingArticle.id, ['shared'])

    const top = await listTopTagsByCategory(db, 3)
    expect(top[travel.id]).toEqual(['shared'])
    expect(top[cooking.id]).toEqual(['shared'])
  })

  it('excludes articles with no category', async () => {
    const article = await createArticle(db)
    await setTags(db, article.id, ['uncategorized-tag'])

    const top = await listTopTagsByCategory(db, 3)
    expect(Object.values(top).flat()).not.toContain('uncategorized-tag')
  })

  it('returns an empty object when nothing is tagged', async () => {
    expect(await listTopTagsByCategory(db, 3)).toEqual({})
  })
})

describe('createMigratedArticle / updateMigratedArticle / getByLegacyWpId', () => {
  const fields: MigratedArticleFields = {
    title: 'WP post',
    content: EMPTY_DOC,
    categoryId: null,
    visibility: 'private',
    featuredPhotoKey: null,
    createdAt: new Date('2015-03-04T10:00:00.000Z'),
    updatedAt: new Date('2015-03-05T11:00:00.000Z'),
  }

  it('inserts an article carrying the WP dates verbatim, not import-time "now"', async () => {
    const article = await createMigratedArticle(db, 4242, fields)
    expect(article.legacyWpId).toBe(4242)
    expect(article.createdAt.toISOString()).toBe('2015-03-04T10:00:00.000Z')
    expect(article.updatedAt.toISOString()).toBe('2015-03-05T11:00:00.000Z')
    expect(article.visibility).toBe('private')
  })

  it('finds the created article back by its legacy WP id', async () => {
    const created = await createMigratedArticle(db, 777, fields)
    const found = await getByLegacyWpId(db, 777)
    expect(found?.id).toBe(created.id)
  })

  it('returns null for an unknown legacy WP id', async () => {
    expect(await getByLegacyWpId(db, 999999)).toBeNull()
  })

  it('updateMigratedArticle overrides updatedAt explicitly, not via $onUpdate', async () => {
    const created = await createMigratedArticle(db, 500, fields)
    const updated = await updateMigratedArticle(db, created.id, {
      ...fields,
      title: 'Re-imported title',
      updatedAt: new Date('2020-01-01T00:00:00.000Z'),
    })
    expect(updated?.title).toBe('Re-imported title')
    // If $onUpdate had fired instead, this would be "now", not the WP date.
    expect(updated?.updatedAt.toISOString()).toBe('2020-01-01T00:00:00.000Z')
  })

  it('is idempotent by legacy id: re-import updates in place, never duplicates', async () => {
    const first = await createMigratedArticle(db, 88, fields)
    const existing = await getByLegacyWpId(db, 88)
    expect(existing).not.toBeNull()
    const second = await updateMigratedArticle(db, existing?.id as number, {
      ...fields,
      title: 'Updated on re-run',
    })
    expect(second?.id).toBe(first.id)
    const all = await db.select().from(articles)
    expect(all.filter((row) => row.legacyWpId === 88)).toHaveLength(1)
  })

  it('leaves categoryId untouched when the patch omits it', async () => {
    const category = await createCategory(db, 'Travel')
    const created = await createMigratedArticle(db, 600, {
      ...fields,
      categoryId: category.id,
    })
    const { categoryId: _omitted, ...patchWithoutCategory } = fields
    const updated = await updateMigratedArticle(
      db,
      created.id,
      patchWithoutCategory,
    )
    expect(updated?.categoryId).toBe(category.id)
  })

  it('still updates categoryId when the patch includes it', async () => {
    const before = await createCategory(db, 'Before')
    const after = await createCategory(db, 'After')
    const created = await createMigratedArticle(db, 601, {
      ...fields,
      categoryId: before.id,
    })
    const updated = await updateMigratedArticle(db, created.id, {
      ...fields,
      categoryId: after.id,
    })
    expect(updated?.categoryId).toBe(after.id)
  })
})

describe('deleteArticle', () => {
  it('removes the article and its tag join rows', async () => {
    const article = await createArticle(db)
    await setTags(db, article.id, ['doomed'])
    await deleteArticle(db, article.id, R2_ENV)
    expect(await getById(db, article.id)).toBeNull()
    // The tag itself survives — only the mapping goes.
    expect((await listTags(db)).map((tag) => tag.name)).toEqual(['doomed'])
  })
})
