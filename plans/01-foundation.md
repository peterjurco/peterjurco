# Foundation Implementation Plan

> **For agentic workers:** Implement task-by-task. Each task ends with green tests and a commit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable Astro-on-Cloudflare skeleton wired to Neon Postgres with the full database schema, migrations tooling, and CI.

**Architecture:** Astro in SSR mode via `@astrojs/cloudflare` runs on Cloudflare Pages/Workers. Data access uses Drizzle ORM over the Neon serverless HTTP driver (Workers-compatible — no raw TCP). Schema is defined in Drizzle and applied with `drizzle-kit` migrations. Two route areas exist from the start: public (`/`) and authenticated (`/app/*`, gated later in Plan 2).

**Tech Stack:** Astro, TypeScript (strict), Drizzle ORM, `@neondatabase/serverless`, drizzle-kit, Cloudflare adapter/Wrangler, Biome, Vitest, GitHub Actions.

**Depends on:** nothing. This is the first plan.

---

## File structure (created by this plan)

```
peterjur.co/
├── package.json, tsconfig.json, astro.config.mjs, biome.json, wrangler.toml
├── drizzle.config.ts
├── .env.example
├── src/
│   ├── layouts/BaseLayout.astro
│   ├── pages/
│   │   ├── index.astro                 # public home (placeholder)
│   │   ├── app/index.astro             # authenticated home (placeholder, ungated for now)
│   │   └── api/health.ts               # JSON health endpoint
│   ├── db/
│   │   ├── client.ts                   # Neon+Drizzle client factory
│   │   ├── schema.ts                   # all tables (DATA_MODEL.md)
│   │   └── index.ts                    # re-exports
│   └── lib/
│       └── public-id.ts                # opaque id generator
├── drizzle/                            # generated SQL migrations
├── tests/
│   ├── public-id.test.ts
│   └── db.smoke.test.ts
└── .github/workflows/ci.yml
```

## Task 1: Repo + Astro scaffold

**Files:** `package.json`, `astro.config.mjs`, `tsconfig.json`, `biome.json`, `src/pages/index.astro`, `src/layouts/BaseLayout.astro`

- [ ] **Step 1:** `git init` in `peterjur.co/`. Add a Node `.gitignore` (`node_modules`, `dist`, `.env`, `.astro`, `.wrangler`).
- [ ] **Step 2:** Scaffold Astro with the Cloudflare adapter and `output: 'server'`. Enable TypeScript `strict`. Add Biome with the project conventions (single quotes, semicolons as-needed). Add `@astrojs/cloudflare`.
- [ ] **Step 3:** Create `BaseLayout.astro` (html/head/body shell, slot) and a placeholder `index.astro` that renders "peterjur.co" using the layout.
- [ ] **Step 4:** Run `pnpm build` and `pnpm astro check`.
  Expected: build succeeds, no type errors.
- [ ] **Step 5:** Commit — `chore: scaffold Astro SSR app with Cloudflare adapter`.

**Acceptance:** `pnpm dev` serves `/` locally; `pnpm build` produces a Workers-targeted bundle.

## Task 2: Neon + Drizzle client

**Files:** Create `src/db/client.ts`, `src/db/index.ts`, `drizzle.config.ts`, `.env.example`

- [ ] **Step 1:** Add deps: `drizzle-orm`, `@neondatabase/serverless`, and dev `drizzle-kit`.
- [ ] **Step 2:** In `client.ts` export a factory `getDb(databaseUrl: string)` that builds a Drizzle client over the Neon HTTP driver. It reads the URL from the caller (in Astro, from `Astro.locals.runtime.env.DATABASE_URL` / `import.meta.env`) — never a module-level singleton bound to a build-time secret.
- [ ] **Step 3:** `.env.example` documents `DATABASE_URL` (Neon pooled connection string). `drizzle.config.ts` points `drizzle-kit` at `src/db/schema.ts` and reads `DATABASE_URL`.
- [ ] **Step 4:** Type-check: `pnpm astro check`. Expected: passes.
- [ ] **Step 5:** Commit — `feat(db): add Neon + Drizzle client factory`.

**Acceptance:** `getDb(url)` returns a typed Drizzle instance; no secrets baked at import time.

## Task 3: Full schema + first migration

**Files:** Create `src/db/schema.ts`, generate `drizzle/0000_*.sql`

- [ ] **Step 1:** Define every table from [DATA_MODEL.md](../DATA_MODEL.md) in Drizzle: `users`, `sessions`, `article_categories`, `article_tags`, `articles`, `article_tags_map`, `photo_tags`, `photo_albums`, `photo_albums_tags_map`, `apps`, `home_tiles`. Use the exact columns/types/nullability specified there. Model the two visibility enums (`private`/`public`) as pg enums. Every table gets `created_at`/`updated_at` defaults unless DATA_MODEL notes otherwise.
- [ ] **Step 2:** Add indexes: unique on `users.google_sub`, unique+indexed on `articles.public_id` and `photo_tags.public_id`, and FK indexes on all `*_map` join tables and `articles.category_id`.
- [ ] **Step 3:** Generate the migration: `pnpm drizzle-kit generate`. Inspect the SQL to confirm it matches DATA_MODEL (tables, enums, indexes, FKs).
- [ ] **Step 4:** Apply against a scratch Neon branch: `pnpm drizzle-kit migrate`. Expected: applies with no errors.
- [ ] **Step 5:** Commit — `feat(db): full schema + initial migration`.

**Acceptance:** Migration applies cleanly; generated SQL contains all 11 tables, both enums, and the opaque-id unique indexes.

## Task 4: DB test harness + smoke test

**Files:** Create `tests/db.smoke.test.ts`, add Vitest config

- [ ] **Step 1:** Add `vitest`. Configure a test setup that reads `TEST_DATABASE_URL` (a disposable Neon branch or local Postgres) and runs `drizzle-kit migrate` before the suite.
- [ ] **Step 2:** Write a smoke test: insert an `article_categories` row, insert an `articles` row referencing it with a generated `public_id`, read it back, assert fields round-trip and `public_id` is unique-constrained (a duplicate insert throws).
- [ ] **Step 3:** Run `pnpm test`. Expected: FAIL first if schema wiring is off, then PASS once correct.
- [ ] **Step 4:** Commit — `test(db): schema smoke test against real Postgres`.

**Acceptance:** Tests run against real Postgres (not mocked) and pass; CI can run them against a Neon branch.

## Task 5: Route areas + health endpoint

**Files:** Create `src/pages/app/index.astro`, `src/pages/api/health.ts`

- [ ] **Step 1:** `api/health.ts` returns `{ ok: true, db: 'up' }` after a trivial `SELECT 1` via `getDb`, or `{ ok:false }` + 503 on DB error.
- [ ] **Step 2:** `app/index.astro` renders an "Authenticated area (ungated)" placeholder via BaseLayout. (Gating comes in Plan 2 — leave a `// TODO(plan-2): gate` comment.)
- [ ] **Step 3:** Add a Vitest/Playwright check hitting `/api/health` in a running dev server; expect `200 {ok:true}` when DB is reachable.
- [ ] **Step 4:** Commit — `feat: health endpoint + route areas`.

**Acceptance:** `/api/health` reflects real DB connectivity; `/app` renders.

## Task 6: Public-id helper

**Files:** Create `src/lib/public-id.ts`, `tests/public-id.test.ts`

- [ ] **Step 1:** Write `tests/public-id.test.ts`: `newPublicId()` returns a URL-safe string ≥ 12 chars, no two of 10k calls collide, and it matches `/^[A-Za-z0-9_-]+$/`.
- [ ] **Step 2:** Run it — expect FAIL (function missing).
- [ ] **Step 3:** Implement `newPublicId()` using `nanoid` (URL-safe alphabet). Export it.
- [ ] **Step 4:** Run tests — expect PASS.
- [ ] **Step 5:** Commit — `feat(lib): opaque public-id generator`.

**Acceptance:** Every place that later needs a public id (articles, photo tags) uses `newPublicId()`.

## Task 7: Deploy pipeline + CI

**Files:** Create `wrangler.toml`, `.github/workflows/ci.yml`

- [ ] **Step 1:** `wrangler.toml` configures the Pages/Workers project name, compatibility date, and bindings placeholder (`DATABASE_URL`, later R2). Document that secrets are set in the Cloudflare dashboard, not committed.
- [ ] **Step 2:** `ci.yml`: on PR/push — install, `biome ci`, `astro check`, `pnpm build`, then `pnpm test` against a Neon branch (URL from a GH secret). 
- [ ] **Step 3:** Push a branch, open a PR, confirm CI is green.
- [ ] **Step 4:** Connect the repo to Cloudflare Pages (dashboard) and confirm a preview deploy builds. Set `DATABASE_URL` as a Pages secret.
- [ ] **Step 5:** Commit — `chore(ci): build/lint/test pipeline + Cloudflare deploy`.

**Acceptance:** A push produces a green CI run and a Cloudflare preview URL that serves `/` and a healthy `/api/health`.

## Self-review notes
- Covers TECH_DECISIONS §4 (serverless split), the DATA_MODEL schema, and the opaque-id decision (§9) via Task 6.
- Auth gating deliberately deferred to Plan 2 (TODO marker left in Task 5).
- R2/Cloudflare Images bindings are stubbed in `wrangler.toml` but used in Plans 5/6.
