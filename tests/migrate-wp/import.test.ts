import { rmSync } from 'node:fs'
import { AwsClient } from 'aws4fetch'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigration } from '../../scripts/migrate-wp/import'
import {
  articleCategories,
  articles,
  articleTags,
  articleTagsMap,
} from '../../src/db/schema'
import { createCategory, getByLegacyWpId } from '../../src/lib/articles/repo'
import type { R2Env } from '../../src/lib/media/r2'
import { createTestDb } from '../helpers/test-db'
import {
  createTestWpConnection,
  insertWpPost,
  insertWpTerm,
  resetWpSchema,
  setWpFeaturedImage,
} from '../helpers/test-wp-db'

/**
 * Exercises the import orchestrator end-to-end against real Postgres (test
 * DB) and a real disposable MySQL double for WP, with a real MinIO R2 stand-
 * in for image rehosting. Only the "fetch from the old WP site" step is
 * mocked (someone else's server) — everything else is real.
 */

const wpConn = createTestWpConnection()
const { db, close } = createTestDb()

const OWNED_HOST = 'peterjur.co'
const MINIO_ENDPOINT = 'http://localhost:9000'
const BUCKET = 'peterjurco-test'
const IMG_BASE = `${MINIO_ENDPOINT}/${BUCKET}`

const r2Env: R2Env = {
  R2_ACCOUNT_ID: 'unused-local',
  R2_ACCESS_KEY_ID: 'minioadmin',
  R2_SECRET_ACCESS_KEY: 'minioadmin',
  R2_BUCKET: BUCKET,
  R2_ENDPOINT: MINIO_ENDPOINT,
}

const minio = new AwsClient({
  accessKeyId: 'minioadmin',
  secretAccessKey: 'minioadmin',
  service: 's3',
  region: 'auto',
})

async function ensureBucket(): Promise<void> {
  const bucket = await minio.fetch(`${MINIO_ENDPOINT}/${BUCKET}`, {
    method: 'PUT',
  })
  if (!bucket.ok && bucket.status !== 409) {
    throw new Error(
      `MinIO bucket create failed (${bucket.status}) — is MinIO up? ` +
        'docker compose -f docker-compose.test.yml up -d',
    )
  }
}

/** Fake fetch for the "old WP site" — succeeds for image URLs, fails for `/missing/`. */
function fakeWpFetch(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/missing/')) {
      return new Response('not found', { status: 404 })
    }
    return new Response(new Uint8Array([1, 2, 3, 4]) as BodyInit, {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    })
  }) as unknown as typeof fetch
}

async function resetPostgres(): Promise<void> {
  await db.delete(articleTagsMap)
  await db.delete(articles)
  await db.delete(articleTags)
  await db.delete(articleCategories)
}

const CACHE_PATH = new URL('./.tmp-import-cache.json', import.meta.url).pathname

beforeEach(async () => {
  await ensureBucket()
  await resetWpSchema(wpConn)
  await resetPostgres()
  rmSync(CACHE_PATH, { force: true })
})

afterAll(async () => {
  rmSync(CACHE_PATH, { force: true })
  await wpConn.end()
  await close()
})

describe('runMigration — dry-run', () => {
  it('makes zero writes and never fetches or uploads images, even for URLs that would succeed', async () => {
    await insertWpPost(wpConn, {
      id: 1,
      title: 'Single category post',
      content:
        '<p>Hello</p><img src="https://peterjur.co/wp-content/uploads/a.jpg">',
      status: 'publish',
    })
    await insertWpTerm(wpConn, 10, 'category', 'Travel', [1])
    await setWpFeaturedImage(
      wpConn,
      1,
      99,
      'https://peterjur.co/wp-content/uploads/cover.jpg',
    )

    const fetchSource = fakeWpFetch()
    const report = await runMigration({
      wpConn,
      db,
      apply: false,
      r2Env,
      ownedHost: OWNED_HOST,
      fetchSource,
    })

    expect(fetchSource).not.toHaveBeenCalled()
    expect(await db.select().from(articles)).toHaveLength(0)
    expect(await db.select().from(articleCategories)).toHaveLength(0)
    expect(await db.select().from(articleTags)).toHaveLength(0)

    expect(report.mode).toBe('dry-run')
    expect(report.totalPosts).toBe(1)
    expect(report.created).toBe(1)
    expect(report.updated).toBe(0)
    expect(report.inlineImages).toEqual([
      {
        postId: 1,
        sourceUrl: 'https://peterjur.co/wp-content/uploads/a.jpg',
        status: 'would-rehost',
      },
    ])
    expect(report.featuredImages).toEqual([
      {
        postId: 1,
        sourceUrl: 'https://peterjur.co/wp-content/uploads/cover.jpg',
        status: 'would-rehost',
      },
    ])
  })

  it('flags multi-category posts without touching the database', async () => {
    await insertWpPost(wpConn, {
      id: 1,
      title: 'Two cats',
      content: '',
      status: 'publish',
    })
    await insertWpTerm(wpConn, 10, 'category', 'Travel', [1])
    await insertWpTerm(wpConn, 11, 'category', 'Food', [1])

    const report = await runMigration({
      wpConn,
      db,
      apply: false,
      r2Env,
      ownedHost: OWNED_HOST,
    })

    expect(report.multiCategoryPosts).toEqual([
      { wpId: 1, title: 'Two cats', categories: ['Travel', 'Food'] },
    ])
  })

  it('reports existing (previously-imported) posts as updates, not creates', async () => {
    await insertWpPost(wpConn, {
      id: 1,
      title: 'Already imported',
      content: '',
      status: 'publish',
    })
    await runMigration({
      wpConn,
      db,
      apply: true,
      r2Env,
      ownedHost: OWNED_HOST,
      publicImageBaseUrl: IMG_BASE,
    })

    const report = await runMigration({
      wpConn,
      db,
      apply: false,
      r2Env,
      ownedHost: OWNED_HOST,
    })
    expect(report.created).toBe(0)
    expect(report.updated).toBe(1)
  })

  it('classifies external (non-owned) inline images without ever fetching them', async () => {
    await insertWpPost(wpConn, {
      id: 1,
      title: 'External image',
      content: '<p><img src="https://example.com/photo.jpg"></p>',
      status: 'publish',
    })
    const fetchSource = fakeWpFetch()
    const report = await runMigration({
      wpConn,
      db,
      apply: false,
      r2Env,
      ownedHost: OWNED_HOST,
      fetchSource,
    })
    expect(fetchSource).not.toHaveBeenCalled()
    expect(report.inlineImages).toEqual([
      {
        postId: 1,
        sourceUrl: 'https://example.com/photo.jpg',
        status: 'external',
      },
    ])
  })
})

describe('runMigration — apply', () => {
  it('creates a private article with WP dates preserved, regardless of WP post_status', async () => {
    await insertWpPost(wpConn, {
      id: 1,
      title: 'Publish status',
      content: '<p>Body</p>',
      status: 'publish',
      date: '2016-05-01 12:00:00',
      modified: '2016-05-02 13:00:00',
    })
    await insertWpPost(wpConn, {
      id: 2,
      title: 'Draft status',
      content: '<p>Body</p>',
      status: 'draft',
    })
    await insertWpPost(wpConn, {
      id: 3,
      title: 'Private status',
      content: '<p>Body</p>',
      status: 'private',
    })

    await runMigration({
      wpConn,
      db,
      apply: true,
      r2Env,
      ownedHost: OWNED_HOST,
      publicImageBaseUrl: IMG_BASE,
    })

    const rows = await db.select().from(articles)
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row.visibility).toBe('private')

    const published = rows.find((row) => row.title === 'Publish status')
    expect(published?.createdAt.toISOString()).toBe('2016-05-01T12:00:00.000Z')
    expect(published?.updatedAt.toISOString()).toBe('2016-05-02T13:00:00.000Z')
  })

  it('is idempotent by legacy_wp_id: running --apply twice never duplicates rows', async () => {
    await insertWpPost(wpConn, {
      id: 1,
      title: 'v1',
      content: '<p>A</p>',
      status: 'publish',
    })
    await insertWpTerm(wpConn, 10, 'category', 'Travel', [1])
    await insertWpTerm(wpConn, 20, 'post_tag', 'hiking', [1])

    await runMigration({
      wpConn,
      db,
      apply: true,
      r2Env,
      ownedHost: OWNED_HOST,
      publicImageBaseUrl: IMG_BASE,
    })

    // The dump gets a title edit and re-runs (post_modified changes too).
    await wpConn.query(
      'UPDATE wp_posts SET post_title = ?, post_modified = ? WHERE ID = 1',
      ['v2', '2021-01-01 00:00:00'],
    )

    const secondReport = await runMigration({
      wpConn,
      db,
      apply: true,
      r2Env,
      ownedHost: OWNED_HOST,
      publicImageBaseUrl: IMG_BASE,
    })

    expect(secondReport.created).toBe(0)
    expect(secondReport.updated).toBe(1)

    const rows = await db.select().from(articles)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.title).toBe('v2')
    expect(rows[0]?.updatedAt.toISOString()).toBe('2021-01-01T00:00:00.000Z')

    // Taxonomy is idempotent too — no duplicate category/tag rows.
    expect(await db.select().from(articleCategories)).toHaveLength(1)
    expect(await db.select().from(articleTags)).toHaveLength(1)
  })

  it('leaves category_id null for multi-category posts, still flagged in the report', async () => {
    await insertWpPost(wpConn, {
      id: 1,
      title: 'Two cats',
      content: '',
      status: 'publish',
    })
    await insertWpTerm(wpConn, 10, 'category', 'Travel', [1])
    await insertWpTerm(wpConn, 11, 'category', 'Food', [1])

    const report = await runMigration({
      wpConn,
      db,
      apply: true,
      r2Env,
      ownedHost: OWNED_HOST,
      publicImageBaseUrl: IMG_BASE,
    })

    expect(report.multiCategoryPosts).toEqual([
      { wpId: 1, title: 'Two cats', categories: ['Travel', 'Food'] },
    ])
    const [row] = await db.select().from(articles)
    expect(row?.categoryId).toBeNull()
  })

  it('rewrites owned-domain inline image src to a new R2 URL, leaves external src untouched', async () => {
    await insertWpPost(wpConn, {
      id: 1,
      title: 'Mixed images',
      content:
        '<p><img src="https://peterjur.co/wp-content/uploads/2020/mine.jpg"></p>' +
        '<p><img src="https://example.com/theirs.jpg"></p>',
      status: 'publish',
    })

    const report = await runMigration({
      wpConn,
      db,
      apply: true,
      r2Env,
      ownedHost: OWNED_HOST,
      fetchSource: fakeWpFetch(),
      publicImageBaseUrl: IMG_BASE,
    })

    const [row] = await db.select().from(articles)
    const content = row?.content as {
      content: Array<{ content: Array<{ attrs?: { src?: string } }> }>
    }
    const srcs = content.content.flatMap((block) =>
      block.content.map((node) => node.attrs?.src),
    )
    expect(srcs).toContain('https://example.com/theirs.jpg')
    expect(srcs.some((src) => src?.startsWith(`${IMG_BASE}/migrated/`))).toBe(
      true,
    )
    expect(srcs).not.toContain(
      'https://peterjur.co/wp-content/uploads/2020/mine.jpg',
    )

    const rehosted = report.inlineImages.find(
      (image) =>
        image.sourceUrl ===
        'https://peterjur.co/wp-content/uploads/2020/mine.jpg',
    )
    expect(rehosted?.status).toBe('rehosted')
    const external = report.inlineImages.find(
      (image) => image.sourceUrl === 'https://example.com/theirs.jpg',
    )
    expect(external?.status).toBe('external')
  })

  it('sets featuredPhotoKey on success and leaves it null + reports the failure otherwise', async () => {
    await insertWpPost(wpConn, {
      id: 1,
      title: 'Good cover',
      content: '',
      status: 'publish',
    })
    await setWpFeaturedImage(
      wpConn,
      1,
      91,
      'https://peterjur.co/wp-content/uploads/good.jpg',
    )
    await insertWpPost(wpConn, {
      id: 2,
      title: 'Bad cover',
      content: '',
      status: 'publish',
    })
    await setWpFeaturedImage(
      wpConn,
      2,
      92,
      'https://peterjur.co/wp-content/uploads/missing/cover.jpg',
    )

    const report = await runMigration({
      wpConn,
      db,
      apply: true,
      r2Env,
      ownedHost: OWNED_HOST,
      fetchSource: fakeWpFetch(),
      publicImageBaseUrl: IMG_BASE,
    })

    const rows = await db.select().from(articles)
    const good = rows.find((row) => row.title === 'Good cover')
    const bad = rows.find((row) => row.title === 'Bad cover')
    expect(good?.featuredPhotoKey).toMatch(/^migrated\//)
    expect(bad?.featuredPhotoKey).toBeNull()

    const failedEntry = report.featuredImages.find(
      (image) => image.postId === 2,
    )
    expect(failedEntry?.status).toBe('failed')
    expect(failedEntry?.reason).toBeTruthy()

    // The article itself is still in a valid, usable state despite the failure.
    expect(bad?.title).toBe('Bad cover')
    expect(bad?.visibility).toBe('private')
  })

  it('assigns tags via mapTaxonomy, idempotently', async () => {
    await insertWpPost(wpConn, {
      id: 1,
      title: 'Tagged',
      content: '',
      status: 'publish',
    })
    await insertWpTerm(wpConn, 20, 'post_tag', 'hiking', [1])
    await insertWpTerm(wpConn, 21, 'post_tag', 'trail-running', [1])

    await runMigration({
      wpConn,
      db,
      apply: true,
      r2Env,
      ownedHost: OWNED_HOST,
      publicImageBaseUrl: IMG_BASE,
    })

    const [row] = await db.select().from(articles)
    const tagRows = await db
      .select({ name: articleTags.name })
      .from(articleTagsMap)
      .innerJoin(articleTags, eq(articleTagsMap.tagId, articleTags.id))
      .where(eq(articleTagsMap.articleId, row?.id as number))
    expect(tagRows.map((t) => t.name).sort()).toEqual([
      'hiking',
      'trail-running',
    ])
  })
})

describe('runMigration — apply — categoryId re-run safety', () => {
  it('does not revert a manually-fixed category on a still-multi-category post', async () => {
    await insertWpPost(wpConn, {
      id: 1,
      title: 'Two cats',
      content: '',
      status: 'publish',
    })
    await insertWpTerm(wpConn, 10, 'category', 'Travel', [1])
    await insertWpTerm(wpConn, 11, 'category', 'Food', [1])

    await runMigration({
      wpConn,
      db,
      apply: true,
      r2Env,
      ownedHost: OWNED_HOST,
      publicImageBaseUrl: IMG_BASE,
    })

    const created = await getByLegacyWpId(db, 1)
    expect(created?.categoryId).toBeNull()

    // Owner resolves the flag by hand in the article editor.
    const manualCategory = await createCategory(db, 'Travel')
    await db
      .update(articles)
      .set({ categoryId: manualCategory.id })
      .where(eq(articles.id, created?.id as number))

    // Post is still multi-category in the source data — a later re-run (e.g.
    // to pick up a newly-noticed post) must not wipe the manual fix.
    const secondReport = await runMigration({
      wpConn,
      db,
      apply: true,
      r2Env,
      ownedHost: OWNED_HOST,
      publicImageBaseUrl: IMG_BASE,
    })

    expect(secondReport.multiCategoryPosts).toEqual([
      { wpId: 1, title: 'Two cats', categories: ['Travel', 'Food'] },
    ])
    const afterRerun = await getByLegacyWpId(db, 1)
    expect(afterRerun?.categoryId).toBe(manualCategory.id)
  })

  it('still updates categoryId for a single-category post whose category changes between runs', async () => {
    await insertWpPost(wpConn, {
      id: 1,
      title: 'One cat',
      content: '',
      status: 'publish',
    })
    await insertWpTerm(wpConn, 10, 'category', 'Travel', [1])

    await runMigration({
      wpConn,
      db,
      apply: true,
      r2Env,
      ownedHost: OWNED_HOST,
      publicImageBaseUrl: IMG_BASE,
    })
    const firstCategoryId = (await getByLegacyWpId(db, 1))?.categoryId
    expect(firstCategoryId).not.toBeNull()

    // The post's category assignment changes in the source dump.
    await wpConn.query('DELETE FROM wp_term_relationships WHERE object_id = 1')
    await insertWpTerm(wpConn, 20, 'category', 'Food', [1])

    await runMigration({
      wpConn,
      db,
      apply: true,
      r2Env,
      ownedHost: OWNED_HOST,
      publicImageBaseUrl: IMG_BASE,
    })

    const afterRerun = await getByLegacyWpId(db, 1)
    expect(afterRerun?.categoryId).not.toBeNull()
    expect(afterRerun?.categoryId).not.toBe(firstCategoryId)
  })
})

describe('runMigration — apply — rehost cache persists across runs', () => {
  it('does not re-fetch an already-rehosted image on a second run', async () => {
    await insertWpPost(wpConn, {
      id: 1,
      title: 'Has an image',
      content:
        '<p><img src="https://peterjur.co/wp-content/uploads/cached.jpg"></p>',
      status: 'publish',
    })

    const firstFetch = fakeWpFetch()
    await runMigration({
      wpConn,
      db,
      apply: true,
      r2Env,
      ownedHost: OWNED_HOST,
      fetchSource: firstFetch,
      publicImageBaseUrl: IMG_BASE,
      cachePath: CACHE_PATH,
    })
    expect(firstFetch).toHaveBeenCalledTimes(1)

    // Simulates a fresh process invocation: no in-memory cache carries over,
    // only whatever runMigration persisted to CACHE_PATH.
    const secondFetch = fakeWpFetch()
    const secondReport = await runMigration({
      wpConn,
      db,
      apply: true,
      r2Env,
      ownedHost: OWNED_HOST,
      fetchSource: secondFetch,
      publicImageBaseUrl: IMG_BASE,
      cachePath: CACHE_PATH,
    })

    expect(secondFetch).not.toHaveBeenCalled()
    const rehostedEntry = secondReport.inlineImages.find(
      (image) =>
        image.sourceUrl === 'https://peterjur.co/wp-content/uploads/cached.jpg',
    )
    expect(rehostedEntry?.status).toBe('rehosted')
    expect(rehostedEntry?.newKey).toMatch(/^migrated\//)
  })
})
