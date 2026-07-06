# Ops & Extras Implementation Plan

> **For agentic workers:** Implement task-by-task. Each task ends with green tests and a commit.

**Goal:** The remaining functional pieces — Cloudflare Web Analytics, scheduled DB backups to R2, the "My apps" list CRUD, and the categories/tags admin.

**Architecture:** Analytics is a Cloudflare Web Analytics beacon injected site-wide. Backups run as a scheduled GitHub Action (`pg_dump` against Neon → upload to R2), independent of the Workers runtime. Apps and taxonomy admin are small owner-only CRUD surfaces reusing existing patterns.

**Tech Stack:** Cloudflare Web Analytics, GitHub Actions cron, `pg_dump`, R2 (aws-cli or S3 SDK), Drizzle.

**Depends on:** Plan 2 (auth). Independent of Plans 4/5/6.

**Spec refs:** REQUIREMENTS "Admin" (categories/tags, DB backups), "Analytics", "My apps"; TECH_DECISIONS §4 (backups), §7 (analytics).

---

## File structure

```
src/
├── lib/apps/repo.ts
├── lib/taxonomy/repo.ts           # rename/create/delete categories & tags
├── components/
│   ├── AppsAdmin.tsx
│   └── TaxonomyAdmin.tsx
├── layouts/BaseLayout.astro       # + analytics beacon (edit)
├── pages/app/admin/
│   ├── index.astro                # admin landing
│   ├── apps.astro
│   └── taxonomy.astro
└── pages/api/{apps,taxonomy}/...
.github/workflows/backup.yml
scripts/backup-db.sh
tests/{apps.repo,taxonomy.repo,backup}.test.ts
```

## Task 1: Cloudflare Web Analytics

**Files:** Edit `src/layouts/BaseLayout.astro`

- [ ] **Step 1:** Inject the Cloudflare Web Analytics beacon (token from `PUBLIC_CF_ANALYTICS_TOKEN` env) on all pages. Skip in dev.
- [ ] **Step 2:** Verify the beacon script tag renders only when the token is set; add a tiny render test.
- [ ] **Step 3:** Commit — `feat(analytics): Cloudflare Web Analytics beacon`.

**Acceptance:** Beacon present in prod HTML, absent without a token; no cookies, no consent banner (per §7).

## Task 2: DB backup GitHub Action

**Files:** Create `.github/workflows/backup.yml`, `scripts/backup-db.sh`, `tests/backup.test.ts`

- [ ] **Step 1:** `backup-db.sh`: `pg_dump "$DATABASE_URL"` → gzip → upload to R2 (`s3` endpoint) under a timestamped key; prune older than N days. Fail loudly on any step error.
- [ ] **Step 2:** `backup.yml`: scheduled cron (e.g. daily) + manual dispatch; secrets `DATABASE_URL`, R2 creds. Runs the script.
- [ ] **Step 3:** Test the script's key-naming/prune logic with a shell test (bats or a Node wrapper) using a fake uploader; assert timestamped key format and prune cutoff.
- [ ] **Step 4:** Trigger the workflow manually once; confirm an object lands in R2.
- [ ] **Step 5:** Commit — `feat(ops): scheduled Neon→R2 backups`.

**Acceptance:** A dump appears in R2 on schedule; old dumps pruned. (Complements Neon PITR — §4.)

## Task 3: My apps CRUD

**Files:** Create `src/lib/apps/repo.ts`, `src/components/AppsAdmin.tsx`, `src/pages/app/admin/apps.astro`, `src/pages/api/apps/*`

- [ ] **Step 1:** Repo tests (real Postgres): create/edit/delete app (name, url, optional `icon_key`, `sort_order`); `listOrdered()`.
- [ ] **Step 2:** Implement repo + owner-only API + admin UI (icon upload reuses Plan-5 presign if present; optional).
- [ ] **Step 3:** Wire the homepage "My apps" widget (Plan 4 slot) to `listOrdered()`.
- [ ] **Step 4:** Commit — `feat(apps): my-apps CRUD + homepage widget`.

**Acceptance:** Apps manageable and shown on the authenticated homepage.

## Task 4: Categories & tags admin

**Files:** Create `src/lib/taxonomy/repo.ts`, `src/components/TaxonomyAdmin.tsx`, `src/pages/app/admin/taxonomy.astro`, `src/pages/api/taxonomy/*`

- [ ] **Step 1:** Repo tests: create/rename/delete for both `article_categories` and `article_tags` and `photo_tags`; deleting a category detaches it from articles (set null), deleting a tag removes its join rows.
- [ ] **Step 2:** Implement repo + owner-only API + admin UI grouped (article categories, article tags, photo tags — including the public/private toggle for photo tags).
- [ ] **Step 3:** Commit — `feat(admin): categories & tags management`.

**Acceptance:** All taxonomies editable; deletes clean up references safely.

## Task 5: Admin landing

**Files:** Create `src/pages/app/admin/index.astro`

- [ ] **Step 1:** Owner-only landing linking Apps, Taxonomy, (and noting backups run via CI). No design/theme controls (REQUIREMENTS: visual changes are done in code by AI agents, not the admin).
- [ ] **Step 2:** Commit — `feat(admin): admin landing`.

**Acceptance:** `/app/admin` is the hub for the above.

## Self-review notes
- Analytics is Cloudflare, not GA (§7) — honors "Google gets no access".
- Backups run off-Workers via GitHub Actions (§4) — the deliberate runtime workaround.
- No visual-customization admin, per REQUIREMENTS.
