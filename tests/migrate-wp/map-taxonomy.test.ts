import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mapTaxonomy } from '../../scripts/migrate-wp/map-taxonomy'
import {
  articleCategories,
  articles,
  articleTags,
  articleTagsMap,
} from '../../src/db/schema'
import { createTestDb } from '../helpers/test-db'

const { db, close } = createTestDb()

beforeEach(async () => {
  // FK order: join rows → articles → categories/tags.
  await db.delete(articleTagsMap)
  await db.delete(articles)
  await db.delete(articleTags)
  await db.delete(articleCategories)
})

afterAll(async () => {
  await close()
})

describe('mapTaxonomy', () => {
  it('creates article_categories from WP categories and returns a wpId → id map', async () => {
    const { categoryIdByWpId } = await mapTaxonomy(db, {
      categories: [
        { wpId: 1, name: 'Travel' },
        { wpId: 2, name: 'Cooking' },
      ],
      tags: [],
    })

    expect(categoryIdByWpId.size).toBe(2)
    const rows = await db.select().from(articleCategories)
    expect(rows.map((row) => row.name).sort()).toEqual(['Cooking', 'Travel'])

    const travelId = categoryIdByWpId.get(1)
    const travelRow = rows.find((row) => row.name === 'Travel')
    expect(travelId).toBe(travelRow?.id)
  })

  it('creates article_tags from WP tags and returns a wpId → id map', async () => {
    const { tagIdByWpId } = await mapTaxonomy(db, {
      categories: [],
      tags: [
        { wpId: 10, name: 'hiking' },
        { wpId: 11, name: 'trail-running' },
      ],
    })

    expect(tagIdByWpId.size).toBe(2)
    const rows = await db.select().from(articleTags)
    expect(rows.map((row) => row.name).sort()).toEqual([
      'hiking',
      'trail-running',
    ])

    const hikingId = tagIdByWpId.get(10)
    const hikingRow = rows.find((row) => row.name === 'hiking')
    expect(hikingId).toBe(hikingRow?.id)
  })

  it('is idempotent: re-running with the same input does not duplicate categories or tags', async () => {
    const input = {
      categories: [{ wpId: 1, name: 'Travel' }],
      tags: [{ wpId: 10, name: 'hiking' }],
    }

    const first = await mapTaxonomy(db, input)
    const second = await mapTaxonomy(db, input)

    expect(second.categoryIdByWpId.get(1)).toBe(first.categoryIdByWpId.get(1))
    expect(second.tagIdByWpId.get(10)).toBe(first.tagIdByWpId.get(10))

    const categoryRows = await db.select().from(articleCategories)
    const tagRows = await db.select().from(articleTags)
    expect(categoryRows).toHaveLength(1)
    expect(tagRows).toHaveLength(1)
  })

  it('reuses a pre-existing category or tag row that already has the same name', async () => {
    const [existingCategory] = await db
      .insert(articleCategories)
      .values({ name: 'Travel' })
      .returning()
    if (!existingCategory) throw new Error('failed to seed category')
    const [existingTag] = await db
      .insert(articleTags)
      .values({ name: 'hiking' })
      .returning()
    if (!existingTag) throw new Error('failed to seed tag')

    const { categoryIdByWpId, tagIdByWpId } = await mapTaxonomy(db, {
      categories: [{ wpId: 99, name: 'Travel' }],
      tags: [{ wpId: 199, name: 'hiking' }],
    })

    expect(categoryIdByWpId.get(99)).toBe(existingCategory.id)
    expect(tagIdByWpId.get(199)).toBe(existingTag.id)
    expect(await db.select().from(articleCategories)).toHaveLength(1)
    expect(await db.select().from(articleTags)).toHaveLength(1)
  })

  it('maps two different WP ids sharing the same name to the same row', async () => {
    const { categoryIdByWpId } = await mapTaxonomy(db, {
      categories: [
        { wpId: 1, name: 'Travel' },
        { wpId: 2, name: 'Travel' },
      ],
      tags: [],
    })

    expect(categoryIdByWpId.get(1)).toBe(categoryIdByWpId.get(2))
    expect(await db.select().from(articleCategories)).toHaveLength(1)
  })

  it('returns empty maps for empty input without touching the database', async () => {
    const { categoryIdByWpId, tagIdByWpId } = await mapTaxonomy(db, {
      categories: [],
      tags: [],
    })

    expect(categoryIdByWpId.size).toBe(0)
    expect(tagIdByWpId.size).toBe(0)
    expect(await db.select().from(articleCategories)).toHaveLength(0)
    expect(await db.select().from(articleTags)).toHaveLength(0)
  })

  it('trims whitespace around WP term names', async () => {
    const { categoryIdByWpId } = await mapTaxonomy(db, {
      categories: [{ wpId: 1, name: '  Travel  ' }],
      tags: [],
    })
    const [row] = await db
      .select()
      .from(articleCategories)
      .where(eq(articleCategories.id, categoryIdByWpId.get(1) as number))
    expect(row?.name).toBe('Travel')
  })
})
