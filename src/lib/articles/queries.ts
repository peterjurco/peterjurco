import { and, asc, desc, eq } from 'drizzle-orm'
import {
  articleCategories,
  articles,
  articleTags,
  articleTagsMap,
} from '../../db/schema'
import type { Article, ArticleCategory, ArticlesDb, ArticleTag } from './repo'

/**
 * Read queries for the listing pages and the authenticated homepage.
 *
 * All listings here are OWNER-ONLY (the pages sit under `/app/*`), so they
 * return both private and public articles. Ordering is `updated_at DESC` —
 * "recent" means recently touched, so a just-edited old article floats up
 * (REQUIREMENTS "Recent articles"); `id DESC` breaks same-millisecond ties.
 *
 * INVARIANT — no interactive transactions (see repo.ts): production runs on
 * the Neon HTTP driver, so `reorderFeatured` runs as ordered, independent
 * UPDATE statements. An interruption mid-way leaves some rows on old
 * positions — harmless (ordering stays deterministic) and repaired by the
 * next reorder.
 */

const newestFirst = [desc(articles.updatedAt), desc(articles.id)] as const

/** Articles in the category, both visibilities, newest-updated first. */
export async function listByCategory(
  db: ArticlesDb,
  categoryId: number,
): Promise<Article[]> {
  return db
    .select()
    .from(articles)
    .where(eq(articles.categoryId, categoryId))
    .orderBy(...newestFirst)
}

/** Articles carrying the tag, both visibilities, newest-updated first. */
export async function listByTag(
  db: ArticlesDb,
  tagId: number,
): Promise<Article[]> {
  const rows = await db
    .select({ article: articles })
    .from(articleTagsMap)
    .innerJoin(articles, eq(articleTagsMap.articleId, articles.id))
    .where(eq(articleTagsMap.tagId, tagId))
    .orderBy(...newestFirst)
  return rows.map((row) => row.article)
}

/** The latest `limit` articles by `updated_at` (recently touched first). */
export async function listRecent(
  db: ArticlesDb,
  limit: number,
): Promise<Article[]> {
  return db
    .select()
    .from(articles)
    .orderBy(...newestFirst)
    .limit(limit)
}

/**
 * Featured articles by manual drag order (`featured_position ASC`).
 * Newly-featured rows have a NULL position — Postgres sorts NULLS LAST on
 * ASC, so they append after the ordered ones until the next reorder.
 */
export async function listFeatured(db: ArticlesDb): Promise<Article[]> {
  return db
    .select()
    .from(articles)
    .where(eq(articles.isFeatured, true))
    .orderBy(asc(articles.featuredPosition), asc(articles.id))
}

/**
 * Persists a drag order: each article's `featured_position` becomes its index
 * in `orderedIds`. Non-featured or unknown ids are ignored (the position is
 * meaningful only while `is_featured`). Sequential UPDATEs — see the
 * no-transactions invariant above.
 */
export async function reorderFeatured(
  db: ArticlesDb,
  orderedIds: number[],
): Promise<void> {
  for (const [position, id] of orderedIds.entries()) {
    await db
      .update(articles)
      .set({ featuredPosition: position })
      .where(and(eq(articles.id, id), eq(articles.isFeatured, true)))
  }
}

/** Category lookup for `/app/categories/:id` — null drives the 404. */
export async function getCategoryById(
  db: ArticlesDb,
  id: number,
): Promise<ArticleCategory | null> {
  const [category] = await db
    .select()
    .from(articleCategories)
    .where(eq(articleCategories.id, id))
    .limit(1)
  return category ?? null
}

/** Tag lookup for `/app/tags/:id` — null drives the 404. */
export async function getTagById(
  db: ArticlesDb,
  id: number,
): Promise<ArticleTag | null> {
  const [tag] = await db
    .select()
    .from(articleTags)
    .where(eq(articleTags.id, id))
    .limit(1)
  return tag ?? null
}
