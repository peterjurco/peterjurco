import { eq } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from '../../db/schema'
import {
  articleCategories,
  articles,
  articleTags,
  articleTagsMap,
  photoAlbumsTagsMap,
  photoTags,
} from '../../db/schema'
import type { ArticleCategory, ArticleTag } from '../articles/repo'
import type { PhotoTag } from '../photos/repo'

/**
 * Admin CRUD for taxonomies (REQUIREMENTS "Admin" — edit categories and
 * tags): article categories, article tags and photo tags.
 *
 * Create + list already live where each taxonomy is otherwise consumed —
 * article categories/tags in src/lib/articles/repo.ts (article editor),
 * photo tags in src/lib/photos/repo.ts (photo hub, incl. `setTagVisibility`)
 * — this module does not duplicate them. It adds the admin-only rename and
 * delete operations, plus `createArticleTag`, the one create-a-single-tag
 * primitive article tags didn't need until now (articles/repo.setTags only
 * ever creates tags in bulk, on the fly).
 *
 * INVARIANT — no interactive transactions (see src/lib/articles/repo.ts):
 * production runs on the Neon HTTP driver, so multi-statement writes run as
 * ordered, independent statements — detach or unlink references before
 * deleting the row they point at.
 */

export type TaxonomyDb = PgDatabase<PgQueryResultHKT, typeof schema>

// -- Article categories ------------------------------------------------------

export async function renameArticleCategory(
  db: TaxonomyDb,
  id: number,
  name: string,
): Promise<ArticleCategory | null> {
  const [category] = await db
    .update(articleCategories)
    .set({ name })
    .where(eq(articleCategories.id, id))
    .returning()
  return category ?? null
}

/**
 * Deletes the category. `articles.category_id` is a plain FK with no
 * ON DELETE SET NULL, so affected articles are explicitly detached first —
 * they survive uncategorized, never orphaned mid-delete.
 */
export async function deleteArticleCategory(
  db: TaxonomyDb,
  id: number,
): Promise<void> {
  await db
    .update(articles)
    .set({ categoryId: null })
    .where(eq(articles.categoryId, id))
  await db.delete(articleCategories).where(eq(articleCategories.id, id))
}

export async function articleCategoryExists(
  db: TaxonomyDb,
  id: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: articleCategories.id })
    .from(articleCategories)
    .where(eq(articleCategories.id, id))
    .limit(1)
  return row !== undefined
}

// -- Article tags -------------------------------------------------------------

/**
 * Creates the tag, or returns the existing one when the name is taken —
 * ON CONFLICT DO NOTHING (unique index on name) + re-select keeps concurrent
 * create-by-name race-safe, mirroring photos/repo.createTag.
 */
export async function createArticleTag(
  db: TaxonomyDb,
  name: string,
): Promise<ArticleTag> {
  const [created] = await db
    .insert(articleTags)
    .values({ name })
    .onConflictDoNothing({ target: articleTags.name })
    .returning()
  if (created) return created
  const [existing] = await db
    .select()
    .from(articleTags)
    .where(eq(articleTags.name, name))
    .limit(1)
  if (!existing) throw new Error(`Tag not resolved: ${name}`)
  return existing
}

export async function renameArticleTag(
  db: TaxonomyDb,
  id: number,
  name: string,
): Promise<ArticleTag | null> {
  const [tag] = await db
    .update(articleTags)
    .set({ name })
    .where(eq(articleTags.id, id))
    .returning()
  return tag ?? null
}

/** Removes the tag's join rows before the tag row itself. */
export async function deleteArticleTag(
  db: TaxonomyDb,
  id: number,
): Promise<void> {
  await db.delete(articleTagsMap).where(eq(articleTagsMap.tagId, id))
  await db.delete(articleTags).where(eq(articleTags.id, id))
}

export async function articleTagExists(
  db: TaxonomyDb,
  id: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: articleTags.id })
    .from(articleTags)
    .where(eq(articleTags.id, id))
    .limit(1)
  return row !== undefined
}

// -- Photo tags -----------------------------------------------------------------

export async function renamePhotoTag(
  db: TaxonomyDb,
  id: number,
  name: string,
): Promise<PhotoTag | null> {
  const [tag] = await db
    .update(photoTags)
    .set({ name })
    .where(eq(photoTags.id, id))
    .returning()
  return tag ?? null
}

/**
 * Removes the tag's album links before the tag row itself — an explicit
 * admin delete, unlike photos/repo.setAlbumTags' garbage collection (which
 * only removes a PRIVATE tag once its last album drops it, and never touches
 * PUBLIC tags). Deleting a PUBLIC tag here breaks its `/t/:publicId` share
 * link; the admin UI warns before calling this.
 */
export async function deletePhotoTag(
  db: TaxonomyDb,
  id: number,
): Promise<void> {
  await db.delete(photoAlbumsTagsMap).where(eq(photoAlbumsTagsMap.tagId, id))
  await db.delete(photoTags).where(eq(photoTags.id, id))
}
