# Pages (custom subpages)

## Problem

The owner wants to build custom landing pages at a chosen URL slug — e.g. a "Travel" page collecting every article tagged `travel`, or a hand-picked "Best of 2026" page — each rendered as a tile grid (photo, title, link) of articles. Nothing like this exists today: the public site has only the homepage, individual article pages (`/a/:publicId`), and the photo-hub tag pages (`/t/:publicId`).

Scope: articles only for now. Other content types (photos, album links) are explicitly deferred — the design should not make adding them later awkward, but does not need to build for it now.

## Data model

New `pages` table:

| column | type | notes |
|---|---|---|
| `id` | identity bigint | internal only — used for admin edit routes, never exposed publicly |
| `slug` | text, unique | the public URL path (`peterjur.co/<slug>`) — validated `^[a-z0-9]+(-[a-z0-9]+)*$`, and rejected if it matches a reserved segment: `a`, `t`, `app`, `api` (the site's actual existing top-level routes, confirmed via `src/pages/`), plus `admin` reserved defensively (a word an owner might expect to be special, even though no such route exists today) |
| `title` | text | shown as an H1 on the public page |
| `visibility` | enum `private`/`public` | default `private`. A private page 404s at its URL for everyone, including the owner — same "unreachable by construction" semantics as private articles (`getByPublicId`); there is no preview-while-private mode. Toggling to public keeps the same slug/URL. |
| `mode` | enum `manual`/`auto` | fixed per page — a page is either a curated list or a live filter, never both, and never switches which columns are "live" below |
| `articleIds` | integer array, ordered | used when `mode = 'manual'`. The manually-picked articles, in display order — same shape as `home_tiles.imageKeys`, no separate join table (no per-relation metadata is needed, and no query ever needs "which pages contain article X") |
| `categoryId` | nullable FK → `article_categories` | used when `mode = 'auto'`; exactly one of `categoryId`/`tagId` is set, never both |
| `tagId` | nullable FK → `article_tags` | see above |
| `sortKey` | enum `created_desc`/`created_asc`/`title_asc`/`title_desc` | used when `mode = 'auto'`; sorts by `articles.created_at` (not `updated_at` — editing an old article shouldn't bump it to the top of a showcase page) or `articles.title` |
| `createdAt`/`updatedAt` | timestamp | standard |

No `publicId` column: unlike articles or photo tags, the slug itself is the public identifier by design — the owner picks it, and it IS the URL. The internal `id` exists purely for admin routing (`/app/pages/:id`).

## Resolving a page's tiles

One function, `resolveArticlesForPage(db, page)`, in `src/lib/pages/repo.ts`:

- `mode = 'manual'`: fetches the rows in `articleIds` and returns them in that exact order (skipping any id that no longer exists — an article can be deleted independently of a page referencing it; no cleanup job needed, the stale id is just silently skipped at render time).
- `mode = 'auto'`: queries articles by `categoryId` or `tagId` (whichever is set), `visibility = 'public'` only (a page never leaks a private article's existence), ordered by `sortKey`.

Either branch returns the same shape: `{ publicId: string; title: string; imageUrl: string | null }[]`.

**Image resolution** (per article, in order of preference):
1. `featuredPhotoKey`, if set (WP-migration-only field, but still valid when present).
2. Otherwise, the first image in the article body, via the existing `extractImageKeys(content)[0]` (built for the R2-orphan-cleanup feature — no new logic needed, just reused).
3. Otherwise `null` — the tile renders as the text-only variant (see Rendering below), never a placeholder graphic. A missing image should be visually obvious, not papered over.

## Components

Follows the existing articles-feature template exactly:

- **`src/lib/pages/repo.ts`** — `createPage`, `updatePage` (handles slug/title/visibility changes, switching mode, rewriting `articleIds` or the category/tag/sortKey trio), `deletePage`, `getBySlug` (public, `visibility='public'` only), `getById` (admin), `listForOwner` (admin list, all visibilities), `resolveArticlesForPage` (above), plus a pure `validateSlug(slug): string | null` (format + reserved-word check; DB unique constraint is the final authority on collisions).
- **`src/pages/api/pages/index.ts`** (POST create) and **`src/pages/api/pages/[id].ts`** (PATCH/DELETE) — thin validating routes mirroring `src/pages/api/articles/*`.
- **Admin UI**, under `src/pages/app/pages/`:
  - `index.astro` — list of pages (title, slug, visibility, mode) with create/delete.
  - `new.astro` / `[id].astro` — edit form: title, slug, visibility toggle, mode selector. Manual mode shows an article multi-picker + drag-to-reorder (reusing `FeaturedReorder.tsx`'s hand-rolled HTML5 drag-and-drop — no new dependency). Auto mode shows a category-or-tag selector and a sort-key dropdown. Switching modes in the UI clears the other mode's fields.
- **Public route — `src/pages/[slug].astro`** (root-level catch-all): `getBySlug` → 404 if not found; render `title` as an H1, then the tile grid.

## Rendering

Tile layout follows the approved mockup's **option B**: the article's image fills the tile, with the title sitting on a dark gradient scrim at the bottom (`linear-gradient(to top, rgba(23,20,15,0.85), transparent 55%)` over the photo, matching the site's ink color). An imageless article renders as a plain centered-text tile instead (no image area at all) — this is the "first" (leftmost) variant from the mockup's text-only row, not a placeholder image. Every tile links to `/a/:publicId`. Grid uses the photo-hub page's `auto-fill`/`minmax` CSS pattern, adapted inline in `[slug].astro` the same way `t/[publicId].astro` does today (not extracted into a shared component — the existing tile markup isn't reusable as one, per this session's earlier research, and duplicating ~100 lines of grid CSS is cheaper than a premature abstraction).

## Error handling

- Invalid/duplicate slug on create or edit → 400 with a specific message (format error vs. reserved word vs. already taken).
- `mode='auto'` with both or neither of `categoryId`/`tagId` set → 400 (validated at the API layer, same style as `parsePatch` in `api/articles/[id].ts`).
- A stale `articleId` in a manual page's list (its article was deleted) is silently skipped when resolving tiles — not an error, not cleaned up proactively.
- Public route: not found OR private → plain 404, no distinction shown to the visitor (matches existing private-article behavior).

## Testing

- `src/lib/pages/repo.ts`: `resolveArticlesForPage` for both modes — manual order preserved (including a stale id being skipped), auto-mode category filter, auto-mode tag filter, all four `sortKey` values, and the image-resolution fallback chain (featuredPhotoKey → first body image → null).
- `validateSlug`: valid formats accepted, invalid formats rejected (uppercase, spaces, leading/trailing hyphen, empty), reserved words rejected.
- API route tests for `POST /api/pages`, `PATCH /api/pages/:id`, `DELETE /api/pages/:id` mirroring the shape of the existing `tests/media.presign.e2e.test.ts`-style API tests: auth required, validation errors, happy path.
- `src/pages/[slug].astro`: renders a public page's tiles; 404s for an unknown slug and for a private page's slug.
