import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { apps } from '../src/db/schema'
import {
  appExists,
  createApp,
  deleteApp,
  listOrdered,
  nextSortOrder,
  updateApp,
} from '../src/lib/apps/repo'
import { createTestDb } from './helpers/test-db'

const { db, close } = createTestDb()

beforeEach(async () => {
  await db.delete(apps)
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

    const renamed = await updateApp(db, app.id, { name: 'Renamed' })
    expect(renamed?.name).toBe('Renamed')
    expect(renamed?.url).toBe('https://example.com')

    const reordered = await updateApp(db, app.id, { sortOrder: 5 })
    expect(reordered?.sortOrder).toBe(5)

    const cleared = await updateApp(db, app.id, { iconKey: null })
    expect(cleared?.iconKey).toBeNull()
  })

  it('returns null when the app does not exist', async () => {
    expect(await updateApp(db, 999999, { name: 'ghost' })).toBeNull()
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
    await deleteApp(db, app.id)
    expect(await appExists(db, app.id)).toBe(false)
  })

  it('appExists is false for unknown ids', async () => {
    expect(await appExists(db, 999999)).toBe(false)
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

    await updateApp(db, first.id, { sortOrder: 1 })
    await updateApp(db, second.id, { sortOrder: 0 })

    const ordered = await listOrdered(db)
    expect(ordered.map((app) => app.id)).toEqual([second.id, first.id])
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
