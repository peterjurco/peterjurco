import { asc, eq, notInArray } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from '../../db/schema'
import { homeTiles } from '../../db/schema'
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
  imageKey?: string | null
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
  cycleGroup?: string | null
}

/** A full-canvas save entry: existing tiles carry their id, new ones don't. */
export type LayoutTile = TileValues & { id?: number }

/** Bottom-of-stack first; `id ASC` breaks z ties by insertion order. */
const stackingOrder = [asc(homeTiles.zIndex), asc(homeTiles.id)] as const

export async function createTile(
  db: HomeDb,
  values: TileValues,
): Promise<HomeTile> {
  const [tile] = await db.insert(homeTiles).values(values).returning()
  if (!tile) throw new Error('Tile insert returned no row')
  return tile as HomeTile
}

/** Partial update; `border: null` / `cycleGroup: null` clear. Null = missing. */
export async function updateTile(
  db: HomeDb,
  id: number,
  patch: Partial<TileValues>,
): Promise<HomeTile | null> {
  const [tile] = await db
    .update(homeTiles)
    .set(patch)
    .where(eq(homeTiles.id, id))
    .returning()
  return (tile as HomeTile | undefined) ?? null
}

/** True when a row was deleted — doubles as the handler's existence check. */
export async function deleteTile(db: HomeDb, id: number): Promise<boolean> {
  const deleted = await db
    .delete(homeTiles)
    .where(eq(homeTiles.id, id))
    .returning({ id: homeTiles.id })
  return deleted.length > 0
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
 * Tiles with an id are updated, tiles without one are inserted, and rows
 * whose ids are absent from the array are deleted. Stale ids (deleted in
 * another tab) are skipped, never re-created. Returns the saved canvas in
 * stacking order.
 */
export async function bulkUpsertLayout(
  db: HomeDb,
  tiles: LayoutTile[],
): Promise<HomeTile[]> {
  const keptIds = tiles
    .map((tile) => tile.id)
    .filter((id): id is number => id !== undefined)

  if (keptIds.length > 0) {
    await db.delete(homeTiles).where(notInArray(homeTiles.id, keptIds))
  } else {
    await db.delete(homeTiles)
  }

  for (const tile of tiles) {
    const { id, ...values } = tile
    if (id === undefined) {
      await db.insert(homeTiles).values(values)
    } else {
      await db.update(homeTiles).set(values).where(eq(homeTiles.id, id))
    }
  }

  return listOrdered(db)
}
