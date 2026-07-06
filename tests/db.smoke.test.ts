import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { articleCategories, articles } from '../src/db/schema'
import { newPublicId } from '../src/lib/public-id'
import { createTestDb } from './helpers/test-db'

const { db, close } = createTestDb()

// Rows created by the test, deleted in afterAll so failed assertions
// don't leak rows into the shared test database.
const createdArticleIds: number[] = []
const createdCategoryIds: number[] = []

afterAll(async () => {
  try {
    if (createdArticleIds.length > 0) {
      await db.delete(articles).where(inArray(articles.id, createdArticleIds))
    }
    if (createdCategoryIds.length > 0) {
      await db
        .delete(articleCategories)
        .where(inArray(articleCategories.id, createdCategoryIds))
    }
  } finally {
    await close()
  }
})

describe('schema smoke test (real Postgres)', () => {
  it('round-trips an article referencing a category', async () => {
    const [category] = await db
      .insert(articleCategories)
      .values({ name: 'smoke-category' })
      .returning()
    expect(category).toBeDefined()
    if (!category) throw new Error('unreachable')
    createdCategoryIds.push(category.id)

    const publicId = newPublicId()
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'hello from the smoke test' }],
        },
      ],
    }

    const [inserted] = await db
      .insert(articles)
      .values({
        publicId,
        title: 'Smoke test article',
        content,
        categoryId: category.id,
      })
      .returning()
    expect(inserted).toBeDefined()
    if (!inserted) throw new Error('unreachable')
    createdArticleIds.push(inserted.id)

    const found = await db.query.articles.findFirst({
      where: eq(articles.publicId, publicId),
    })

    expect(found).toBeDefined()
    expect(found?.id).toBe(inserted.id)
    expect(found?.title).toBe('Smoke test article')
    expect(found?.content).toEqual(content)
    expect(found?.categoryId).toBe(category.id)
    // Defaults from the schema.
    expect(found?.visibility).toBe('private')
    expect(found?.isFeatured).toBe(false)
    expect(found?.createdAt).toBeInstanceOf(Date)
    expect(found?.updatedAt).toBeInstanceOf(Date)

    // public_id is unique-constrained — a duplicate insert throws a
    // unique_violation (pg error code 23505, wrapped by Drizzle).
    await expect(
      db.insert(articles).values({
        publicId,
        title: 'Duplicate public_id',
        content,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      const cause = (error as Error).cause as { code?: string } | undefined
      return cause?.code === '23505'
    })
  })
})
