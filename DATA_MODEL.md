# peterjur.co — Data Model

Postgres schema for the rebuild. Reflects decisions in
[TECH_DECISIONS.md](./TECH_DECISIONS.md) (visibility model, opaque public IDs)
and [REQUIREMENTS.md](./REQUIREMENTS.md). Written 2026-07-06.

## Conventions

- `id` — internal bigint primary key, never exposed in a public-facing URL.
- `public_id` — opaque, random, unique identifier (nanoid-style) used in URLs
  for anything reachable **without authentication** (articles, public photo
  tags). Prevents enumeration of unlisted resources — see TECH_DECISIONS §9.
- Category/tag **list pages are auth-only navigation** (you must be logged in
  to browse them at all), so they're addressed by the plain internal `id` —
  no enumeration risk, no need for an opaque ID there.
- `created_at` / `updated_at` on every table unless noted otherwise.

## 1. Auth & sessions

### `users`
Single-user app, but modeled as a real table (not hardcoded) so OIDC login and
sessions have somewhere to land.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigint PK | |
| `google_sub` | text, unique | Google's stable subject ID |
| `email` | text | |
| `name` | text | |
| `avatar_url` | text, nullable | |
| `created_at` | timestamptz | |

Login only succeeds if the Google account's email matches an **allow-list in
env config** — not a DB table, since it's effectively a constant for a
single-user app.

### `sessions`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigint PK | |
| `user_id` | FK → `users.id` | |
| `token_hash` | text | Opaque session token, hashed at rest |
| `created_at` | timestamptz | |
| `expires_at` | timestamptz | Far future (e.g. +5y); refreshed on activity to implement "stay signed in indefinitely" |
| `revoked_at` | timestamptz, nullable | Kill switch (e.g. lost device) — the one sharp edge of an indefinite session |

## 2. Articles + taxonomy

### `article_categories`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigint PK | |
| `name` | text | |
| `created_at` | timestamptz | Flat list — no parent/hierarchy |

### `article_tags`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigint PK | |
| `name` | text | |

### `articles`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigint PK | Internal only |
| `public_id` | text, unique, indexed | Opaque — used in the URL for **every** article regardless of visibility, so the URL never changes when visibility is toggled |
| `title` | text | |
| `content` | jsonb | Raw TipTap / ProseMirror document |
| `category_id` | FK → `article_categories.id`, nullable | One category per article |
| `featured_photo_key` | text, nullable | R2 object key |
| `visibility` | enum(`private`, `public`) | Default `private` |
| `is_featured` | boolean | Default `false` |
| `featured_position` | int, nullable | Manual drag-order among featured articles; meaningful only when `is_featured` |
| `legacy_wp_id` | int, nullable | Traceability back to the WordPress dump |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | No revision history — single mutable row |

OG/social preview description is **auto-derived from `content`** (e.g. first
paragraph) at render time — no separate excerpt column.

### `article_tags_map` (join table)

| Column | Type |
| --- | --- |
| `article_id` | FK → `articles.id` |
| `tag_id` | FK → `article_tags.id` |

## 3. Photo hub + taxonomy

### `photo_tags`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigint PK | |
| `name` | text | |
| `visibility` | enum(`private`, `public`) | Default `private` — this is where "mark a tag as public" lives; the shareable URL belongs to the **tag**, not to individual albums |
| `public_id` | text, unique, indexed | Always generated for consistency; only reachable/meaningful while `visibility = public` |

### `photo_albums`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigint PK | |
| `name` | text | |
| `google_photos_url` | text | |
| `cover_image_key` | text, nullable | R2 object key, manually uploaded |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `photo_albums_tags_map` (join table)

| Column | Type |
| --- | --- |
| `album_id` | FK → `photo_albums.id` |
| `tag_id` | FK → `photo_tags.id` |

## 4. "My apps" list

### `apps`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigint PK | |
| `name` | text | |
| `url` | text | |
| `icon_key` | text, nullable | R2 object key |
| `sort_order` | int | |

## 5. Public homepage tiles

Design session complete (see [DESIGN.md](./DESIGN.md)). The public page is a
**freeform canvas** — tiles are absolutely positioned, not grid-packed — so the
schema stores per-tile layout, not grid spans.

### `home_tiles`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigint PK | |
| `kind` | enum(`photo`, `quote`) | photo tile vs text/quote tile |
| `image_key` | text, nullable | R2 object key — for `photo` tiles |
| `text_content` | text, nullable | quote text — for `quote` tiles |
| `cite` | text, nullable | attribution line — for `quote` tiles |
| `x` | numeric | position (canvas units / %) |
| `y` | numeric | position |
| `width` | numeric | size |
| `height` | numeric | size |
| `rotation` | numeric | degrees; default 0 |
| `border` | jsonb, nullable | border style (width/color/none) — editable per block |
| `hover_effect` | text, nullable | e.g. `develop` (default), or none — editable per block |
| `z_index` | int | stacking order |
| `cycle_group` | text, nullable | tiles sharing a group crossfade between each other |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

The admin edits these via a **freeform canvas editor** (move / resize / rotate /
border / hover-effect per block — see REQUIREMENTS "Admin edit model"). The
public renderer just paints tiles from their stored layout. Canvas coordinate
system (absolute px vs. percentage-of-canvas for responsiveness) is an
implementation-plan decision.

## Migration considerations

- WordPress `wp_posts` → `articles`; `wp_terms` / `wp_term_taxonomy` →
  `article_categories` / `article_tags`.
- **Multi-category posts are not auto-resolved.** WordPress allows multiple
  categories per post; the new schema allows only one. The migration script
  must **detect** posts with more than one category and output them as a
  **flagged list** (e.g. WP post ID, title, and the candidate categories) for
  manual resolution — nothing is silently dropped or auto-picked, and nothing
  extra is stored in the schema for this.
- `legacy_wp_id` on `articles` keeps a stable link back to the source dump so
  the migration is traceable and reruns are idempotent.
