import { asc, eq } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from '../../db/schema'
import { apps } from '../../db/schema'
import { deleteObject, type R2Env } from '../media/r2'

/**
 * "My apps" list repository (DATA_MODEL §4, REQUIREMENTS "My apps"): a small
 * manually-ordered list of app links with an optional icon, shown on the
 * authenticated homepage and managed from `/app/admin/apps`.
 *
 * INVARIANT — no interactive transactions (see src/lib/articles/repo.ts):
 * production runs on the Neon HTTP driver, so multi-statement writes run as
 * ordered, independent statements.
 */

/** Any Drizzle Postgres client over our schema (prod neon-http or test pg). */
export type AppsDb = PgDatabase<PgQueryResultHKT, typeof schema>

export type App = typeof apps.$inferSelect

/**
 * Best-effort R2 cleanup for an icon key a DB write above already dropped.
 * Only ever called AFTER that write has succeeded (see repo-wide INVARIANT
 * docblock) — so `key`, if given, is never at risk of still being
 * referenced. Never throws: a failed delete is logged and swallowed, since
 * the row is already correct — a lingering icon in the bucket is a space
 * optimization, not a correctness guarantee (TODO.md).
 */
async function deleteOldIcon(
  env: R2Env,
  key: string | null | undefined,
): Promise<void> {
  if (!key) return
  try {
    await deleteObject(env, key)
  } catch (error) {
    console.error(`Failed to delete orphaned R2 object ${key}:`, error)
  }
}

export async function createApp(
  db: AppsDb,
  values: {
    name: string
    url: string
    iconKey?: string
    sortOrder: number
  },
): Promise<App> {
  const [app] = await db.insert(apps).values(values).returning()
  if (!app) throw new Error('App insert returned no row')
  return app
}

/** Partial update; `iconKey: null` clears the icon. */
export async function updateApp(
  db: AppsDb,
  id: number,
  patch: {
    name?: string
    url?: string
    iconKey?: string | null
    sortOrder?: number
  },
  env: R2Env,
): Promise<App | null> {
  // Read BEFORE the write — the only way to know the OLD icon the patch is
  // about to replace or clear (UPDATE ... RETURNING only gives the NEW row).
  const previousIconKey =
    'iconKey' in patch
      ? (
          await db
            .select({ iconKey: apps.iconKey })
            .from(apps)
            .where(eq(apps.id, id))
        )[0]?.iconKey
      : undefined

  const [app] = await db
    .update(apps)
    .set(patch)
    .where(eq(apps.id, id))
    .returning()
  if (!app) return null

  // R2 cleanup runs only now that the update above has actually succeeded
  // (see repo-wide INVARIANT docblock). Only delete the OLD icon, and only
  // when it was actually replaced/cleared — a no-op re-send of the same key
  // must not delete anything still in use.
  if (previousIconKey && previousIconKey !== patch.iconKey) {
    await deleteOldIcon(env, previousIconKey)
  }

  return app
}

export async function deleteApp(
  db: AppsDb,
  id: number,
  env: R2Env,
): Promise<void> {
  const [deleted] = await db
    .delete(apps)
    .where(eq(apps.id, id))
    .returning({ iconKey: apps.iconKey })

  // Best-effort R2 cleanup, run only after the delete above already
  // succeeded — see deleteOldIcon docblock.
  if (deleted) await deleteOldIcon(env, deleted.iconKey)
}

/** Cheap existence probe for handlers that must 404. */
export async function appExists(db: AppsDb, id: number): Promise<boolean> {
  const [row] = await db
    .select({ id: apps.id })
    .from(apps)
    .where(eq(apps.id, id))
    .limit(1)
  return row !== undefined
}

/** Every app, `sort_order` ASC — `id` breaks ties left by equal orders. */
export async function listOrdered(db: AppsDb): Promise<App[]> {
  return db.select().from(apps).orderBy(asc(apps.sortOrder), asc(apps.id))
}

/** Next free `sort_order` — appends a newly created app to the end. */
export async function nextSortOrder(db: AppsDb): Promise<number> {
  const ordered = await listOrdered(db)
  const last = ordered.at(-1)
  return last ? last.sortOrder + 1 : 0
}

/**
 * Persists a full reorder: each id's `sort_order` becomes its index. One
 * request for the whole list (mirroring `reorderFeatured`) instead of a
 * pairwise swap — a swap risks leaving two rows sharing a `sort_order` if
 * one of its two independent PATCHes fails, which a full-list rewrite can't.
 */
export async function reorderApps(
  db: AppsDb,
  orderedIds: number[],
): Promise<void> {
  for (const [sortOrder, id] of orderedIds.entries()) {
    await db.update(apps).set({ sortOrder }).where(eq(apps.id, id))
  }
}
