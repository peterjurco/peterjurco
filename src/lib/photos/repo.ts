import { and, desc, eq, inArray, notInArray } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from '../../db/schema'
import { photoAlbums, photoAlbumsTagsMap, photoTags } from '../../db/schema'
import { deleteOrphanedImages } from '../media/cleanup'
import type { R2Env } from '../media/r2'
import { newPublicId } from '../public-id'

/**
 * Photo hub repository (REQUIREMENTS "Google Photos album hub"): an album is
 * a curated record — a Google Photos share URL, a name and a manually
 * uploaded cover key. No Google Photos API anywhere (TECH_DECISIONS §8).
 *
 * INVARIANT — no interactive transactions (see src/lib/articles/repo.ts):
 * production runs on the Neon HTTP driver, so multi-statement writes run as
 * ordered, independent statements — insert referenced rows before join rows,
 * delete join rows before the rows they reference.
 */

/** Any Drizzle Postgres client over our schema (prod neon-http or test pg). */
export type PhotosDb = PgDatabase<PgQueryResultHKT, typeof schema>

export type PhotoAlbum = typeof photoAlbums.$inferSelect
export type PhotoTag = typeof photoTags.$inferSelect
export type PhotoTagVisibility = PhotoTag['visibility']
export type AlbumWithTags = PhotoAlbum & { tags: PhotoTag[] }

/** Shared listing order — recently touched first, `id DESC` breaks ties. */
const newestFirst = [desc(photoAlbums.updatedAt), desc(photoAlbums.id)] as const

/**
 * Best-effort R2 cleanup for a cover key a DB write above already dropped —
 * see src/lib/media/cleanup.ts. Only ever called AFTER that write has
 * succeeded (repo-wide INVARIANT docblock above), so `key`, if given, is
 * never at risk of still being referenced.
 */
function deleteOldCover(
  env: R2Env,
  key: string | null | undefined,
): Promise<void> {
  return deleteOrphanedImages(env, key ? [key] : [])
}

export async function createAlbum(
  db: PhotosDb,
  values: { name: string; googlePhotosUrl: string; coverImageKey?: string },
): Promise<PhotoAlbum> {
  const [album] = await db.insert(photoAlbums).values(values).returning()
  if (!album) throw new Error('Album insert returned no row')
  return album
}

/** Partial update; `coverImageKey: null` clears the cover. */
export async function updateAlbum(
  db: PhotosDb,
  id: number,
  patch: {
    name?: string
    googlePhotosUrl?: string
    coverImageKey?: string | null
  },
  env: R2Env,
): Promise<PhotoAlbum | null> {
  // Read BEFORE the write — the only way to know the OLD cover the patch is
  // about to replace or clear (UPDATE ... RETURNING only gives the NEW row).
  const previousCoverImageKey =
    'coverImageKey' in patch
      ? (
          await db
            .select({ coverImageKey: photoAlbums.coverImageKey })
            .from(photoAlbums)
            .where(eq(photoAlbums.id, id))
        )[0]?.coverImageKey
      : undefined

  const [album] = await db
    .update(photoAlbums)
    .set(patch)
    .where(eq(photoAlbums.id, id))
    .returning()
  if (!album) return null

  // R2 cleanup runs only now that the update above has actually succeeded
  // (see repo-wide INVARIANT docblock). Only delete the OLD cover, and only
  // when it was actually replaced/cleared — a no-op re-send of the same key
  // must not delete anything still in use.
  if (previousCoverImageKey && previousCoverImageKey !== patch.coverImageKey) {
    await deleteOldCover(env, previousCoverImageKey)
  }

  return album
}

export async function deleteAlbum(
  db: PhotosDb,
  id: number,
  env: R2Env,
): Promise<void> {
  await db.delete(photoAlbumsTagsMap).where(eq(photoAlbumsTagsMap.albumId, id))
  const [deleted] = await db
    .delete(photoAlbums)
    .where(eq(photoAlbums.id, id))
    .returning({ coverImageKey: photoAlbums.coverImageKey })

  // Best-effort R2 cleanup, run only after the delete above already
  // succeeded — see deleteOldCover docblock.
  if (deleted) await deleteOldCover(env, deleted.coverImageKey)
}

/** Cheap existence probe for handlers that must 404. */
export async function albumExists(db: PhotosDb, id: number): Promise<boolean> {
  const [row] = await db
    .select({ id: photoAlbums.id })
    .from(photoAlbums)
    .where(eq(photoAlbums.id, id))
    .limit(1)
  return row !== undefined
}

/**
 * Creates the tag, or returns the existing one when the name is taken —
 * ON CONFLICT DO NOTHING (unique index on name) + re-select keeps concurrent
 * create-by-name race-safe. New tags start private with a fresh opaque
 * public id (always generated — DATA_MODEL photo_tags).
 */
export async function createTag(db: PhotosDb, name: string): Promise<PhotoTag> {
  const [created] = await db
    .insert(photoTags)
    .values({ name, publicId: newPublicId() })
    .onConflictDoNothing({ target: photoTags.name })
    .returning()
  if (created) return created
  const [existing] = await db
    .select()
    .from(photoTags)
    .where(eq(photoTags.name, name))
    .limit(1)
  if (!existing) throw new Error(`Tag not resolved: ${name}`)
  return existing
}

/**
 * Replaces the album's tag set. Tags are addressed by name; missing ones are
 * created on the fly (private, with a public id). PRIVATE tags left without
 * any album reference after the replacement are garbage-collected — but
 * PUBLIC tags always survive: their opaque public id anchors a live `/t/`
 * share URL, which must keep working (listed with zero albums) until the tag
 * is explicitly deleted. The articles repo.setTags GC analogy stops there —
 * article tags carry no share URLs.
 */
export async function setAlbumTags(
  db: PhotosDb,
  albumId: number,
  tagNames: string[],
): Promise<void> {
  const names = [...new Set(tagNames.map((name) => name.trim()))].filter(
    (name) => name.length > 0,
  )

  const existing =
    names.length > 0
      ? await db.select().from(photoTags).where(inArray(photoTags.name, names))
      : []
  const existingByName = new Map(existing.map((tag) => [tag.name, tag.id]))

  const missing = names.filter((name) => !existingByName.has(name))
  if (missing.length > 0) {
    const created = await db
      .insert(photoTags)
      .values(missing.map((name) => ({ name, publicId: newPublicId() })))
      .onConflictDoNothing({ target: photoTags.name })
      .returning()
    for (const tag of created) existingByName.set(tag.name, tag.id)

    // Rows a concurrent writer won are re-selected.
    const lost = missing.filter((name) => !existingByName.has(name))
    if (lost.length > 0) {
      const raced = await db
        .select()
        .from(photoTags)
        .where(inArray(photoTags.name, lost))
      for (const tag of raced) existingByName.set(tag.name, tag.id)
    }
  }

  const previous = await db
    .select({ tagId: photoAlbumsTagsMap.tagId })
    .from(photoAlbumsTagsMap)
    .where(eq(photoAlbumsTagsMap.albumId, albumId))

  await db
    .delete(photoAlbumsTagsMap)
    .where(eq(photoAlbumsTagsMap.albumId, albumId))
  if (names.length > 0) {
    await db.insert(photoAlbumsTagsMap).values(
      names.map((name) => {
        const tagId = existingByName.get(name)
        if (tagId === undefined) throw new Error(`Tag not resolved: ${name}`)
        return { albumId, tagId }
      }),
    )
  }

  // GC: PRIVATE tags this album just dropped that no other album references.
  // Public tags are never GCed here — their /t/ share URL must stay alive.
  const kept = new Set(existingByName.values())
  const removed = previous
    .map((row) => row.tagId)
    .filter((tagId) => !kept.has(tagId))
  if (removed.length > 0) {
    await db
      .delete(photoTags)
      .where(
        and(
          inArray(photoTags.id, removed),
          eq(photoTags.visibility, 'private'),
          notInArray(
            photoTags.id,
            db
              .select({ tagId: photoAlbumsTagsMap.tagId })
              .from(photoAlbumsTagsMap),
          ),
        ),
      )
  }
}

/** Every album with its tags, recently-touched first — for `/app/photos`. */
export async function listAlbums(db: PhotosDb): Promise<AlbumWithTags[]> {
  const albums = await db
    .select()
    .from(photoAlbums)
    .orderBy(...newestFirst)
  if (albums.length === 0) return []

  const links = await db
    .select({ albumId: photoAlbumsTagsMap.albumId, tag: photoTags })
    .from(photoAlbumsTagsMap)
    .innerJoin(photoTags, eq(photoAlbumsTagsMap.tagId, photoTags.id))
    .where(
      inArray(
        photoAlbumsTagsMap.albumId,
        albums.map((album) => album.id),
      ),
    )
    .orderBy(photoTags.name)

  const tagsByAlbum = new Map<number, PhotoTag[]>()
  for (const { albumId, tag } of links) {
    const tags = tagsByAlbum.get(albumId) ?? []
    tags.push(tag)
    tagsByAlbum.set(albumId, tags)
  }
  return albums.map((album) => ({
    ...album,
    tags: tagsByAlbum.get(album.id) ?? [],
  }))
}

/** Albums carrying the tag, recently-touched first — for the tag pages. */
export async function listByTag(
  db: PhotosDb,
  tagId: number,
): Promise<PhotoAlbum[]> {
  const rows = await db
    .select({ album: photoAlbums })
    .from(photoAlbumsTagsMap)
    .innerJoin(photoAlbums, eq(photoAlbumsTagsMap.albumId, photoAlbums.id))
    .where(eq(photoAlbumsTagsMap.tagId, tagId))
    .orderBy(...newestFirst)
  return rows.map((row) => row.album)
}

export async function listTags(db: PhotosDb): Promise<PhotoTag[]> {
  return db.select().from(photoTags).orderBy(photoTags.name)
}

/** Tag lookup for `/app/photos/tags/:id` — null drives the 404. */
export async function getTagById(
  db: PhotosDb,
  id: number,
): Promise<PhotoTag | null> {
  const [tag] = await db
    .select()
    .from(photoTags)
    .where(eq(photoTags.id, id))
    .limit(1)
  return tag ?? null
}

export async function setTagVisibility(
  db: PhotosDb,
  id: number,
  visibility: PhotoTagVisibility,
): Promise<void> {
  await db.update(photoTags).set({ visibility }).where(eq(photoTags.id, id))
}

export type PublicTag = PhotoTag & { albums: PhotoAlbum[] }

/**
 * Public accessor for `/t/:publicId` — returns ONLY public tags, filtered in
 * SQL, so private tags are unreachable here by construction
 * (TECH_DECISIONS §9).
 */
export async function getPublicTagByPublicId(
  db: PhotosDb,
  publicId: string,
): Promise<PublicTag | null> {
  const [tag] = await db
    .select()
    .from(photoTags)
    .where(
      and(eq(photoTags.publicId, publicId), eq(photoTags.visibility, 'public')),
    )
    .limit(1)
  if (!tag) return null
  return { ...tag, albums: await listByTag(db, tag.id) }
}

/** Owner-side album lookup with tags — drives the edit page (404 on null). */
export async function getAlbumById(
  db: PhotosDb,
  id: number,
): Promise<AlbumWithTags | null> {
  const [album] = await db
    .select()
    .from(photoAlbums)
    .where(eq(photoAlbums.id, id))
    .limit(1)
  if (!album) return null
  const tags = await db
    .select({ tag: photoTags })
    .from(photoAlbumsTagsMap)
    .innerJoin(photoTags, eq(photoAlbumsTagsMap.tagId, photoTags.id))
    .where(eq(photoAlbumsTagsMap.albumId, id))
    .orderBy(photoTags.name)
  return { ...album, tags: tags.map((row) => row.tag) }
}
