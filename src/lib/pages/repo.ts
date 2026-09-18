import { and, desc, eq } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from '../../db/schema'
import { pages } from '../../db/schema'

/**
 * INVARIANT — no interactive transactions (same as articles/home-tiles
 * repos): production runs on the Neon HTTP driver, one statement per
 * round-trip, no db.transaction().
 */

export type PagesDb = PgDatabase<PgQueryResultHKT, typeof schema>
export type Page = typeof pages.$inferSelect
export type PageVisibility = Page['visibility']
export type PageMode = Page['mode']
export type PageSortKey = Page['sortKey']

/** Thrown by createPage/updatePage when the slug's unique constraint fires. */
export class SlugTakenError extends Error {
  constructor(slug: string) {
    super(`Slug "${slug}" is already in use`)
    this.name = 'SlugTakenError'
  }
}

/**
 * Postgres unique_violation. Drizzle wraps the driver error in a
 * `DrizzleQueryError` and nests the real pg error (with `.code`) under
 * `.cause` — confirmed against both the node-postgres driver (tests) and
 * documented as universal Drizzle behavior (see errors.ts: DrizzleQueryError
 * always sets `.cause` to the underlying driver error). The Neon HTTP driver
 * (prod) goes through the same wrapper, so the same check applies.
 */
function isUniqueViolation(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    (cause as { code?: unknown }).code === '23505'
  )
}

export async function createPage(
  db: PagesDb,
  fields: { slug: string; title: string },
): Promise<Page> {
  try {
    const [page] = await db.insert(pages).values(fields).returning()
    if (!page) throw new Error('Page insert returned no row')
    return page
  } catch (error) {
    if (isUniqueViolation(error)) throw new SlugTakenError(fields.slug)
    throw error
  }
}

export async function getById(db: PagesDb, id: number): Promise<Page | null> {
  const [page] = await db.select().from(pages).where(eq(pages.id, id)).limit(1)
  return page ?? null
}

/** Public accessor for `/<slug>` — returns ONLY public pages (private is unreachable by construction, same as articles/getByPublicId). */
export async function getBySlug(
  db: PagesDb,
  slug: string,
): Promise<Page | null> {
  const [page] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.slug, slug), eq(pages.visibility, 'public')))
    .limit(1)
  return page ?? null
}

/** Cheap existence probe for handlers that must 404. */
export async function pageExists(db: PagesDb, id: number): Promise<boolean> {
  const [row] = await db
    .select({ id: pages.id })
    .from(pages)
    .where(eq(pages.id, id))
    .limit(1)
  return row !== undefined
}

/** Every page (all visibilities) for the authed admin list, newest-updated first. */
export async function listForOwner(db: PagesDb): Promise<Page[]> {
  return db.select().from(pages).orderBy(desc(pages.updatedAt), desc(pages.id))
}

export async function deletePage(db: PagesDb, id: number): Promise<void> {
  await db.delete(pages).where(eq(pages.id, id))
}

/**
 * Updates slug and/or title. Same "throw SlugTakenError on unique conflict"
 * handling as createPage.
 */
export async function updatePage(
  db: PagesDb,
  id: number,
  patch: { slug?: string; title?: string },
): Promise<Page | null> {
  try {
    const [page] = await db
      .update(pages)
      .set(patch)
      .where(eq(pages.id, id))
      .returning()
    return page ?? null
  } catch (error) {
    if (isUniqueViolation(error) && patch.slug !== undefined) {
      throw new SlugTakenError(patch.slug)
    }
    throw error
  }
}

export async function setVisibility(
  db: PagesDb,
  id: number,
  visibility: PageVisibility,
): Promise<void> {
  await db.update(pages).set({ visibility }).where(eq(pages.id, id))
}

export async function setMode(
  db: PagesDb,
  id: number,
  mode: PageMode,
): Promise<void> {
  await db.update(pages).set({ mode }).where(eq(pages.id, id))
}

export async function setSortKey(
  db: PagesDb,
  id: number,
  sortKey: PageSortKey,
): Promise<void> {
  await db.update(pages).set({ sortKey }).where(eq(pages.id, id))
}

/** Replaces the manual-mode ordered article list wholesale. */
export async function setArticleIds(
  db: PagesDb,
  id: number,
  articleIds: number[],
): Promise<void> {
  await db.update(pages).set({ articleIds }).where(eq(pages.id, id))
}

export type AutoFilter =
  | { categoryId: number }
  | { tagId: number }
  | { categoryId: null; tagId: null }

/**
 * Sets the auto-mode filter. Always writes BOTH columns explicitly — setting
 * one clears the other — so "exactly one of categoryId/tagId" holds even if
 * the caller only meant to change one of them.
 */
export async function setAutoFilter(
  db: PagesDb,
  id: number,
  filter: AutoFilter,
): Promise<void> {
  if ('categoryId' in filter && filter.categoryId !== null) {
    await db
      .update(pages)
      .set({ categoryId: filter.categoryId, tagId: null })
      .where(eq(pages.id, id))
  } else if ('tagId' in filter && filter.tagId !== null) {
    await db
      .update(pages)
      .set({ categoryId: null, tagId: filter.tagId })
      .where(eq(pages.id, id))
  } else {
    await db
      .update(pages)
      .set({ categoryId: null, tagId: null })
      .where(eq(pages.id, id))
  }
}
