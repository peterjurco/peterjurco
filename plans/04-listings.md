# Listings & Authenticated Homepage Implementation Plan

> **For agentic workers:** Implement task-by-task. Each task ends with green tests and a commit.

**Goal:** Category/tag pages listing their articles, and the authenticated homepage with drag-ordered Featured articles, Recent articles, the photo-hub widget slot, and the My-apps slot.

**Architecture:** Listing pages are auth-only and addressed by internal integer id (`/app/categories/:id`, `/app/tags/:id`) — no opaque ids needed since you must be logged in to reach them. Featured ordering uses `articles.is_featured` + `featured_position` with a drag-reorder endpoint. The homepage composes four sections; the photo-hub and apps widgets render whatever data exists (fully populated in Plans 5/7).

**Tech Stack:** Astro pages, Drizzle queries, a small drag-reorder island.

**Depends on:** Plan 3 (articles, repo, taxonomy).

**Spec refs:** REQUIREMENTS "Authenticated homepage" + "Articles" (per-category/tag pages), "Featured drag order".

---

## File structure

```
src/
├── lib/articles/queries.ts     # listByCategory, listByTag, listRecent, listFeatured, reorderFeatured
├── components/FeaturedReorder.tsx
├── pages/app/
│   ├── index.astro             # authenticated homepage (4 sections)
│   ├── categories/[id].astro
│   └── tags/[id].astro
└── pages/api/articles/featured-order.ts
tests/
├── articles.queries.test.ts
└── homepage.e2e.test.ts
```

## Task 1: Listing queries

**Files:** Create `src/lib/articles/queries.ts`, `tests/articles.queries.test.ts`

- [ ] **Step 1:** Tests (real Postgres): `listByCategory(id)` and `listByTag(id)` return the right articles (both private + public, since these pages are owner-only) newest-first; `listRecent(limit)` returns latest N; `listFeatured()` returns `is_featured` rows ordered by `featured_position` ascending; `reorderFeatured(orderedIds)` writes new positions.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement with Drizzle joins.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit — `feat(articles): listing + featured-order queries`.

**Acceptance:** Featured order is stable and reorderable; listings filter correctly.

## Task 2: Category & tag pages

**Files:** Create `src/pages/app/categories/[id].astro`, `src/pages/app/tags/[id].astro`

- [ ] **Step 1:** Each renders the taxonomy name + a list of its articles (title, visibility badge, updated_at, link to editor). Gated by middleware (`/app/*`).
- [ ] **Step 2:** Handle unknown id → 404.
- [ ] **Step 3:** Commit — `feat(listings): category and tag pages`.

**Acceptance:** `/app/categories/:id` and `/app/tags/:id` list the correct articles.

## Task 3: Featured reorder island + endpoint

**Files:** Create `src/components/FeaturedReorder.tsx`, `src/pages/api/articles/featured-order.ts`

- [ ] **Step 1:** Endpoint `POST /api/articles/featured-order` (owner-only) accepts `{orderedIds:number[]}` → `reorderFeatured`. Returns 200.
- [ ] **Step 2:** Island renders featured articles as a drag-sortable list; on drop, PATCHes the new order and optimistically updates.
- [ ] **Step 3:** Component test: reordering emits the expected id sequence to the endpoint.
- [ ] **Step 4:** Commit — `feat(homepage): featured drag-reorder`.

**Acceptance:** Dragging persists order; reload preserves it.

## Task 4: Authenticated homepage

**Files:** Create `src/pages/app/index.astro` (replace the Plan-2 placeholder)

- [ ] **Step 1:** Compose four sections: **Featured** (mounts `FeaturedReorder` with `listFeatured()`), **Recent** (`listRecent(10)`), **Photo hubs** (widget slot — renders `listPublicAndPrivateTags()`-style data if present, else an empty-state; fully wired in Plan 5), **My apps** (renders `apps` if present, else empty-state; CRUD in Plan 7).
- [ ] **Step 2:** Add the menu (REQUIREMENTS: authenticated section has a menu) linking Articles, Photo hub, Apps, Admin, Logout. Functional-over-pretty layout per REQUIREMENTS.
- [ ] **Step 3:** Commit — `feat(homepage): authenticated dashboard`.

**Acceptance:** Homepage shows featured (reorderable), recent, and the two widget slots.

## Task 5: End-to-end

**Files:** Create `tests/homepage.e2e.test.ts`

- [ ] **Step 1:** Playwright (authed): mark two articles featured, drag to reorder, reload → order holds. Recent shows latest. Visiting a category page lists its articles.
- [ ] **Step 2:** Run — expect PASS.
- [ ] **Step 3:** Commit — `test(homepage): featured/recent/category flows`.

**Acceptance:** All homepage sections behave; drag-order persists.

## Self-review notes
- Uses internal ids for auth-only listing pages (DATA_MODEL note: opaque ids only for unauthenticated reach).
- Widget slots degrade gracefully so this plan ships before Plans 5/7 fill them.
- Featured = boolean flag + `featured_position` (the drag-order answer from brainstorming).
