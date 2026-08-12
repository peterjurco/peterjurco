import { existsSync, readFileSync, rmSync } from 'node:fs'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MigrationReport } from '../../scripts/migrate-wp/import'
import { runMigration } from '../../scripts/migrate-wp/import'
import { articles } from '../../src/db/schema'
import type { R2Env } from '../../src/lib/media/r2'
import { createTestDb } from '../helpers/test-db'
import {
  createTestWpConnection,
  insertWpPost,
  resetWpSchema,
} from '../helpers/test-wp-db'

/**
 * Fix for "no report at all if the run crashes partway through": import.ts
 * must flush the report incrementally, not only after the whole loop
 * completes, so a thrown error mid-run still leaves an accurate report for
 * everything processed before the crash. `createMigratedArticle` is mocked
 * (real implementation for the first post, then a forced throw) — this is
 * the standard case the fix targets: "DB blip, unexpected edge case".
 */
vi.mock('../../src/lib/articles/repo', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/lib/articles/repo')>()
  return { ...actual, createMigratedArticle: vi.fn() }
})

const { createMigratedArticle } = await import('../../src/lib/articles/repo')

const wpConn = createTestWpConnection()
const { db, close } = createTestDb()

const OWNED_HOST = 'peterjur.co'
const r2Env: R2Env = {
  R2_ACCOUNT_ID: 'unused-local',
  R2_ACCESS_KEY_ID: 'minioadmin',
  R2_SECRET_ACCESS_KEY: 'minioadmin',
  R2_BUCKET: 'peterjurco-test',
  R2_ENDPOINT: 'http://localhost:9000',
}

const REPORT_PATH = new URL('./.tmp-crash-report.json', import.meta.url)
  .pathname

beforeEach(async () => {
  await resetWpSchema(wpConn)
  await db.delete(articles)
  vi.mocked(createMigratedArticle).mockReset()
  rmSync(REPORT_PATH, { force: true })
})

afterAll(async () => {
  rmSync(REPORT_PATH, { force: true })
  await wpConn.end()
  await close()
})

describe('runMigration — crash mid-run', () => {
  it('leaves a report reflecting posts processed before a thrown error', async () => {
    await insertWpPost(wpConn, {
      id: 1,
      title: 'Survives',
      content: '',
      status: 'publish',
    })
    await insertWpPost(wpConn, {
      id: 2,
      title: 'Crashes here',
      content: '',
      status: 'publish',
    })
    await insertWpPost(wpConn, {
      id: 3,
      title: 'Never reached',
      content: '',
      status: 'publish',
    })

    const actual = await vi.importActual<
      typeof import('../../src/lib/articles/repo')
    >('../../src/lib/articles/repo')

    vi.mocked(createMigratedArticle)
      .mockImplementationOnce(actual.createMigratedArticle)
      .mockImplementationOnce(async () => {
        throw new Error('simulated DB blip')
      })

    await expect(
      runMigration({
        wpConn,
        db,
        apply: true,
        r2Env,
        ownedHost: OWNED_HOST,
        publicImageBaseUrl: 'http://localhost:9000/peterjurco-test',
        reportPath: REPORT_PATH,
      }),
    ).rejects.toThrow('simulated DB blip')

    expect(existsSync(REPORT_PATH)).toBe(true)
    const report = JSON.parse(
      readFileSync(REPORT_PATH, 'utf-8'),
    ) as MigrationReport

    // Post 1 made it all the way through before post 2 threw.
    expect(report.created).toBe(1)
    expect(report.updated).toBe(0)
    // Post 3 was never reached by the loop.
    expect(createMigratedArticle).toHaveBeenCalledTimes(2)
  })
})
