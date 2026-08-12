import mysql from 'mysql2/promise'
import type { WpTerm } from './map-taxonomy'

/**
 * Reads the WordPress export via a real MySQL-compatible connection
 * (`mysql2`) rather than parsing the raw SQL dump text — a hand-rolled regex
 * parser over multi-row `INSERT`s with embedded escaped quotes/newlines was
 * tried and rejected as unsafe. See scripts/migrate-wp/README.md for how to
 * load the dump into a scratch MySQL container and point `WP_MYSQL_URL` at
 * it (or tests/helpers/test-wp-db.ts for the disposable test double).
 *
 * "Real" posts (DATA_MODEL "Migration considerations"): `wp_posts` rows with
 * `post_type = 'post'` and `post_status IN ('publish', 'draft', 'private')`.
 * Everything else — attachments, revisions, nav menu items, pages, trash,
 * etc. — is noise and excluded.
 */

export type WpConnection = Pick<mysql.Pool, 'query'>

/**
 * Opens a connection pool against `url` (e.g.
 * `mysql://root:root@localhost:3399/wp_migrate`). `timezone: 'Z'` makes
 * mysql2 interpret WP's timezone-less DATETIME columns as UTC rather than
 * the Node process's local timezone, so `postDate`/`postModified` are
 * reproducible regardless of where the script runs.
 */
export function createWpConnection(url: string): mysql.Pool {
  return mysql.createPool({ uri: url, timezone: 'Z' })
}

export interface WpPost {
  wpId: number
  title: string
  contentHtml: string
  postDate: Date
  postModified: Date
  /** Informational only — visibility in the new schema is always 'private'. */
  postStatus: string
  categories: WpTerm[]
  tags: WpTerm[]
  featuredImageUrl: string | null
}

interface PostRow {
  ID: number
  post_title: string
  post_content: string
  post_date: Date
  post_modified: Date
  post_status: string
}

interface TermRow {
  object_id: number
  wp_id: number
  name: string
}

interface ThumbnailRow {
  post_id: number
  guid: string
}

/** Batch-reads terms of `taxonomy` attached to any of `postIds`, grouped by post id. */
async function readTermsByTaxonomy(
  conn: WpConnection,
  postIds: number[],
  taxonomy: string,
): Promise<Map<number, WpTerm[]>> {
  const byPost = new Map<number, WpTerm[]>()
  if (postIds.length === 0) return byPost

  const [rows] = await conn.query(
    `SELECT tr.object_id AS object_id, t.term_id AS wp_id, t.name AS name
     FROM wp_term_relationships tr
     JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
     JOIN wp_terms t ON t.term_id = tt.term_id
     WHERE tt.taxonomy = ? AND tr.object_id IN (?)
     ORDER BY tr.object_id, t.term_id`,
    [taxonomy, postIds],
  )
  for (const row of rows as TermRow[]) {
    const existing = byPost.get(row.object_id) ?? []
    existing.push({ wpId: row.wp_id, name: row.name })
    byPost.set(row.object_id, existing)
  }
  return byPost
}

/** Batch-reads `_thumbnail_id` → attachment `guid` for `postIds`, grouped by post id. */
async function readFeaturedImageUrls(
  conn: WpConnection,
  postIds: number[],
): Promise<Map<number, string>> {
  const byPost = new Map<number, string>()
  if (postIds.length === 0) return byPost

  const [rows] = await conn.query(
    `SELECT pm.post_id AS post_id, attachment.guid AS guid
     FROM wp_postmeta pm
     JOIN wp_posts attachment ON attachment.ID = CAST(pm.meta_value AS UNSIGNED)
     WHERE pm.meta_key = '_thumbnail_id' AND pm.post_id IN (?)`,
    [postIds],
  )
  for (const row of rows as ThumbnailRow[]) {
    if (row.guid) byPost.set(row.post_id, row.guid)
  }
  return byPost
}

/**
 * Reads every real post (see module docblock for the filter), with its
 * categories/tags shaped as `WpTerm[]` — the exact input `mapTaxonomy()`
 * expects (scripts/migrate-wp/map-taxonomy.ts) — and its featured image URL
 * when one is set.
 */
export async function readRealPosts(conn: WpConnection): Promise<WpPost[]> {
  const [postRows] = await conn.query(
    `SELECT ID, post_title, post_content, post_date, post_modified, post_status
     FROM wp_posts
     WHERE post_type = 'post' AND post_status IN ('publish', 'draft', 'private')
     ORDER BY ID`,
  )
  const rows = postRows as PostRow[]
  const postIds = rows.map((row) => row.ID)

  const [categoriesByPost, tagsByPost, featuredImageByPost] = await Promise.all(
    [
      readTermsByTaxonomy(conn, postIds, 'category'),
      readTermsByTaxonomy(conn, postIds, 'post_tag'),
      readFeaturedImageUrls(conn, postIds),
    ],
  )

  return rows.map((row) => ({
    wpId: row.ID,
    title: row.post_title,
    contentHtml: row.post_content,
    postDate: new Date(row.post_date),
    postModified: new Date(row.post_modified),
    postStatus: row.post_status,
    categories: categoriesByPost.get(row.ID) ?? [],
    tags: tagsByPost.get(row.ID) ?? [],
    featuredImageUrl: featuredImageByPost.get(row.ID) ?? null,
  }))
}
