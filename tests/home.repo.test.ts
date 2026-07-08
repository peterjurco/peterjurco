import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { homeTiles } from '../src/db/schema'
import {
  bulkUpsertLayout,
  createTile,
  deleteTile,
  listOrdered,
  updateTile,
} from '../src/lib/home/repo'
import { createTestDb } from './helpers/test-db'

const { db, close } = createTestDb()

beforeEach(async () => {
  await db.delete(homeTiles)
})

afterAll(async () => {
  await close()
})

/** A complete photo-tile record — every layout field exercised. */
const PHOTO_TILE = {
  kind: 'photo' as const,
  imageKey: 'home/redhouse.webp',
  x: 2.5,
  y: 1,
  width: 48,
  height: 22.5,
  rotation: 0,
  border: { width: 4, color: '#f0e7d3' },
  hoverEffect: 'develop',
  zIndex: 1,
  cycleGroup: null,
}

const QUOTE_TILE = {
  kind: 'quote' as const,
  textContent: 'Everything has led to this',
  cite: '— on the road, somewhere north',
  x: 60,
  y: 10,
  width: 30,
  height: 15,
  rotation: -1.6,
  zIndex: 5,
}

describe('createTile / updateTile / deleteTile', () => {
  it('creates a photo tile with every field and round-trips numerics as numbers', async () => {
    const tile = await createTile(db, PHOTO_TILE)
    expect(tile.id).toBeGreaterThan(0)
    expect(tile.kind).toBe('photo')
    expect(tile.imageKey).toBe('home/redhouse.webp')
    expect(tile.textContent).toBeNull()
    expect(tile.x).toBe(2.5)
    expect(tile.y).toBe(1)
    expect(tile.width).toBe(48)
    expect(tile.height).toBe(22.5)
    expect(tile.rotation).toBe(0)
    expect(tile.border).toEqual({ width: 4, color: '#f0e7d3' })
    expect(tile.hoverEffect).toBe('develop')
    expect(tile.zIndex).toBe(1)
    expect(tile.cycleGroup).toBeNull()
  })

  it('creates a quote tile with text and cite', async () => {
    const tile = await createTile(db, QUOTE_TILE)
    expect(tile.kind).toBe('quote')
    expect(tile.textContent).toBe('Everything has led to this')
    expect(tile.cite).toBe('— on the road, somewhere north')
    expect(tile.rotation).toBe(-1.6)
    expect(tile.imageKey).toBeNull()
    expect(tile.border).toBeNull()
    expect(tile.hoverEffect).toBeNull()
  })

  it('patches fields independently; border and cycleGroup are clearable', async () => {
    const tile = await createTile(db, PHOTO_TILE)

    const moved = await updateTile(db, tile.id, { x: 10, y: 20, rotation: 3 })
    expect(moved?.x).toBe(10)
    expect(moved?.y).toBe(20)
    expect(moved?.rotation).toBe(3)
    expect(moved?.width).toBe(48) // untouched

    const cleared = await updateTile(db, tile.id, {
      border: null,
      hoverEffect: 'none',
      cycleGroup: 'north',
    })
    expect(cleared?.border).toBeNull()
    expect(cleared?.hoverEffect).toBe('none')
    expect(cleared?.cycleGroup).toBe('north')
  })

  it('bumps updated_at on update', async () => {
    const tile = await createTile(db, PHOTO_TILE)
    await new Promise((resolve) => setTimeout(resolve, 5))
    const updated = await updateTile(db, tile.id, { x: 11 })
    expect(updated).not.toBeNull()
    if (!updated) return
    expect(updated.updatedAt.getTime()).toBeGreaterThan(
      tile.updatedAt.getTime(),
    )
  })

  it('returns null / false for missing tiles', async () => {
    expect(await updateTile(db, 999999, { x: 1 })).toBeNull()
    expect(await deleteTile(db, 999999)).toBe(false)
  })

  it('deletes a tile', async () => {
    const tile = await createTile(db, PHOTO_TILE)
    expect(await deleteTile(db, tile.id)).toBe(true)
    expect(await listOrdered(db)).toEqual([])
  })
})

describe('listOrdered', () => {
  it('returns tiles sorted by z_index ascending, id breaking ties', async () => {
    const top = await createTile(db, { ...PHOTO_TILE, zIndex: 9 })
    const bottom = await createTile(db, { ...PHOTO_TILE, zIndex: 1 })
    const tieA = await createTile(db, { ...PHOTO_TILE, zIndex: 5 })
    const tieB = await createTile(db, { ...PHOTO_TILE, zIndex: 5 })

    const ordered = await listOrdered(db)
    expect(ordered.map((tile) => tile.id)).toEqual([
      bottom.id,
      tieA.id,
      tieB.id,
      top.id,
    ])
  })
})

describe('bulkUpsertLayout — the full-canvas editor save', () => {
  it('updates existing tiles, inserts new ones, deletes missing ones', async () => {
    const keep = await createTile(db, PHOTO_TILE)
    const drop = await createTile(db, { ...QUOTE_TILE, zIndex: 2 })

    const saved = await bulkUpsertLayout(db, [
      // keep — moved and re-stacked
      { ...PHOTO_TILE, id: keep.id, x: 33, zIndex: 4 },
      // brand new quote (no id)
      { ...QUOTE_TILE, zIndex: 1 },
    ])

    expect(saved).toHaveLength(2)
    const ids = saved.map((tile) => tile.id)
    expect(ids).toContain(keep.id)
    expect(ids).not.toContain(drop.id)

    // Returned in z order: the new quote (z=1) before the moved photo (z=4).
    expect(saved[0]?.kind).toBe('quote')
    expect(saved[1]?.id).toBe(keep.id)
    expect(saved[1]?.x).toBe(33)
    expect(saved[1]?.zIndex).toBe(4)

    // And the DB agrees.
    const persisted = await listOrdered(db)
    expect(persisted.map((tile) => tile.id)).toEqual(ids)
  })

  it('treats the array as the complete canvas — empty array clears it', async () => {
    await createTile(db, PHOTO_TILE)
    await createTile(db, QUOTE_TILE)
    const saved = await bulkUpsertLayout(db, [])
    expect(saved).toEqual([])
    expect(await listOrdered(db)).toEqual([])
  })

  it('ignores stale ids that no longer exist instead of failing the save', async () => {
    const real = await createTile(db, PHOTO_TILE)
    const saved = await bulkUpsertLayout(db, [
      { ...PHOTO_TILE, id: real.id, x: 7 },
      { ...QUOTE_TILE, id: 999999 }, // deleted in another tab
    ])
    expect(saved).toHaveLength(1)
    expect(saved[0]?.x).toBe(7)
  })
})
