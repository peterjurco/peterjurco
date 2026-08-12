import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { readRealPosts } from '../../scripts/migrate-wp/read-dump'
import {
  createTestWpConnection,
  insertWpPost,
  insertWpTerm,
  resetWpSchema,
  setWpFeaturedImage,
} from '../helpers/test-wp-db'

/**
 * Exercises read-dump.ts against a disposable MySQL-compatible test double
 * (wp-mysql, docker-compose.test.yml) seeded with a small hand-written
 * fixture — never the real dump (see scripts/migrate-wp/README.md).
 */

const conn = createTestWpConnection()

afterAll(async () => {
  await conn.end()
})

const insertPost = (row: Parameters<typeof insertWpPost>[1]) =>
  insertWpPost(conn, row)
const insertTerm = (
  termId: number,
  taxonomy: string,
  name: string,
  objectIds: number[],
) => insertWpTerm(conn, termId, taxonomy, name, objectIds)
const setFeaturedImage = (
  postId: number,
  attachmentId: number,
  attachmentGuid: string,
) => setWpFeaturedImage(conn, postId, attachmentId, attachmentGuid)

beforeEach(async () => {
  await resetWpSchema(conn)
})

describe('readRealPosts', () => {
  it('reads real posts (publish/draft/private) with title, content and dates', async () => {
    await insertPost({
      id: 1,
      title: 'Published post',
      content: '<p>Hello</p>',
      status: 'publish',
      date: '2019-06-01 08:00:00',
      modified: '2019-06-02 09:00:00',
    })

    const posts = await readRealPosts(conn)
    expect(posts).toHaveLength(1)
    const [post] = posts
    expect(post?.wpId).toBe(1)
    expect(post?.title).toBe('Published post')
    expect(post?.contentHtml).toBe('<p>Hello</p>')
    expect(post?.postStatus).toBe('publish')
    expect(post?.postDate).toBeInstanceOf(Date)
    expect(post?.postDate.toISOString()).toBe('2019-06-01T08:00:00.000Z')
    expect(post?.postModified.toISOString()).toBe('2019-06-02T09:00:00.000Z')
    expect(post?.categories).toEqual([])
    expect(post?.tags).toEqual([])
    expect(post?.featuredImageUrl).toBeNull()
  })

  it('includes draft and private posts', async () => {
    await insertPost({ id: 1, title: 'D', content: '', status: 'draft' })
    await insertPost({ id: 2, title: 'P', content: '', status: 'private' })
    const posts = await readRealPosts(conn)
    expect(posts.map((p) => p.wpId).sort()).toEqual([1, 2])
  })

  it('excludes non-post types and non-real statuses (attachments, revisions, trash, pages)', async () => {
    await insertPost({ id: 1, title: 'Real', content: '', status: 'publish' })
    await insertPost({
      id: 2,
      title: 'Attachment',
      content: '',
      status: 'inherit',
      type: 'attachment',
    })
    await insertPost({
      id: 3,
      title: 'Revision',
      content: '',
      status: 'inherit',
      type: 'revision',
    })
    await insertPost({
      id: 4,
      title: 'Trashed',
      content: '',
      status: 'trash',
    })
    await insertPost({
      id: 5,
      title: 'A page',
      content: '',
      status: 'publish',
      type: 'page',
    })
    await insertPost({
      id: 6,
      title: 'Nav item',
      content: '',
      status: 'publish',
      type: 'nav_menu_item',
    })

    const posts = await readRealPosts(conn)
    expect(posts.map((p) => p.wpId)).toEqual([1])
  })

  it('resolves a single category', async () => {
    await insertPost({
      id: 1,
      title: 'One cat',
      content: '',
      status: 'publish',
    })
    await insertTerm(10, 'category', 'Travel', [1])

    const [post] = await readRealPosts(conn)
    expect(post?.categories).toEqual([{ wpId: 10, name: 'Travel' }])
  })

  it('flags posts with two categories (never auto-picked downstream)', async () => {
    await insertPost({
      id: 1,
      title: 'Two cats',
      content: '',
      status: 'publish',
    })
    await insertTerm(10, 'category', 'Travel', [1])
    await insertTerm(11, 'category', 'Food', [1])

    const [post] = await readRealPosts(conn)
    expect(post?.categories).toHaveLength(2)
    expect(post?.categories.map((c) => c.name).sort()).toEqual([
      'Food',
      'Travel',
    ])
  })

  it('resolves tags separately from categories', async () => {
    await insertPost({ id: 1, title: 'Tagged', content: '', status: 'publish' })
    await insertTerm(10, 'category', 'Travel', [1])
    await insertTerm(20, 'post_tag', 'hiking', [1])
    await insertTerm(21, 'post_tag', 'trail-running', [1])

    const [post] = await readRealPosts(conn)
    expect(post?.categories).toEqual([{ wpId: 10, name: 'Travel' }])
    expect(post?.tags.map((t) => t.name).sort()).toEqual([
      'hiking',
      'trail-running',
    ])
  })

  it('resolves the featured image URL via _thumbnail_id → attachment guid', async () => {
    await insertPost({
      id: 1,
      title: 'With cover',
      content: '',
      status: 'publish',
    })
    await setFeaturedImage(
      1,
      99,
      'https://peterjur.co/wp-content/uploads/cover.jpg',
    )

    const [post] = await readRealPosts(conn)
    expect(post?.featuredImageUrl).toBe(
      'https://peterjur.co/wp-content/uploads/cover.jpg',
    )
  })

  it('leaves featuredImageUrl null when there is no _thumbnail_id meta', async () => {
    await insertPost({
      id: 1,
      title: 'No cover',
      content: '',
      status: 'publish',
    })
    const [post] = await readRealPosts(conn)
    expect(post?.featuredImageUrl).toBeNull()
  })

  it('scopes categories/tags/featured images per post, not globally', async () => {
    await insertPost({ id: 1, title: 'A', content: '', status: 'publish' })
    await insertPost({ id: 2, title: 'B', content: '', status: 'publish' })
    await insertTerm(10, 'category', 'Travel', [1])
    await insertTerm(11, 'category', 'Food', [2])
    await setFeaturedImage(
      1,
      99,
      'https://peterjur.co/wp-content/uploads/a.jpg',
    )

    const posts = await readRealPosts(conn)
    const a = posts.find((p) => p.wpId === 1)
    const b = posts.find((p) => p.wpId === 2)
    expect(a?.categories).toEqual([{ wpId: 10, name: 'Travel' }])
    expect(a?.featuredImageUrl).toBe(
      'https://peterjur.co/wp-content/uploads/a.jpg',
    )
    expect(b?.categories).toEqual([{ wpId: 11, name: 'Food' }])
    expect(b?.featuredImageUrl).toBeNull()
  })

  it('returns an empty array when there are no real posts', async () => {
    const posts = await readRealPosts(conn)
    expect(posts).toEqual([])
  })
})
