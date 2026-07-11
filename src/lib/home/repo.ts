import { asc, eq, notInArray } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from '../../db/schema'
import { homeTiles } from '../../db/schema'
import { deleteObject, type R2Env } from '../media/r2'
import type { TileBorder } from './canvas'

/**
 * Home-tiles repository (DATA_MODEL §5, REQUIREMENTS "Public section"): the
 * public homepage is a freeform canvas of absolutely-positioned photo/quote
 * tiles; each row stores the full per-tile layout. Coordinates are
 * percentages of a fixed-aspect canvas — the contract lives in
 * src/lib/home/canvas.ts and is shared by the editor and the renderer.
 *
 * INVARIANT — no interactive transactions (see src/lib/articles/repo.ts):
 * production runs on the Neon HTTP driver, so `bulkUpsertLayout` executes as
 * ordered, independent statements (delete missing → update existing → insert
 * new). A crash mid-save can leave a partial layout; the editor's next save
 * re-writes the complete canvas, so the state is self-healing.
 */

/** Any Drizzle Postgres client over our schema (prod neon-http or test pg). */
export type HomeDb = PgDatabase<PgQueryResultHKT, typeof schema>

export type HomeTile = Omit<typeof homeTiles.$inferSelect, 'border'> & {
  border: TileBorder | null
}

/** Everything the editor sets on a tile — id-less; layout plus content. */
export interface TileValues {
  kind: 'photo' | 'quote'
  /** Ordered R2 object keys — for `photo` tiles. */
  imageKeys?: string[]
  textContent?: string | null
  cite?: string | null
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  border?: TileBorder | null
  hoverEffect?: string | null
  zIndex: number
  /** ms per image while cycling; null = CycleGroup's default. Meaningful
   *  only when imageKeys.length > 1. */
  cycleIntervalMs?: number | null
}

/** A full-canvas save entry: existing tiles carry their id, new ones don't. */
export type LayoutTile = TileValues & { id?: number }

/** Bottom-of-stack first; `id ASC` breaks z ties by insertion order. */
const stackingOrder = [asc(homeTiles.zIndex), asc(homeTiles.id)] as const

/**
 * Best-effort R2 cleanup for image keys a DB write above already dropped.
 * Callers only ever invoke this AFTER the write that dropped the keys has
 * already succeeded (see the INVARIANT docblock above) — so a key passed
 * here is never at risk of still being referenced. Never throws: a failed
 * delete is logged and swallowed, because the row is already correct (the
 * source of truth) — a lingering image in the bucket is a space
 * optimization, not a correctness guarantee (TODO.md).
 */
async function deleteOrphanedImages(env: R2Env, keys: string[]): Promise<void> {
  await Promise.all(
    keys.map((key) =>
      deleteObject(env, key).catch((error) => {
        console.error(`Failed to delete orphaned R2 object ${key}:`, error)
      }),
    ),
  )
}

export async function createTile(
  db: HomeDb,
  values: TileValues,
): Promise<HomeTile> {
  const [tile] = await db.insert(homeTiles).values(values).returning()
  if (!tile) throw new Error('Tile insert returned no row')
  return tile as HomeTile
}

/** One tile by id, or null — lets PATCH validate the merged row pre-write. */
export async function getTile(
  db: HomeDb,
  id: number,
): Promise<HomeTile | null> {
  const [tile] = await db.select().from(homeTiles).where(eq(homeTiles.id, id))
  return (tile as HomeTile | undefined) ?? null
}

/** Partial update; `border: null` / `cycleIntervalMs: null` clear. Null = missing. */
export async function updateTile(
  db: HomeDb,
  id: number,
  patch: Partial<TileValues>,
  env: R2Env,
): Promise<HomeTile | null> {
  // Read BEFORE the write — the only way to know which images the patch is
  // about to drop (UPDATE ... RETURNING only ever gives the NEW row).
  const previousImageKeys =
    'imageKeys' in patch ? (await getTile(db, id))?.imageKeys : undefined

  const [tile] = await db
    .update(homeTiles)
    .set(patch)
    .where(eq(homeTiles.id, id))
    .returning()
  if (!tile) return null

  // R2 cleanup runs only now that the update above has actually succeeded
  // (see INVARIANT docblock). Only images DROPPED from the array are
  // deleted (set difference) — reordering the same keys must never delete
  // anything.
  if (previousImageKeys !== undefined) {
    const kept = new Set(patch.imageKeys)
    const dropped = previousImageKeys.filter((key) => !kept.has(key))
    await deleteOrphanedImages(env, dropped)
  }

  return tile as HomeTile
}

/** True when a row was deleted — doubles as the handler's existence check. */
export async function deleteTile(
  db: HomeDb,
  id: number,
  env: R2Env,
): Promise<boolean> {
  const deleted = await db
    .delete(homeTiles)
    .where(eq(homeTiles.id, id))
    .returning({ id: homeTiles.id, imageKeys: homeTiles.imageKeys })
  if (deleted.length === 0) return false

  // Best-effort R2 cleanup, run only after the delete above already
  // succeeded — see deleteOrphanedImages docblock.
  const row = deleted[0]
  if (row) await deleteOrphanedImages(env, row.imageKeys)
  return true
}

/** The whole canvas, bottom of the stack first — for renderer and editor. */
export async function listOrdered(db: HomeDb): Promise<HomeTile[]> {
  const tiles = await db
    .select()
    .from(homeTiles)
    .orderBy(...stackingOrder)
  return tiles as HomeTile[]
}

/**
 * Persists a full editor save: the passed array IS the complete canvas.
 * Tiles with an id are updated (one statement each — every row gets its own
 * values), tiles without one are inserted in a single batched insert in
 * array order (identity ids stay ascending, preserving the z-tie ordering),
 * and rows whose ids are absent from the array are deleted. Stale ids
 * (deleted in another tab) are skipped, never re-created. Returns the saved
 * canvas in stacking order.
 */
export async function bulkUpsertLayout(
  db: HomeDb,
  tiles: LayoutTile[],
  env: R2Env,
): Promise<HomeTile[]> {
  const keptIds = tiles
    .map((tile) => tile.id)
    .filter((id): id is number => id !== undefined)

  // Snapshot of every existing tile's imageKeys, read BEFORE any write below —
  // it's how we later know (a) which fully-removed tiles' images to delete
  // and (b) each kept tile's OLD imageKeys, to diff against its new array.
  const before = await db
    .select({ id: homeTiles.id, imageKeys: homeTiles.imageKeys })
    .from(homeTiles)
  const previousImageKeysById = new Map(
    before.map((row) => [row.id, row.imageKeys]),
  )

  if (keptIds.length > 0) {
    await db.delete(homeTiles).where(notInArray(homeTiles.id, keptIds))
  } else {
    await db.delete(homeTiles)
  }

  const inserts: TileValues[] = []
  for (const tile of tiles) {
    const { id, ...values } = tile
    if (id === undefined) {
      inserts.push(values)
    } else {
      await db.update(homeTiles).set(values).where(eq(homeTiles.id, id))
    }
  }
  if (inserts.length > 0) {
    await db.insert(homeTiles).values(inserts)
  }

  // R2 cleanup, run only now that every write above has succeeded (see
  // INVARIANT docblock): fully-removed tiles (id was in the old set but not
  // in `tiles`) lose every image they had; kept/updated tiles lose only the
  // images that DROPPED from their array (set difference) — a reorder-only
  // save keeps the same keys and deletes nothing.
  const keptIdSet = new Set(keptIds)
  const orphanedKeys: string[] = []
  for (const [id, imageKeys] of previousImageKeysById) {
    if (!keptIdSet.has(id)) orphanedKeys.push(...imageKeys)
  }
  for (const tile of tiles) {
    if (tile.id === undefined) continue
    const previousImageKeys = previousImageKeysById.get(tile.id)
    if (previousImageKeys === undefined) continue // stale id — already skipped
    const kept = new Set(tile.imageKeys ?? [])
    for (const key of previousImageKeys) {
      if (!kept.has(key)) orphanedKeys.push(key)
    }
  }
  await deleteOrphanedImages(env, orphanedKeys)

  return listOrdered(db)
}
