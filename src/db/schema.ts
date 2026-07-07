import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

// Two visibility states (TECH_DECISIONS §9): `private` (only me) and
// `public` (public-by-link, unlisted).
export const articleVisibility = pgEnum('article_visibility', [
  'private',
  'public',
])
export const photoTagVisibility = pgEnum('photo_tag_visibility', [
  'private',
  'public',
])
export const homeTileKind = pgEnum('home_tile_kind', ['photo', 'quote'])

// 1. Auth & sessions -------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    googleSub: text('google_sub').notNull(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    avatarUrl: text('avatar_url'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('users_google_sub_unique').on(table.googleSub)],
)

export const sessions = pgTable(
  'sessions',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id),
    // Opaque session token, hashed at rest.
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Far future (e.g. +5y); refreshed on activity ("stay signed in indefinitely").
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // Kill switch (e.g. lost device).
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  // Session lookup by token hash happens on every authenticated request.
  (table) => [index('sessions_token_hash_idx').on(table.tokenHash)],
)

// 2. Articles + taxonomy ---------------------------------------------------

export const articleCategories = pgTable('article_categories', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  name: text('name').notNull(),
  // Flat list — no parent/hierarchy.
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const articleTags = pgTable(
  'article_tags',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    name: text('name').notNull(),
  },
  // Tags are addressed by name (repo.setTags) — the unique index makes
  // concurrent create-by-name race-safe via ON CONFLICT.
  (table) => [uniqueIndex('article_tags_name_unique').on(table.name)],
)

export const articles = pgTable(
  'articles',
  {
    // Internal only — never exposed in URLs.
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    // Opaque — used in the URL for every article regardless of visibility.
    publicId: text('public_id').notNull(),
    title: text('title').notNull(),
    // Raw TipTap / ProseMirror document.
    content: jsonb('content').notNull(),
    // One category per article.
    categoryId: bigint('category_id', { mode: 'number' }).references(
      () => articleCategories.id,
    ),
    // R2 object key.
    featuredPhotoKey: text('featured_photo_key'),
    visibility: articleVisibility('visibility').notNull().default('private'),
    isFeatured: boolean('is_featured').notNull().default(false),
    // Manual drag-order among featured articles; meaningful only when isFeatured.
    featuredPosition: integer('featured_position'),
    // Traceability back to the WordPress dump.
    legacyWpId: integer('legacy_wp_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // No revision history — single mutable row.
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('articles_public_id_unique').on(table.publicId),
    index('articles_category_id_idx').on(table.categoryId),
  ],
)

export const articleTagsMap = pgTable(
  'article_tags_map',
  {
    articleId: bigint('article_id', { mode: 'number' })
      .notNull()
      .references(() => articles.id),
    tagId: bigint('tag_id', { mode: 'number' })
      .notNull()
      .references(() => articleTags.id),
  },
  (table) => [
    primaryKey({ columns: [table.articleId, table.tagId] }),
    index('article_tags_map_article_id_idx').on(table.articleId),
    index('article_tags_map_tag_id_idx').on(table.tagId),
  ],
)

// 3. Photo hub + taxonomy --------------------------------------------------

export const photoTags = pgTable(
  'photo_tags',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    name: text('name').notNull(),
    // "Mark a tag as public" lives here; the shareable URL belongs to the tag.
    visibility: photoTagVisibility('visibility').notNull().default('private'),
    // Always generated for consistency; only meaningful while visibility = public.
    publicId: text('public_id').notNull(),
  },
  (table) => [uniqueIndex('photo_tags_public_id_unique').on(table.publicId)],
)

export const photoAlbums = pgTable('photo_albums', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  name: text('name').notNull(),
  googlePhotosUrl: text('google_photos_url').notNull(),
  // R2 object key, manually uploaded.
  coverImageKey: text('cover_image_key'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const photoAlbumsTagsMap = pgTable(
  'photo_albums_tags_map',
  {
    albumId: bigint('album_id', { mode: 'number' })
      .notNull()
      .references(() => photoAlbums.id),
    tagId: bigint('tag_id', { mode: 'number' })
      .notNull()
      .references(() => photoTags.id),
  },
  (table) => [
    primaryKey({ columns: [table.albumId, table.tagId] }),
    index('photo_albums_tags_map_album_id_idx').on(table.albumId),
    index('photo_albums_tags_map_tag_id_idx').on(table.tagId),
  ],
)

// 4. "My apps" list ---------------------------------------------------------

export const apps = pgTable('apps', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  // R2 object key.
  iconKey: text('icon_key'),
  sortOrder: integer('sort_order').notNull(),
})

// 5. Public homepage tiles --------------------------------------------------

export const homeTiles = pgTable('home_tiles', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  kind: homeTileKind('kind').notNull(),
  // R2 object key — for `photo` tiles.
  imageKey: text('image_key'),
  // Quote text — for `quote` tiles.
  textContent: text('text_content'),
  // Attribution line — for `quote` tiles.
  cite: text('cite'),
  // Freeform canvas layout (canvas units / %).
  x: numeric('x', { mode: 'number' }).notNull(),
  y: numeric('y', { mode: 'number' }).notNull(),
  width: numeric('width', { mode: 'number' }).notNull(),
  height: numeric('height', { mode: 'number' }).notNull(),
  // Degrees.
  rotation: numeric('rotation', { mode: 'number' }).notNull().default(0),
  // Border style (width/color/none) — editable per block.
  border: jsonb('border'),
  // E.g. `develop` (default), or none — editable per block.
  hoverEffect: text('hover_effect'),
  zIndex: integer('z_index').notNull(),
  // Tiles sharing a group crossfade between each other.
  cycleGroup: text('cycle_group'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})
