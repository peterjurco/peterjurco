import { asc, eq } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from '../../db/schema'
import { apps } from '../../db/schema'

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
): Promise<App | null> {
  const [app] = await db
    .update(apps)
    .set(patch)
    .where(eq(apps.id, id))
    .returning()
  return app ?? null
}

export async function deleteApp(db: AppsDb, id: number): Promise<void> {
  await db.delete(apps).where(eq(apps.id, id))
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
