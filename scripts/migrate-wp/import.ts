import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '../../src/db/schema'
import type { ArticleContent, ArticlesDb } from '../../src/lib/articles/repo'
import {
  createMigratedArticle,
  getByLegacyWpId,
  setTags,
  updateMigratedArticle,
} from '../../src/lib/articles/repo'
import { requireEnv } from '../../src/lib/env'
import { imageUrl } from '../../src/lib/media/image-url'
import type { R2Env } from '../../src/lib/media/r2'
import { htmlToTiptap, type ProseMirrorDoc } from './html-to-tiptap'
import { mapTaxonomy, type WpTerm } from './map-taxonomy'
import {
  createWpConnection,
  readRealPosts,
  type WpConnection,
} from './read-dump'
import {
  isOwnedUrl,
  loadRehostCache,
  rehostImage,
  rehostVideo,
  saveRehostCache,
} from './rehost-image'

/**
 * Idempotent orchestrator (DATA_MODEL "Migration considerations",
 * plans/08-migration.md Task 4): `--dry-run` (default, zero side effects) or
 * `--apply` (real writes, keyed by `legacy_wp_id` so re-runs update rather
 * than duplicate). See scripts/migrate-wp/README.md for how to run it and
 * how to point it at a real dump.
 */

export interface ImageOutcome {
  postId: number
  sourceUrl: string
  status: 'rehosted' | 'would-rehost' | 'external' | 'failed'
  newKey?: string
  reason?: string
}

/** An `ImageOutcome` with `status: 'failed'`, tagged with where it came from. */
export interface FailedImageOutcome extends ImageOutcome {
  location: 'inline' | 'featured'
}

export interface MultiCategoryFlag {
  wpId: number
  title: string
  categories: string[]
}

/**
 * Top-of-report counts so a non-technical reader (the site owner) doesn't
 * have to scroll past hundreds of "nothing to do" rows in `inlineImages`/
 * `featuredImages` to find the handful of things that actually need
 * attention — same underlying data, just surfaced.
 */
export interface MigrationReportSummary {
  postsCreated: number
  postsUpdated: number
  multiCategoryCount: number
  imagesRehostedCount: number
  imagesFailedCount: number
  imagesExternalCount: number
  videosRehostedCount: number
  videosFailedCount: number
  videosExternalCount: number
}

export interface MigrationReport {
  generatedAt: string
  mode: 'dry-run' | 'apply'
  totalPosts: number
  created: number
  updated: number
  summary: MigrationReportSummary
  /** Never auto-assigned (DATA_MODEL) — the author resolves these by hand. */
  multiCategoryPosts: MultiCategoryFlag[]
  /** Every failed inline/featured image in one place — nothing else to act on. */
  failedImages: FailedImageOutcome[]
  inlineImages: ImageOutcome[]
  featuredImages: ImageOutcome[]
  /** Self-hosted <video> files (wp-block-video) found inline — same rehost pipeline as images. */
  inlineVideos: ImageOutcome[]
}

/** The fields built up incrementally while the loop runs; `summary`/`failedImages` are derived from these. */
type MutableReport = Omit<MigrationReport, 'summary' | 'failedImages'>

function computeSummary(state: MutableReport): MigrationReportSummary {
  const allImages = [...state.inlineImages, ...state.featuredImages]
  return {
    postsCreated: state.created,
    postsUpdated: state.updated,
    multiCategoryCount: state.multiCategoryPosts.length,
    imagesRehostedCount: allImages.filter((i) => i.status === 'rehosted')
      .length,
    imagesFailedCount: allImages.filter((i) => i.status === 'failed').length,
    imagesExternalCount: allImages.filter((i) => i.status === 'external')
      .length,
    videosRehostedCount: state.inlineVideos.filter(
      (v) => v.status === 'rehosted',
    ).length,
    videosFailedCount: state.inlineVideos.filter((v) => v.status === 'failed')
      .length,
    videosExternalCount: state.inlineVideos.filter(
      (v) => v.status === 'external',
    ).length,
  }
}

function computeFailedImages(state: MutableReport): FailedImageOutcome[] {
  return [
    ...state.inlineImages
      .filter((image) => image.status === 'failed')
      .map((image) => ({ ...image, location: 'inline' as const })),
    ...state.featuredImages
      .filter((image) => image.status === 'failed')
      .map((image) => ({ ...image, location: 'featured' as const })),
    ...state.inlineVideos
      .filter((video) => video.status === 'failed')
      .map((video) => ({ ...video, location: 'inline' as const })),
  ]
}

function finalizeReport(state: MutableReport): MigrationReport {
  return {
    ...state,
    summary: computeSummary(state),
    failedImages: computeFailedImages(state),
  }
}

export interface RunMigrationOptions {
  wpConn: WpConnection
  db: ArticlesDb
  /** `false` (default-safe): read-only, computes the report, touches nothing. */
  apply: boolean
  r2Env: R2Env
  /** The old site's hostname — only its images are ever rehosted (owner decision). */
  ownedHost: string
  /** Injectable for tests; passed straight through to rehostImage's source fetch. */
  fetchSource?: typeof fetch
  /** Base URL images are rewritten to (PUBLIC_R2_PUBLIC_BASE_URL). Required only in apply mode. */
  publicImageBaseUrl?: string
  /**
   * When set, the report is flushed to this path after every post — not
   * just once the whole loop completes — so a crash partway through a
   * 247-post run still leaves an accurate report on disk for whatever was
   * processed before the throw, rather than nothing at all.
   */
  reportPath?: string
  /**
   * When set, the image-rehost dedup cache (source URL → R2 key) is loaded
   * from this path at the start of the run and saved back after every
   * successful rehost — so a second `--apply` run reuses already-rehosted
   * images instead of re-fetching the old site and orphaning the first
   * run's R2 objects. See rehost-image.ts's loadRehostCache/saveRehostCache.
   */
  cachePath?: string
  /**
   * When set, only these WP post ids are processed — every other post is
   * skipped entirely (not read, not diffed, not written; its existing
   * article, if any, is left completely untouched). For a targeted re-run
   * (e.g. backfilling newly-supported video embeds into specific
   * already-migrated articles) rather than the full full-content overwrite a
   * normal `--apply` does for every post in the dump.
   */
  wpIds?: number[]
}

/** Minimal shape shared with html-to-tiptap.ts's internal node type, for walking the doc. */
interface WalkableNode {
  type?: string
  attrs?: Record<string, unknown>
  content?: WalkableNode[]
}

function nodesOf(doc: ProseMirrorDoc): WalkableNode[] {
  return doc.content as unknown as WalkableNode[]
}

/** Every distinct image `src` referenced anywhere in the doc. */
function collectImageSrcs(doc: ProseMirrorDoc): string[] {
  const srcs = new Set<string>()
  const walk = (nodes: WalkableNode[] | undefined): void => {
    if (!nodes) return
    for (const node of nodes) {
      if (node.type === 'image' && typeof node.attrs?.src === 'string') {
        srcs.add(node.attrs.src)
      }
      walk(node.content)
    }
  }
  walk(nodesOf(doc))
  return [...srcs]
}

/** Rewrites image `src`s in place per `rewrites` (old URL → new public URL). */
function rewriteImageSrcs(
  doc: ProseMirrorDoc,
  rewrites: Map<string, string>,
): void {
  const walk = (nodes: WalkableNode[] | undefined): void => {
    if (!nodes) return
    for (const node of nodes) {
      if (node.type === 'image' && typeof node.attrs?.src === 'string') {
        const next = rewrites.get(node.attrs.src)
        if (next && node.attrs) node.attrs.src = next
      }
      walk(node.content)
    }
  }
  walk(nodesOf(doc))
}

function isFileVideoNode(node: WalkableNode): boolean {
  return node.type === 'videoEmbed' && node.attrs?.provider === 'file'
}

/** Every distinct self-hosted (`provider: 'file'`) video `src` in the doc — YouTube/Vimeo embeds need no rehosting. */
function collectVideoFileSrcs(doc: ProseMirrorDoc): string[] {
  const srcs = new Set<string>()
  const walk = (nodes: WalkableNode[] | undefined): void => {
    if (!nodes) return
    for (const node of nodes) {
      if (isFileVideoNode(node) && typeof node.attrs?.src === 'string') {
        srcs.add(node.attrs.src)
      }
      walk(node.content)
    }
  }
  walk(nodesOf(doc))
  return [...srcs]
}

/** Rewrites self-hosted video `src`s in place per `rewrites` (old URL → new public URL). */
function rewriteVideoSrcs(
  doc: ProseMirrorDoc,
  rewrites: Map<string, string>,
): void {
  const walk = (nodes: WalkableNode[] | undefined): void => {
    if (!nodes) return
    for (const node of nodes) {
      if (isFileVideoNode(node) && typeof node.attrs?.src === 'string') {
        const next = rewrites.get(node.attrs.src)
        if (next && node.attrs) node.attrs.src = next
      }
      walk(node.content)
    }
  }
  walk(nodesOf(doc))
}

/** Dedupes WP terms by id — for building the one global mapTaxonomy() call. */
function uniqueTerms(terms: WpTerm[]): WpTerm[] {
  const byId = new Map<number, WpTerm>()
  for (const term of terms) byId.set(term.wpId, term)
  return [...byId.values()]
}

/**
 * The public URL an inline/featured image is rewritten to after rehosting —
 * matches EditorToolbar.tsx's `insertImage`: inline images are stored as
 * plain absolute URLs in the TipTap JSON, never bare R2 keys, and never
 * through the `/cdn-cgi/image` transform pipeline (render-doc.ts renders
 * `src` verbatim).
 */
function publicObjectUrl(key: string, baseUrl: string): string {
  return imageUrl(key, {}, { baseUrl, transforms: false })
}

export async function runMigration(
  options: RunMigrationOptions,
): Promise<MigrationReport> {
  const {
    wpConn,
    db,
    apply,
    r2Env,
    ownedHost,
    fetchSource,
    reportPath,
    cachePath,
    wpIds,
  } = options
  const publicImageBaseUrl = apply
    ? requireEnv(options.publicImageBaseUrl, 'PUBLIC_R2_PUBLIC_BASE_URL')
    : (options.publicImageBaseUrl ?? '')

  const allPosts = await readRealPosts(wpConn)
  const posts = wpIds
    ? allPosts.filter((post) => wpIds.includes(post.wpId))
    : allPosts

  // Real taxonomy writes happen ONLY in apply mode — dry-run must not create
  // a single category/tag row.
  const taxonomy = apply
    ? await mapTaxonomy(db, {
        categories: uniqueTerms(posts.flatMap((post) => post.categories)),
        tags: uniqueTerms(posts.flatMap((post) => post.tags)),
      })
    : null

  // Built up incrementally and flushed to `reportPath` after every post (see
  // RunMigrationOptions.reportPath) — never assembled only at the very end —
  // so a thrown error partway through still leaves an accurate report for
  // whatever was processed so far.
  const report: MutableReport = {
    generatedAt: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    totalPosts: posts.length,
    created: 0,
    updated: 0,
    multiCategoryPosts: [],
    inlineImages: [],
    featuredImages: [],
    inlineVideos: [],
  }
  const imageCache = cachePath
    ? loadRehostCache(cachePath)
    : new Map<string, string | null>()

  const flushReport = (): void => {
    if (reportPath) {
      writeFileSync(reportPath, JSON.stringify(finalizeReport(report), null, 2))
    }
  }
  const flushCacheIfRehosted = (key: string | null): void => {
    if (key && cachePath) saveRehostCache(cachePath, imageCache)
  }

  try {
    for (const post of posts) {
      if (post.categories.length > 1) {
        report.multiCategoryPosts.push({
          wpId: post.wpId,
          title: post.title,
          categories: post.categories.map((category) => category.name),
        })
      }

      const existing = await getByLegacyWpId(db, post.wpId)

      const doc = htmlToTiptap(post.contentHtml)
      const rewrites = new Map<string, string>()

      for (const src of collectImageSrcs(doc)) {
        if (!isOwnedUrl(src, ownedHost)) {
          report.inlineImages.push({
            postId: post.wpId,
            sourceUrl: src,
            status: 'external',
          })
          continue
        }
        if (!apply) {
          report.inlineImages.push({
            postId: post.wpId,
            sourceUrl: src,
            status: 'would-rehost',
          })
          continue
        }
        const key = await rehostImage(r2Env, src, {
          ownedHost,
          cache: imageCache,
          fetchSource,
          context: `wp#${post.wpId} (inline image)`,
        })
        flushCacheIfRehosted(key)
        if (key) {
          rewrites.set(src, publicObjectUrl(key, publicImageBaseUrl))
          report.inlineImages.push({
            postId: post.wpId,
            sourceUrl: src,
            status: 'rehosted',
            newKey: key,
          })
        } else {
          report.inlineImages.push({
            postId: post.wpId,
            sourceUrl: src,
            status: 'failed',
            reason:
              'rehost failed — left pointing at the original WP URL (see warnings above)',
          })
        }
      }
      if (rewrites.size > 0) rewriteImageSrcs(doc, rewrites)

      const videoRewrites = new Map<string, string>()
      for (const src of collectVideoFileSrcs(doc)) {
        if (!isOwnedUrl(src, ownedHost)) {
          report.inlineVideos.push({
            postId: post.wpId,
            sourceUrl: src,
            status: 'external',
          })
          continue
        }
        if (!apply) {
          report.inlineVideos.push({
            postId: post.wpId,
            sourceUrl: src,
            status: 'would-rehost',
          })
          continue
        }
        const key = await rehostVideo(r2Env, src, {
          ownedHost,
          cache: imageCache,
          fetchSource,
          context: `wp#${post.wpId} (inline video)`,
        })
        flushCacheIfRehosted(key)
        if (key) {
          videoRewrites.set(src, publicObjectUrl(key, publicImageBaseUrl))
          report.inlineVideos.push({
            postId: post.wpId,
            sourceUrl: src,
            status: 'rehosted',
            newKey: key,
          })
        } else {
          report.inlineVideos.push({
            postId: post.wpId,
            sourceUrl: src,
            status: 'failed',
            reason:
              'rehost failed — left pointing at the original WP URL (see warnings above)',
          })
        }
      }
      if (videoRewrites.size > 0) rewriteVideoSrcs(doc, videoRewrites)

      let featuredPhotoKey: string | null = null
      if (post.featuredImageUrl) {
        const url = post.featuredImageUrl
        if (!isOwnedUrl(url, ownedHost)) {
          report.featuredImages.push({
            postId: post.wpId,
            sourceUrl: url,
            status: 'external',
          })
        } else if (!apply) {
          report.featuredImages.push({
            postId: post.wpId,
            sourceUrl: url,
            status: 'would-rehost',
          })
        } else {
          const key = await rehostImage(r2Env, url, {
            ownedHost,
            cache: imageCache,
            fetchSource,
            context: `wp#${post.wpId} (featured image)`,
          })
          flushCacheIfRehosted(key)
          if (key) {
            featuredPhotoKey = key
            report.featuredImages.push({
              postId: post.wpId,
              sourceUrl: url,
              status: 'rehosted',
              newKey: key,
            })
          } else {
            report.featuredImages.push({
              postId: post.wpId,
              sourceUrl: url,
              status: 'failed',
              reason:
                'rehost failed — featured_photo_key left unset (see warnings above)',
            })
          }
        }
      }

      if (!apply) {
        if (existing) report.updated++
        else report.created++
        flushReport()
        continue
      }

      const categoryId =
        post.categories.length === 1 && taxonomy
          ? (taxonomy.categoryIdByWpId.get(
              post.categories[0]?.wpId as number,
            ) ?? null)
          : null

      const commonFields = {
        title: post.title,
        content: doc as unknown as ArticleContent,
        visibility: 'private' as const,
        featuredPhotoKey,
        createdAt: post.postDate,
        updatedAt: post.postModified,
      }

      // UPDATE: a null categoryId here just means "still multi-category, per
      // the fresh WP dump" — NOT "clear whatever category is set". Omitting
      // the key (rather than writing null) leaves untouched whatever the
      // owner may have already set by hand in the editor for a still-flagged
      // post (see MigratedArticleUpdateFields / updateMigratedArticle).
      // CREATE has nothing to preserve yet, so null is written as-is.
      const article = existing
        ? await updateMigratedArticle(db, existing.id, {
            ...commonFields,
            ...(categoryId === null ? {} : { categoryId }),
          })
        : await createMigratedArticle(db, post.wpId, {
            ...commonFields,
            categoryId,
          })
      if (!article)
        throw new Error(`Failed to write article for WP post ${post.wpId}`)
      if (existing) report.updated++
      else report.created++

      await setTags(
        db,
        article.id,
        post.tags.map((tag) => tag.name),
      )
      flushReport()
    }
  } finally {
    // Guarantees a report reflecting everything processed so far exists on
    // disk even if the loop above threw partway through (fix for silent
    // no-report-at-all crashes) — redundant with the per-post flush above on
    // the success path, but the only write that happens on a thrown error.
    flushReport()
  }

  return finalizeReport(report)
}

function redactUrl(url: string): string {
  return url.replace(/:\/\/[^@]*@/, '://***@')
}

/** Parses `--wp-ids=66,1032,2710` into `[66, 1032, 2710]`, or undefined when absent. */
function parseWpIdsArg(argv: string[]): number[] | undefined {
  const arg = argv.find((a) => a.startsWith('--wp-ids='))
  if (!arg) return undefined
  const ids = arg
    .slice('--wp-ids='.length)
    .split(',')
    .map((id) => Number(id.trim()))
  if (ids.some((id) => !Number.isInteger(id))) {
    throw new Error(
      `--wp-ids must be a comma-separated list of integers, got: ${arg}`,
    )
  }
  return ids
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const wpIds = parseWpIdsArg(process.argv)
  const wpMysqlUrl = requireEnv(process.env.WP_MYSQL_URL, 'WP_MYSQL_URL')
  const databaseUrl = requireEnv(process.env.DATABASE_URL, 'DATABASE_URL')
  const ownedHost = process.env.WP_OWNED_HOST ?? 'peterjur.co'

  console.log(
    `WordPress migration — ${apply ? 'APPLY (real writes)' : 'DRY RUN (read-only)'}`,
  )
  console.log(`  WP source:   ${redactUrl(wpMysqlUrl)}`)
  console.log(`  Target DB:   ${redactUrl(databaseUrl)}`)
  console.log(`  Owned host:  ${ownedHost}`)
  if (wpIds) console.log(`  Scoped to WP ids: ${wpIds.join(', ')}`)

  const wpConn = createWpConnection(wpMysqlUrl)
  const pool = new Pool({ connectionString: databaseUrl })
  const db = drizzle(pool, { schema })

  const r2Env: R2Env = {
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: process.env.R2_BUCKET,
    R2_ENDPOINT: process.env.R2_ENDPOINT,
  }

  const reportPath = fileURLToPath(
    new URL('./migration-report.json', import.meta.url),
  )
  const cachePath = fileURLToPath(
    new URL('./.rehost-cache.json', import.meta.url),
  )

  try {
    const report = await runMigration({
      wpConn,
      db,
      apply,
      r2Env,
      ownedHost,
      publicImageBaseUrl: process.env.PUBLIC_R2_PUBLIC_BASE_URL,
      reportPath,
      cachePath,
      wpIds,
    })

    console.log(`\nWrote ${reportPath}`)
    console.log(
      `Posts: ${report.totalPosts} total — ${report.created} to create, ${report.updated} to update`,
    )
    console.log(
      `Multi-category posts flagged (never auto-assigned): ${report.multiCategoryPosts.length}`,
    )
    console.log(
      `Inline images — rehosted: ${report.inlineImages.filter((i) => i.status === 'rehosted').length}, ` +
        `would-rehost: ${report.inlineImages.filter((i) => i.status === 'would-rehost').length}, ` +
        `external: ${report.inlineImages.filter((i) => i.status === 'external').length}, ` +
        `failed: ${report.inlineImages.filter((i) => i.status === 'failed').length}`,
    )
    console.log(
      `Featured images — rehosted: ${report.featuredImages.filter((i) => i.status === 'rehosted').length}, ` +
        `would-rehost: ${report.featuredImages.filter((i) => i.status === 'would-rehost').length}, ` +
        `external: ${report.featuredImages.filter((i) => i.status === 'external').length}, ` +
        `failed: ${report.featuredImages.filter((i) => i.status === 'failed').length}`,
    )
    console.log(
      `Inline videos — rehosted: ${report.inlineVideos.filter((i) => i.status === 'rehosted').length}, ` +
        `would-rehost: ${report.inlineVideos.filter((i) => i.status === 'would-rehost').length}, ` +
        `external: ${report.inlineVideos.filter((i) => i.status === 'external').length}, ` +
        `failed: ${report.inlineVideos.filter((i) => i.status === 'failed').length}`,
    )
  } finally {
    await wpConn.end()
    await pool.end()
  }
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url)
if (isMainModule) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
