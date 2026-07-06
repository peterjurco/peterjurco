import { and, desc, eq, inArray } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from '../../db/schema'
import {
  articleCategories,
  articles,
  articleTags,
  articleTagsMap,
} from '../../db/schema'
import { newPublicId } from '../public-id'

/**
 * Any Drizzle Postgres client over our schema — the Neon HTTP driver in
 * production (src/db/client.ts) or node-postgres in tests
 * (tests/helpers/test-db.ts).
 */
export type ArticlesDb = PgDatabase<PgQueryResultHKT, typeof schema>

export type Article = typeof articles.$inferSelect
export type ArticleTag = typeof articleTags.$inferSelect
export type ArticleCategory = typeof articleCategories.$inferSelect
export type ArticleVisibility = Article['visibility']

/** A TipTap / ProseMirror document as stored in `articles.content`. */
export type ArticleContent = Record<string, unknown>

/** The document a freshly created article starts from. */
export const EMPTY_DOC: ArticleContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

/** Creates an empty, private article with a fresh opaque public id. */
export async function createArticle(db: ArticlesDb): Promise<Article> {
  const [article] = await db
    .insert(articles)
    .values({ publicId: newPublicId(), title: '', content: EMPTY_DOC })
    .returning()
  if (!article) throw new Error('Article insert returned no row')
  return article
}

/** Autosave target: title and/or content. `updated_at` bumps via $onUpdate. */
export async function updateArticle(
  db: ArticlesDb,
  id: number,
  patch: { title?: string; content?: ArticleContent },
): Promise<Article | null> {
  const [article] = await db
    .update(articles)
    .set(patch)
    .where(eq(articles.id, id))
    .returning()
  return article ?? null
}

export async function setVisibility(
  db: ArticlesDb,
  id: number,
  visibility: ArticleVisibility,
): Promise<void> {
  await db.update(articles).set({ visibility }).where(eq(articles.id, id))
}

export async function setFeatured(
  db: ArticlesDb,
  id: number,
  isFeatured: boolean,
): Promise<void> {
  await db.update(articles).set({ isFeatured }).where(eq(articles.id, id))
}

/** Sets or clears (null) the article's single category. */
export async function setCategory(
  db: ArticlesDb,
  id: number,
  categoryId: number | null,
): Promise<void> {
  await db.update(articles).set({ categoryId }).where(eq(articles.id, id))
}

/**
 * Replaces the article's tag set. Tags are addressed by name; missing ones
 * are created on the fly (tag admin UI comes later — Plan 7).
 */
export async function setTags(
  db: ArticlesDb,
  id: number,
  tagNames: string[],
): Promise<void> {
  const names = [...new Set(tagNames.map((name) => name.trim()))].filter(
    (name) => name.length > 0,
  )

  const existing =
    names.length > 0
      ? await db
          .select()
          .from(articleTags)
          .where(inArray(articleTags.name, names))
      : []
  const existingByName = new Map(existing.map((tag) => [tag.name, tag.id]))

  const missing = names.filter((name) => !existingByName.has(name))
  if (missing.length > 0) {
    const created = await db
      .insert(articleTags)
      .values(missing.map((name) => ({ name })))
      .returning()
    for (const tag of created) existingByName.set(tag.name, tag.id)
  }

  await db.delete(articleTagsMap).where(eq(articleTagsMap.articleId, id))
  if (names.length > 0) {
    await db.insert(articleTagsMap).values(
      names.map((name) => {
        const tagId = existingByName.get(name)
        if (tagId === undefined) throw new Error(`Tag not resolved: ${name}`)
        return { articleId: id, tagId }
      }),
    )
  }
}

export async function deleteArticle(db: ArticlesDb, id: number): Promise<void> {
  await db.delete(articleTagsMap).where(eq(articleTagsMap.articleId, id))
  await db.delete(articles).where(eq(articles.id, id))
}

export type ArticleWithTags = Article & { tags: ArticleTag[] }

/** Owner-side lookup by internal id — any visibility, with tags. */
export async function getById(
  db: ArticlesDb,
  id: number,
): Promise<ArticleWithTags | null> {
  const [article] = await db
    .select()
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1)
  if (!article) return null
  const tags = await db
    .select({ id: articleTags.id, name: articleTags.name })
    .from(articleTagsMap)
    .innerJoin(articleTags, eq(articleTagsMap.tagId, articleTags.id))
    .where(eq(articleTagsMap.articleId, id))
  return { ...article, tags }
}

/**
 * Public accessor for `/a/:publicId` — returns ONLY public articles.
 * Private articles are unreachable here by construction (TECH_DECISIONS §9).
 */
export async function getByPublicId(
  db: ArticlesDb,
  publicId: string,
): Promise<Article | null> {
  const [article] = await db
    .select()
    .from(articles)
    .where(
      and(eq(articles.publicId, publicId), eq(articles.visibility, 'public')),
    )
    .limit(1)
  return article ?? null
}

export type ArticleListItem = Article & { categoryName: string | null }

/** Every article (all visibilities) for the authed list page. */
export async function listForOwner(db: ArticlesDb): Promise<ArticleListItem[]> {
  const rows = await db
    .select({ article: articles, categoryName: articleCategories.name })
    .from(articles)
    .leftJoin(articleCategories, eq(articles.categoryId, articleCategories.id))
    .orderBy(desc(articles.updatedAt), desc(articles.id))
  return rows.map((row) => ({ ...row.article, categoryName: row.categoryName }))
}

export async function createCategory(
  db: ArticlesDb,
  name: string,
): Promise<ArticleCategory> {
  const [category] = await db
    .insert(articleCategories)
    .values({ name })
    .returning()
  if (!category) throw new Error('Category insert returned no row')
  return category
}

export async function listCategories(
  db: ArticlesDb,
): Promise<ArticleCategory[]> {
  return db.select().from(articleCategories).orderBy(articleCategories.name)
}

export async function listTags(db: ArticlesDb): Promise<ArticleTag[]> {
  return db.select().from(articleTags).orderBy(articleTags.name)
}
