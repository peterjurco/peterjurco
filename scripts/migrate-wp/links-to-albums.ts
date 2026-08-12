import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import type mysql from 'mysql2/promise'
import { Pool } from 'pg'
import * as schema from '../../src/db/schema'
import type { ArticlesDb } from '../../src/lib/articles/repo'
import { deleteArticle, getByLegacyWpId } from '../../src/lib/articles/repo'
import { requireEnv } from '../../src/lib/env'
import { isGooglePhotosUrl } from '../../src/lib/photos/album-url'
import type { PhotosDb } from '../../src/lib/photos/repo'
import { createAlbum } from '../../src/lib/photos/repo'
import { createWpConnection } from './read-dump'

/**
 * One-off cleanup for a WordPress pattern the main `import.ts` migration
 * doesn't know about: posts using WP's built-in "Link" post format have
 * empty `post_content` — the actual target lives in `_links_to` postmeta —
 * and on this site every one of them links to a Google Photos album (a
 * hiking-trip or film-roll gallery, never anything with real article text).
 * Once `import.ts` has already run, these exist in production as
 * near-empty articles. This script finds them by `legacy_wp_id`, converts
 * each into a proper photo-hub album (reusing the article's already-rehosted
 * `featuredPhotoKey` as the album cover — no re-fetch/re-upload), and
 * deletes the article.
 *
 * Idempotent the simple way: an article already converted has no
 * `legacy_wp_id` row left to find, so a re-run just skips it instead of
 * erroring or duplicating the album.
 */

export interface WpLinkPost {
  wpId: number
  title: string
  linksTo: string
}

export interface LinkAlbumResult {
  wpId: number
  title: string
  linksTo: string
  status:
    | 'would-convert'
    | 'converted'
    | 'skipped-not-google-photos'
    | 'skipped-no-article'
  albumId?: number
}

/** Every WP post using the "Link" post format (`_links_to` postmeta set). */
export async function readLinkPosts(conn: mysql.Pool): Promise<WpLinkPost[]> {
  const [rows] = await conn.query(
    `SELECT p.ID AS id, p.post_title AS title, pm.meta_value AS linksTo
     FROM wp_posts p
     JOIN wp_postmeta pm ON pm.post_id = p.ID AND pm.meta_key = '_links_to'
     WHERE p.post_type = 'post' AND p.post_status IN ('publish', 'draft', 'private')
     ORDER BY p.ID`,
  )
  return (rows as { id: number; title: string; linksTo: string }[]).map(
    (row) => ({ wpId: row.id, title: row.title, linksTo: row.linksTo }),
  )
}

export async function runLinksToAlbums(options: {
  wpConn: mysql.Pool
  db: ArticlesDb & PhotosDb
  apply: boolean
}): Promise<LinkAlbumResult[]> {
  const { wpConn, db, apply } = options
  const linkPosts = await readLinkPosts(wpConn)
  const results: LinkAlbumResult[] = []

  for (const post of linkPosts) {
    if (!isGooglePhotosUrl(post.linksTo)) {
      results.push({ ...post, status: 'skipped-not-google-photos' })
      continue
    }

    const article = await getByLegacyWpId(db, post.wpId)
    if (!article) {
      results.push({ ...post, status: 'skipped-no-article' })
      continue
    }

    if (!apply) {
      results.push({ ...post, status: 'would-convert' })
      continue
    }

    const album = await createAlbum(db, {
      name: post.title,
      googlePhotosUrl: post.linksTo,
      ...(article.featuredPhotoKey
        ? { coverImageKey: article.featuredPhotoKey }
        : {}),
    })
    await deleteArticle(db, article.id)
    results.push({ ...post, status: 'converted', albumId: album.id })
  }

  return results
}

function redactUrl(url: string): string {
  return url.replace(/:\/\/[^@]*@/, '://***@')
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const wpMysqlUrl = requireEnv(process.env.WP_MYSQL_URL, 'WP_MYSQL_URL')
  const databaseUrl = requireEnv(process.env.DATABASE_URL, 'DATABASE_URL')

  console.log(
    `Link-format posts → photo hub albums — ${apply ? 'APPLY (real writes)' : 'DRY RUN (read-only)'}`,
  )
  console.log(`  WP source:   ${redactUrl(wpMysqlUrl)}`)
  console.log(`  Target DB:   ${redactUrl(databaseUrl)}`)

  const wpConn = createWpConnection(wpMysqlUrl)
  const pool = new Pool({ connectionString: databaseUrl })
  const db = drizzle(pool, { schema })

  try {
    const results = await runLinksToAlbums({ wpConn, db: db as never, apply })

    const reportPath = fileURLToPath(
      new URL('./links-to-albums-report.json', import.meta.url),
    )
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(reportPath, JSON.stringify(results, null, 2)),
    )
    console.log(`\nWrote ${reportPath}`)

    for (const status of [
      'would-convert',
      'converted',
      'skipped-not-google-photos',
      'skipped-no-article',
    ] as const) {
      const count = results.filter((r) => r.status === status).length
      console.log(`  ${status}: ${count}`)
    }
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
