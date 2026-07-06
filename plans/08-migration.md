# WordPress Migration Implementation Plan

> **For agentic workers:** Implement task-by-task. Each task ends with green tests and a commit.
> **BLOCKED until the author provides the WordPress DB dump.** Do not start Task 3+ without it.

**Goal:** A repeatable, idempotent script that imports the existing WordPress content (articles, categories, tags) into the new schema, and flags posts that need manual decisions (multi-category) instead of guessing.

**Architecture:** A standalone Node script reads the WP dump (posts, terms, term relationships), maps `wp_posts(post_type='post', post_status in publish/draft/private)` → `articles`, converts post HTML → TipTap/ProseMirror JSON, maps taxonomies → `article_categories`/`article_tags`, and links via `legacy_wp_id` for idempotent re-runs. Posts with 2+ categories are **not auto-assigned** — they're written to a `migration-report.json` for the author to resolve, per DATA_MODEL.

**Tech Stack:** Node script, a MySQL/SQL dump reader (or a temporary local MySQL to query), an HTML→ProseMirror converter, Drizzle for writes.

**Depends on:** Plan 3 (articles schema/repo). **Needs:** the WP DB dump.

**Spec refs:** DATA_MODEL "Migration considerations", REQUIREMENTS "Migration", brainstorming note (multi-category → manual).

---

## File structure

```
scripts/migrate-wp/
├── read-dump.ts        # parse the WP dump into typed rows
├── map-taxonomy.ts     # WP terms → categories/tags (idempotent upsert)
├── html-to-tiptap.ts   # post_content HTML → ProseMirror JSON
├── import.ts           # orchestrator: dry-run + apply, writes migration-report.json
└── README.md           # how to run, env, expected dump format
tests/migrate-wp/
├── html-to-tiptap.test.ts
├── map-taxonomy.test.ts
└── import.test.ts
```

## Task 1: HTML → TipTap converter

**Files:** Create `scripts/migrate-wp/html-to-tiptap.ts`, `tests/migrate-wp/html-to-tiptap.test.ts`

- [ ] **Step 1:** Tests: convert representative WP post HTML (headings, bold/italic, links, lists, blockquotes, `<img>`, paragraphs) into ProseMirror JSON matching the article editor's schema (Plan 3). Unknown/unsupported tags degrade to paragraphs, never crash. Images keep their `src` (rehosting is a later, optional pass — note it).
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement using an HTML parser mapped to the TipTap schema (reuse the schema from Plan 3 so output is valid editor content).
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit — `feat(migrate): WP HTML → TipTap JSON`.

**Acceptance:** Converted docs open cleanly in the editor; no data loss for supported tags.

## Task 2: Taxonomy mapping

**Files:** Create `scripts/migrate-wp/map-taxonomy.ts`, `tests/migrate-wp/map-taxonomy.test.ts`

- [ ] **Step 1:** Tests: WP categories → `article_categories`, WP post_tags → `article_tags`, idempotent (re-run doesn't duplicate). Returns lookup maps keyed by WP term id.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement upserts by name.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit — `feat(migrate): taxonomy mapping`.

**Acceptance:** Terms map once; re-runs are stable.

## Task 3: Dump reader *(needs the real dump)*

**Files:** Create `scripts/migrate-wp/read-dump.ts`

- [ ] **Step 1:** Inspect the provided dump; document its exact format in `README.md`.
- [ ] **Step 2:** Implement reading `wp_posts`, `wp_terms`, `wp_term_taxonomy`, `wp_term_relationships` into typed rows (filter to real posts; capture per-post category ids, tag ids, timestamps, status → visibility mapping: WP `private`/`draft` → `private`, `publish` → decide with author, default `private`).
- [ ] **Step 3:** Add a fixture derived from the real dump; test parsing counts.
- [ ] **Step 4:** Commit — `feat(migrate): WP dump reader`.

**Acceptance:** Reader yields correct row counts from the real dump.

## Task 4: Import orchestrator + report

**Files:** Create `scripts/migrate-wp/import.ts`, `tests/migrate-wp/import.test.ts`

- [ ] **Step 1:** Tests (real Postgres, fixture dump): `--dry-run` reports what would import and lists **multi-category posts** (WP id, title, candidate category names) to `migration-report.json` with **no writes**. `--apply` imports articles (content via Task 1, single-category posts assigned; multi-category posts imported with **no category** + flagged), sets `legacy_wp_id`, attaches tags, sets timestamps. Re-running `--apply` updates by `legacy_wp_id` (idempotent), never duplicates.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement the orchestrator.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit — `feat(migrate): idempotent import + multi-category report`.

**Acceptance:** Dry-run is side-effect-free and flags every multi-category post; apply is idempotent and never auto-guesses a category.

## Task 5: Run + resolve

- [ ] **Step 1:** Run `--dry-run` against the real dump; review `migration-report.json` with the author.
- [ ] **Step 2:** Author resolves multi-category posts (choose the category) — record decisions; re-run `--apply`.
- [ ] **Step 3:** Spot-check migrated articles in the editor and public view.
- [ ] **Step 4:** Commit — `chore(migrate): production import complete`.

**Acceptance:** All WP posts present in the new system; multi-category cases resolved by hand, not by the script.

## Self-review notes
- Multi-category posts are flagged for manual resolution, never auto-picked (DATA_MODEL + brainstorming decision).
- `legacy_wp_id` gives idempotency (DATA_MODEL).
- Image rehosting from WP → R2 is called out as an optional follow-up, not silently assumed.
- Tasks 1–2 (pure converters) can be built before the dump arrives; Tasks 3–5 need it.
