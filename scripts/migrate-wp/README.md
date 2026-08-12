# WordPress migration

Plan: [`plans/08-migration.md`](../../plans/08-migration.md). Spec refs:
`DATA_MODEL.md` "Migration considerations", `REQUIREMENTS.md` "Migration".

## Built

- **`html-to-tiptap.ts`** — converts WP `post_content` HTML into the
  ProseMirror JSON the article editor and public renderer share
  (`src/lib/articles/extensions.ts`, `src/lib/articles/render-doc.ts`).
  Handles headings, bold/italic/strike, links (unsafe schemes dropped),
  lists, blockquotes, images (`src` preserved as-is at this layer — rehosting
  to R2 is a separate pass, see `rehost-image.ts`), paragraphs and line
  breaks. Unknown or unsupported tags degrade to plain paragraphs instead of
  throwing, since a real WP export always has some markup the schema doesn't
  model.

  ```ts
  import { htmlToTiptap } from './html-to-tiptap'
  const doc = htmlToTiptap(wpPost.post_content)
  ```

- **`map-taxonomy.ts`** — maps WP `wp_terms` (categories, `post_tag`) to
  `article_categories`/`article_tags`, idempotently (upsert by name; safe to
  re-run against the same input without duplicating rows). Returns lookup
  maps keyed by WP term id, which `import.ts` resolves each post's
  category/tags against.

  ```ts
  import { mapTaxonomy } from './map-taxonomy'
  const { categoryIdByWpId, tagIdByWpId } = await mapTaxonomy(db, {
    categories: [{ wpId: 4, name: 'Travel' }],
    tags: [{ wpId: 12, name: 'hiking' }],
  })
  ```

- **`read-dump.ts`** — reads the real WordPress export via a live
  MySQL-compatible connection (the `mysql2` driver — never the raw `.sql`
  dump text; multi-row `INSERT`s with embedded escaped quotes/newlines are
  genuinely unsafe to regex-parse, and that approach was tried and rejected).
  `readRealPosts(conn)` returns every "real" post — `wp_posts` rows with
  `post_type = 'post'` and `post_status IN ('publish', 'draft', 'private')`
  (everything else — attachments, revisions, nav menu items, pages, trash —
  is excluded) — each with its title, content HTML, real WP dates, WP status
  (informational only; see below), categories/tags shaped as `WpTerm[]`
  (`map-taxonomy.ts`'s input shape), and its featured image URL (via
  `_thumbnail_id` postmeta → the attachment's `guid`) when set.

- **`rehost-image.ts`** — fetches an image from the still-live old WP site
  and re-uploads it to R2, reusing `presignPut()`/`objectKey()`/
  `ALLOWED_IMAGE_CONTENT_TYPES`/`MAX_UPLOAD_BYTES` from `src/lib/media/r2.ts`
  rather than duplicating upload/validation logic. `isOwnedUrl(url,
  ownedHost)` gates every rehost attempt BEFORE any fetch — only the old
  site's own domain (`peterjur.co`, or its `www.` variant) is ever fetched;
  any other hostname (external embeds, hotlinked images) is left untouched,
  per the owner's decision never to rehost content that isn't theirs.
  `rehostImage()` never throws: a failed fetch, disallowed content type,
  oversized response or failed upload logs a warning and resolves to `null`,
  so one bad image never aborts the run. A `Map<sourceUrl, key | null>`
  passed in by the caller dedupes repeats (including cached failures) across
  a whole import run.

- **`import.ts`** — the `--dry-run`/`--apply` orchestrator; see "Running the
  import" below.

## Running the tests

All of the above are exercised by the normal test suite (`pnpm test`), or
individually:

```sh
pnpm exec vitest run tests/migrate-wp/html-to-tiptap.test.ts
pnpm exec vitest run tests/migrate-wp/map-taxonomy.test.ts
pnpm exec vitest run tests/migrate-wp/read-dump.test.ts
pnpm exec vitest run tests/migrate-wp/rehost-image.test.ts
pnpm exec vitest run tests/migrate-wp/import.test.ts
```

These hit real local services (never mocked SQL/S3) — the Docker test
services must be running:

```sh
docker compose -f docker-compose.test.yml up -d
```

This starts, alongside the existing Postgres/MinIO/neon-http-proxy services,
a disposable **`wp-mysql`** MariaDB container (port 3316) standing in for a
WordPress export. `read-dump.test.ts`/`import.test.ts` create their own
minimal `wp_posts`/`wp_postmeta`/`wp_terms`/`wp_term_taxonomy`/
`wp_term_relationships` tables and seed a small hand-written fixture
(`tests/helpers/test-wp-db.ts`) — never a full WP install, and never the real
dump's content (that must never land in a test fixture; see `.gitignore`).

## Running the import for real

### 1. Get the WordPress export into a MySQL-compatible database

Load the author's `mysqldump` export into a scratch MariaDB container:

```sh
docker run -d --name wp-migrate-mysql -e MARIADB_ROOT_PASSWORD=root -e MARIADB_DATABASE=wp_migrate -p 3399:3306 mariadb:11
# wait for the container to become healthy, then:
docker exec -i wp-migrate-mysql mariadb -uroot -proot wp_migrate < scripts/migrate-wp/wp-dump
```

The dump's own header (`# Backup of:` / `# Home URL:`) names the site's real
domain — this is also `WP_OWNED_HOST` below (the real dump's is
`peterjur.co`, already the default).

### 2. Set environment variables

```sh
# Source (the container above):
WP_MYSQL_URL=mysql://root:root@localhost:3399/wp_migrate
# Only needed if the export's Home URL differs from peterjur.co:
WP_OWNED_HOST=peterjur.co

# Target Postgres — see the WARNING below.
DATABASE_URL=postgresql://...

# Real R2 credentials — required for --apply (image rehosting); irrelevant
# for --dry-run, which never fetches or uploads anything.
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...
PUBLIC_R2_PUBLIC_BASE_URL=...
```

**WARNING — `DATABASE_URL` here is the *target* the script writes to.**
Point it at a throwaway/local Postgres while reviewing the plan; only point
it at the real production database once `migration-report.json` has been
reviewed and the author is ready (Task 5). `--dry-run` never writes
regardless, but there's no reason to take the risk early.

### 3. Dry run (always start here — zero side effects)

```sh
pnpm migrate-wp --dry-run
```

Reads WP MySQL and, read-only, the target Postgres (to tell new-vs-existing
posts apart by `legacy_wp_id`). Makes no writes, creates no taxonomy rows,
and never fetches or uploads a single image. Writes
`scripts/migrate-wp/migration-report.json` (gitignored) with: post counts,
the multi-category posts that need a manual category pick (WP id, title,
candidate category names — **never auto-assigned**, per DATA_MODEL), and the
inline/featured images that *would* be rehosted vs. left as external.

### 4. Apply (real writes)

```sh
pnpm migrate-wp --apply
```

Same report shape, but for real: articles are created/updated (idempotent by
`legacy_wp_id` — re-running never duplicates), categories/tags are
created/reused via `mapTaxonomy()`, owned-domain images are fetched and
re-uploaded to R2 (external images keep their original URL untouched), and
`visibility` is unconditionally `private` regardless of the WP post's
original status (owner decision — WP `publish`/`draft`/`private` all map the
same way here).

## Task 5 — run + resolve (author-driven, not scripted)

1. Run `--dry-run` against the real dump; review `migration-report.json`
   with the author — start with its `summary` and `failedImages`, then
   `multiCategoryPosts` for the flagged posts.
2. Run `--apply`. For each post in `multiCategoryPosts`, open it in the
   article editor (`/app/articles/:id`) and set its category by hand — the
   script never reads or applies category decisions itself, it only ever
   leaves them null. A later re-run (e.g. to pick up a newly-discovered
   post) will not overwrite a category you've already set this way, even
   though the post is still multi-category in the WP dump.
3. Spot-check migrated articles in the editor and public view.

**Acceptance:** all WP posts present in the new system; multi-category cases
resolved by hand, not by the script.
