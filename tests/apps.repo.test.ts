import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { apps } from '../src/db/schema'
import {
  appExists,
  createApp,
  deleteApp,
  listOrdered,
  nextSortOrder,
  reorderApps,
  updateApp,
} from '../src/lib/apps/repo'
import { deleteObject } from '../src/lib/media/r2'
import { createTestDb } from './helpers/test-db'

vi.mock('../src/lib/media/r2', () => ({
  deleteObject: vi.fn().mockResolvedValue(undefined),
}))

const { db, close } = createTestDb()

// R2 credentials are irrelevant — deleteObject is mocked above, so no real
// network call is ever made.
const R2_ENV = {}

beforeEach(async () => {
  await db.delete(apps)
  vi.mocked(deleteObject).mockReset().mockResolvedValue(undefined)
})

afterAll(async () => {
  await close()
})

describe('createApp / updateApp', () => {
  it('creates an app with name, url and sort order', async () => {
    const app = await createApp(db, {
      name: 'Feedbin',
      url: 'https://feedbin.com',
      sortOrder: 0,
    })
    expect(app.id).toBeGreaterThan(0)
    expect(app.name).toBe('Feedbin')
    expect(app.url).toBe('https://feedbin.com')
    expect(app.sortOrder).toBe(0)
    expect(app.iconKey).toBeNull()
  })

  it('creates with an optional icon key', async () => {
    const app = await createApp(db, {
      name: 'Icon app',
      url: 'https://example.com',
      iconKey: 'covers/icon.png',
      sortOrder: 1,
    })
    expect(app.iconKey).toBe('covers/icon.png')
  })

  it('patches fields independently, and clears the icon with null', async () => {
    const app = await createApp(db, {
      name: 'Original',
      url: 'https://example.com',
      iconKey: 'covers/a.png',
      sortOrder: 0,
    })

    const renamed = await updateApp(db, app.id, { name: 'Renamed' }, R2_ENV)
    expect(renamed?.name).toBe('Renamed')
    expect(renamed?.url).toBe('https://example.com')

    const reordered = await updateApp(db, app.id, { sortOrder: 5 }, R2_ENV)
    expect(reordered?.sortOrder).toBe(5)

    const cleared = await updateApp(db, app.id, { iconKey: null }, R2_ENV)
    expect(cleared?.iconKey).toBeNull()
  })

  it('returns null when the app does not exist', async () => {
    expect(await updateApp(db, 999999, { name: 'ghost' }, R2_ENV)).toBeNull()
    expect(deleteObject).not.toHaveBeenCalled()
  })
})

describe('deleteApp / appExists', () => {
  it('removes the app', async () => {
    const app = await createApp(db, {
      name: 'Doomed',
      url: 'https://example.com',
      sortOrder: 0,
    })
    expect(await appExists(db, app.id)).toBe(true)
    await deleteApp(db, app.id, R2_ENV)
    expect(await appExists(db, app.id)).toBe(false)
  })

  it('appExists is false for unknown ids', async () => {
    expect(await appExists(db, 999999)).toBe(false)
  })
})

describe('R2 cleanup on icon removal/replacement', () => {
  it('deletes the icon when the app is deleted', async () => {
    const app = await createApp(db, {
      name: 'Doomed',
      url: 'https://example.com',
      iconKey: 'covers/icon.png',
      sortOrder: 0,
    })
    await deleteApp(db, app.id, R2_ENV)
    expect(deleteObject).toHaveBeenCalledExactlyOnceWith(
      R2_ENV,
      'covers/icon.png',
    )
  })

  it('does not call R2 when the deleted app had no icon', async () => {
    const app = await createApp(db, {
      name: 'No icon',
      url: 'https://example.com',
      sortOrder: 0,
    })
    await deleteApp(db, app.id, R2_ENV)
    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('deletes the OLD icon when it is replaced', async () => {
    const app = await createApp(db, {
      name: 'Icon app',
      url: 'https://example.com',
      iconKey: 'covers/old.png',
      sortOrder: 0,
    })
    await updateApp(db, app.id, { iconKey: 'covers/new.png' }, R2_ENV)
    expect(deleteObject).toHaveBeenCalledExactlyOnceWith(
      R2_ENV,
      'covers/old.png',
    )
  })

  it('deletes the OLD icon when it is explicitly cleared to null', async () => {
    const app = await createApp(db, {
      name: 'Icon app',
      url: 'https://example.com',
      iconKey: 'covers/old.png',
      sortOrder: 0,
    })
    await updateApp(db, app.id, { iconKey: null }, R2_ENV)
    expect(deleteObject).toHaveBeenCalledExactlyOnceWith(
      R2_ENV,
      'covers/old.png',
    )
  })

  it('does not call R2 when the patch never touches iconKey', async () => {
    const app = await createApp(db, {
      name: 'Icon app',
      url: 'https://example.com',
      iconKey: 'covers/old.png',
      sortOrder: 0,
    })
    await updateApp(db, app.id, { name: 'Renamed' }, R2_ENV)
    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('deletes the app even when R2 cleanup fails — best-effort, not a hard requirement', async () => {
    vi.mocked(deleteObject).mockRejectedValue(new Error('R2 unreachable'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const app = await createApp(db, {
      name: 'Doomed',
      url: 'https://example.com',
      iconKey: 'covers/icon.png',
      sortOrder: 0,
    })
    await expect(deleteApp(db, app.id, R2_ENV)).resolves.toBeUndefined()
    expect(await appExists(db, app.id)).toBe(false)
    expect(consoleError).toHaveBeenCalled()

    consoleError.mockRestore()
  })

  it('updates the app even when R2 cleanup fails — best-effort, not a hard requirement', async () => {
    vi.mocked(deleteObject).mockRejectedValue(new Error('R2 unreachable'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const app = await createApp(db, {
      name: 'Icon app',
      url: 'https://example.com',
      iconKey: 'covers/old.png',
      sortOrder: 0,
    })
    const updated = await updateApp(
      db,
      app.id,
      { iconKey: 'covers/new.png' },
      R2_ENV,
    )
    expect(updated?.iconKey).toBe('covers/new.png')
    expect(consoleError).toHaveBeenCalled()

    consoleError.mockRestore()
  })
})

describe('listOrdered', () => {
  it('orders by sort_order ascending, id breaking ties', async () => {
    const c = await createApp(db, {
      name: 'C',
      url: 'https://c.com',
      sortOrder: 2,
    })
    const a = await createApp(db, {
      name: 'A',
      url: 'https://a.com',
      sortOrder: 0,
    })
    const b1 = await createApp(db, {
      name: 'B1',
      url: 'https://b1.com',
      sortOrder: 1,
    })
    const b2 = await createApp(db, {
      name: 'B2',
      url: 'https://b2.com',
      sortOrder: 1,
    })

    const ordered = await listOrdered(db)
    expect(ordered.map((app) => app.id)).toEqual([a.id, b1.id, b2.id, c.id])
  })

  it('returns an empty list when there are no apps', async () => {
    expect(await listOrdered(db)).toEqual([])
  })

  it('reflects a swap after two updates (reorder use case)', async () => {
    const first = await createApp(db, {
      name: 'First',
      url: 'https://first.com',
      sortOrder: 0,
    })
    const second = await createApp(db, {
      name: 'Second',
      url: 'https://second.com',
      sortOrder: 1,
    })

    await updateApp(db, first.id, { sortOrder: 1 }, R2_ENV)
    await updateApp(db, second.id, { sortOrder: 0 }, R2_ENV)

    const ordered = await listOrdered(db)
    expect(ordered.map((app) => app.id)).toEqual([second.id, first.id])
  })
})

describe('reorderApps', () => {
  it('rewrites sort_order to match the array index for every id', async () => {
    const first = await createApp(db, {
      name: 'First',
      url: 'https://first.com',
      sortOrder: 0,
    })
    const second = await createApp(db, {
      name: 'Second',
      url: 'https://second.com',
      sortOrder: 1,
    })
    const third = await createApp(db, {
      name: 'Third',
      url: 'https://third.com',
      sortOrder: 2,
    })

    await reorderApps(db, [third.id, first.id, second.id])

    const ordered = await listOrdered(db)
    expect(ordered.map((app) => app.id)).toEqual([
      third.id,
      first.id,
      second.id,
    ])
    expect(ordered.map((app) => app.sortOrder)).toEqual([0, 1, 2])
  })
})

describe('nextSortOrder', () => {
  it('is 0 when there are no apps', async () => {
    expect(await nextSortOrder(db)).toBe(0)
  })

  it('is one past the current highest sort order', async () => {
    await createApp(db, { name: 'A', url: 'https://a.com', sortOrder: 0 })
    await createApp(db, { name: 'B', url: 'https://b.com', sortOrder: 4 })
    expect(await nextSortOrder(db)).toBe(5)
  })
})
