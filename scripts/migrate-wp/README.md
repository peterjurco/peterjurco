# WordPress migration

Plan: [`plans/08-migration.md`](../../plans/08-migration.md). Spec refs:
`DATA_MODEL.md` "Migration considerations", `REQUIREMENTS.md` "Migration".

## Built (Tasks 1–2 — pure converters, no WP dump needed)

- **`html-to-tiptap.ts`** — converts WP `post_content` HTML into the
  ProseMirror JSON the article editor and public renderer share
  (`src/lib/articles/extensions.ts`, `src/lib/articles/render-doc.ts`).
  Handles headings, bold/italic/strike, links (unsafe schemes dropped),
  lists, blockquotes, images (`src` preserved as-is — **no rehosting to R2**,
  a deliberate later/optional step), paragraphs and line breaks. Unknown or
  unsupported tags degrade to plain paragraphs instead of throwing, since a
  real WP export always has some markup the schema doesn't model.

  ```ts
  import { htmlToTiptap } from './html-to-tiptap'
  const doc = htmlToTiptap(wpPost.post_content)
  ```

- **`map-taxonomy.ts`** — maps WP `wp_terms` (categories, `post_tag`) to
  `article_categories`/`article_tags`, idempotently (upsert by name; safe to
  re-run against the same input without duplicating rows). Returns lookup
  maps keyed by WP term id, for the (not-yet-built) import step to resolve
  each post's category/tags against.

  ```ts
  import { mapTaxonomy } from './map-taxonomy'
  const { categoryIdByWpId, tagIdByWpId } = await mapTaxonomy(db, {
    categories: [{ wpId: 4, name: 'Travel' }],
    tags: [{ wpId: 12, name: 'hiking' }],
  })
  ```

### Running the tests

Both are exercised by the normal test suite (`pnpm test`), or individually:

```sh
pnpm exec vitest run tests/migrate-wp/html-to-tiptap.test.ts
pnpm exec vitest run tests/migrate-wp/map-taxonomy.test.ts
```

`map-taxonomy.test.ts` hits the real local Postgres test database (see
`tests/helpers/test-db.ts`) — the Docker test services must be running
(`docker compose -f docker-compose.test.yml up -d`, port 5544).

## Blocked (Tasks 3–5 — need the real WordPress DB dump)

**Not started.** These require the author to export and hand over the
WordPress database dump first (`TECH_DECISIONS.md`: "WordPress DB dump —
the only remaining blocker"):

- **Task 3 — dump reader** (`read-dump.ts`): parses `wp_posts`, `wp_terms`,
  `wp_term_taxonomy`, `wp_term_relationships` from the real dump into typed
  rows. Its exact shape depends on inspecting the actual dump format, which
  doesn't exist yet.
- **Task 4 — import orchestrator + report** (`import.ts`): `--dry-run` /
  `--apply` orchestration wiring the dump reader through `html-to-tiptap`
  and `map-taxonomy` into `articles` (keyed by `legacy_wp_id` for
  idempotent re-runs), writing `migration-report.json` for posts with 2+
  categories — those are never auto-assigned, only flagged for manual
  resolution (DATA_MODEL "Migration considerations").
- **Task 5 — run + resolve**: the actual production import run against the
  real dump, plus the author resolving flagged multi-category posts.

Do not stub these out — there is nothing to build against without the dump.
