# peterjur.co — Implementation Plans

An 8-part plan for the rebuild, written for handoff to a coding agent (Fable).
Task-level granularity: each task states the files, responsibilities, interfaces,
tests, and acceptance criteria; the implementer writes the actual code.

Read these alongside the locked specs: [REQUIREMENTS](../REQUIREMENTS.md),
[TECH_DECISIONS](../TECH_DECISIONS.md), [DATA_MODEL](../DATA_MODEL.md),
[DESIGN](../DESIGN.md).

## Order & dependencies

| # | Plan | Depends on |
|---|------|-----------|
| 1 | [Foundation](./01-foundation.md) | — |
| 2 | [Auth](./02-auth.md) | 1 |
| 3 | [Articles + editor](./03-articles.md) | 2 |
| 4 | [Listings & homepage](./04-listings.md) | 3 |
| 5 | [Photo hub](./05-photo-hub.md) | 3 |
| 6 | [Public homepage](./06-public-homepage.md) | 5 |
| 7 | [Ops & extras](./07-ops-extras.md) | 2 |
| 8 | [WordPress migration](./08-migration.md) | 3 · needs WP dump |

Build 1 → 2 → 3, then 4/5/7 can proceed in parallel, then 6 (needs 5), then 8
(when the WP dump is available). Each plan ends in working, testable software.

## Conventions used across all plans

- **Stack:** Astro (SSR, `@astrojs/cloudflare` adapter) · TypeScript · Drizzle
  ORM on Neon Postgres · Cloudflare Pages/Workers · R2 · Cloudflare Images ·
  Arctic (Google OAuth) · TipTap.
- **Testing:** Vitest for unit/integration; Playwright for the few end-to-end
  flows (auth, editor, canvas). DB-touching tests run against a disposable Neon
  branch (or local Postgres) — never mocked SQL.
- **Commits:** small and frequent, conventional-commit messages
  (`feat:`, `test:`, `chore:`).
- **Every task:** finishes with green tests + a commit before the next starts.
