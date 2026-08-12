import mysql from 'mysql2/promise'

/**
 * Disposable MySQL-compatible test double for a WordPress export, used by
 * tests/migrate-wp/*. Mirrors tests/helpers/test-db.ts's role for Postgres:
 * connects to the wp-mysql service (docker-compose.test.yml, port 3316) and
 * creates the small slice of the real WP schema `read-dump.ts` actually
 * reads — never a full WP install. Fixture rows are hand-written per test
 * file via `seedWpFixture`, not derived from the real dump (never committed).
 */

export const DEFAULT_TEST_WP_MYSQL_URL =
  'mysql://root:root@localhost:3316/wp_migrate_test'

export function createTestWpConnection(): mysql.Pool {
  return mysql.createPool({
    uri: process.env.TEST_WP_MYSQL_URL ?? DEFAULT_TEST_WP_MYSQL_URL,
    // See scripts/migrate-wp/read-dump.ts's createWpConnection: UTC, not the
    // local machine's timezone, so date assertions are reproducible.
    timezone: 'Z',
  })
}

/** Drops and recreates the handful of wp_* tables read-dump.ts queries. */
export async function resetWpSchema(conn: mysql.Pool): Promise<void> {
  await conn.query('DROP TABLE IF EXISTS wp_term_relationships')
  await conn.query('DROP TABLE IF EXISTS wp_term_taxonomy')
  await conn.query('DROP TABLE IF EXISTS wp_terms')
  await conn.query('DROP TABLE IF EXISTS wp_postmeta')
  await conn.query('DROP TABLE IF EXISTS wp_posts')

  await conn.query(`
    CREATE TABLE wp_posts (
      ID bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
      post_title text NOT NULL,
      post_content longtext NOT NULL,
      post_date datetime NOT NULL,
      post_modified datetime NOT NULL,
      post_status varchar(20) NOT NULL DEFAULT 'publish',
      post_type varchar(20) NOT NULL DEFAULT 'post',
      guid varchar(255) NOT NULL DEFAULT ''
    )
  `)
  await conn.query(`
    CREATE TABLE wp_postmeta (
      meta_id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
      post_id bigint unsigned NOT NULL,
      meta_key varchar(255),
      meta_value longtext
    )
  `)
  await conn.query(`
    CREATE TABLE wp_terms (
      term_id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name varchar(200) NOT NULL DEFAULT '',
      slug varchar(200) NOT NULL DEFAULT ''
    )
  `)
  await conn.query(`
    CREATE TABLE wp_term_taxonomy (
      term_taxonomy_id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
      term_id bigint unsigned NOT NULL DEFAULT 0,
      taxonomy varchar(32) NOT NULL DEFAULT ''
    )
  `)
  await conn.query(`
    CREATE TABLE wp_term_relationships (
      object_id bigint unsigned NOT NULL DEFAULT 0,
      term_taxonomy_id bigint unsigned NOT NULL DEFAULT 0,
      PRIMARY KEY (object_id, term_taxonomy_id)
    )
  `)
}

export interface WpFixturePost {
  id: number
  title: string
  content: string
  status: string
  type?: string
  date?: string
  modified?: string
  guid?: string
}

/** Inserts one `wp_posts` row (a real post, or a `type`d row like an attachment). */
export async function insertWpPost(
  conn: mysql.Pool,
  row: WpFixturePost,
): Promise<void> {
  await conn.query(
    `INSERT INTO wp_posts (ID, post_title, post_content, post_date, post_modified, post_status, post_type, guid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.title,
      row.content,
      row.date ?? '2020-01-15 10:00:00',
      row.modified ?? '2020-02-20 11:30:00',
      row.status,
      row.type ?? 'post',
      row.guid ?? '',
    ],
  )
}

/** Creates a term + its taxonomy row and attaches it to `objectIds`. */
export async function insertWpTerm(
  conn: mysql.Pool,
  termId: number,
  taxonomy: string,
  name: string,
  objectIds: number[],
): Promise<void> {
  await conn.query(
    'INSERT INTO wp_terms (term_id, name, slug) VALUES (?, ?, ?)',
    [termId, name, name.toLowerCase()],
  )
  const [ttResult] = await conn.query(
    'INSERT INTO wp_term_taxonomy (term_id, taxonomy) VALUES (?, ?)',
    [termId, taxonomy],
  )
  const termTaxonomyId = (ttResult as { insertId: number }).insertId
  for (const objectId of objectIds) {
    await conn.query(
      'INSERT INTO wp_term_relationships (object_id, term_taxonomy_id) VALUES (?, ?)',
      [objectId, termTaxonomyId],
    )
  }
}

/** Sets `postId`'s featured image via `_thumbnail_id`, creating the backing attachment row. */
export async function setWpFeaturedImage(
  conn: mysql.Pool,
  postId: number,
  attachmentId: number,
  attachmentGuid: string,
): Promise<void> {
  await insertWpPost(conn, {
    id: attachmentId,
    title: 'attachment',
    content: '',
    status: 'inherit',
    type: 'attachment',
    guid: attachmentGuid,
  })
  await conn.query(
    'INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)',
    [postId, '_thumbnail_id', String(attachmentId)],
  )
}
