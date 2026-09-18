import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pages } from '../src/db/schema'
import {
  createPage,
  deletePage,
  getById,
  getBySlug,
  listForOwner,
  pageExists,
  SlugTakenError,
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
