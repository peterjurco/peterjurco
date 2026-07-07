import { asc, eq } from 'drizzle-orm'
import {
  articleCategories,
  articles,
  articleTags,
  articleTagsMap,
} from '../../db/schema'
import {
  type Article,
  type ArticleCategory,
  type ArticlesDb,
  type ArticleTag,
  newestFirst,
} from './repo'

/**
 * READ-ONLY queries for the listing pages and the authenticated homepage —
 * writes live in repo.ts.
 *
 * All listings here are OWNER-ONLY (the pages sit under `/app/*`), so they
 * return both private and public articles. Ordering is `newestFirst`
 * (see repo.ts) — "recent" means recently touched.
 */

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
