import { eq } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from '../../src/db/schema'
import { articleCategories } from '../../src/db/schema'
import { createCategory } from '../../src/lib/articles/repo'
import { createArticleTag } from '../../src/lib/taxonomy/repo'

/**
 * WordPress `wp_terms` → `article_categories`/`article_tags` (DATA_MODEL
 * "Migration considerations"). Idempotent by name, so re-running the import
 * against the same dump never duplicates a category or tag.
 *
 * Categories: `article_categories.name` carries no unique index (unlike
 * `article_tags.name` — see src/db/schema.ts), so `articles/repo.ts`'s
 * `createCategory` is a plain insert with no dedup, by design — the admin UI
 * always means "create a genuinely new category". The migration needs
 * different semantics (find-or-create by name), so this module adds a
 * select-then-insert wrapper around it rather than duplicating the insert
 * itself. A read-then-write race is fine here: this script runs as a single
 * sequential process, never concurrently with itself.
 *
 * Tags: `article_tags.name` IS unique, so `taxonomy/repo.ts`'s
 * `createArticleTag` (ON CONFLICT DO NOTHING + re-select) already is the
 * upsert-by-name primitive this needs — reused directly, not duplicated.
 */

type MigrationDb = PgDatabase<PgQueryResultHKT, typeof schema>

export interface WpTerm {
  wpId: number
  name: string
}

export interface TaxonomyMapping {
  categoryIdByWpId: Map<number, number>
  tagIdByWpId: Map<number, number>
}

/** Finds the category by name, or creates it — categories have no unique
 * index to `ON CONFLICT` against, so this checks first. */
async function upsertCategoryByName(
  db: MigrationDb,
  name: string,
): Promise<{ id: number }> {
  const [existing] = await db
    .select({ id: articleCategories.id })
    .from(articleCategories)
    .where(eq(articleCategories.name, name))
    .limit(1)
  if (existing) return existing
  return createCategory(db, name)
}

export async function mapTaxonomy(
  db: MigrationDb,
  input: { categories: WpTerm[]; tags: WpTerm[] },
): Promise<TaxonomyMapping> {
  const categoryIdByWpId = new Map<number, number>()
  for (const { wpId, name } of input.categories) {
    const category = await upsertCategoryByName(db, name.trim())
    categoryIdByWpId.set(wpId, category.id)
  }

  const tagIdByWpId = new Map<number, number>()
  for (const { wpId, name } of input.tags) {
    const tag = await createArticleTag(db, name.trim())
    tagIdByWpId.set(wpId, tag.id)
  }

  return { categoryIdByWpId, tagIdByWpId }
}
