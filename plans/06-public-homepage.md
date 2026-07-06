# Public Homepage Implementation Plan

> **For agentic workers:** Implement task-by-task. Each task ends with green tests and a commit.

**Goal:** The public (unauthenticated) landing page — a freeform canvas of photo and quote tiles matching DESIGN.md — plus the admin canvas editor to place/size/rotate/border/hover-configure each tile.

**Architecture:** Tiles are absolutely-positioned records (`home_tiles`) with `x/y/width/height/rotation/border/hover_effect/z_index/cycle_group`. The public renderer paints them from stored layout (no editor JS shipped to visitors) and applies the DESIGN visual language: faded-ochre ground, Unbounded/Big Shoulders type, the "Develop" slow-filter hover, tilted marquee quotes, and slow crossfade cycling. The admin editor is a gated canvas island (drag/resize/rotate + a per-tile inspector) that persists via a tiles API. Layout coordinates are percentage-based for responsive scaling.

**Tech Stack:** Astro SSR page, a canvas-editor island, R2/CF Images (from Plan 5), the embedded fonts + CSS captured in DESIGN/`design/public-homepage-directions.html`.

**Depends on:** Plan 5 (media layer, R2, image-url).

**Spec refs:** DESIGN.md (the whole visual language), REQUIREMENTS "Public section" + "Admin edit model", DATA_MODEL `home_tiles`.

---

## File structure

```
src/
├── styles/public-home.css      # palette, type, tile, Develop-hover, marquee, cycle (from DESIGN)
├── lib/home/repo.ts            # tiles CRUD + ordered read
├── components/public/
│   ├── TileRenderer.astro       # render one tile (photo|quote) from layout
│   └── CycleGroup.tsx           # slow crossfade among a cycle_group
├── components/admin/
│   ├── CanvasEditor.tsx         # drag/resize/rotate surface
│   └── TileInspector.tsx        # per-tile: size, position, rotation, border, hover effect
├── pages/
│   ├── index.astro             # PUBLIC homepage (replace Plan-1 placeholder)
│   ├── app/home-editor.astro   # gated canvas editor
│   └── api/home/tiles.ts, home/tiles/[id].ts
tests/
├── home.repo.test.ts
├── tile-renderer.test.ts
└── public-home.e2e.test.ts
```

## Task 1: Tiles repository

**Files:** Create `src/lib/home/repo.ts`, `tests/home.repo.test.ts`

- [ ] **Step 1:** Tests (real Postgres): CRUD a tile with all fields (`kind`, `image_key`|`text_content`+`cite`, `x/y/width/height/rotation`, `border` JSON, `hover_effect`, `z_index`, `cycle_group`); `listOrdered()` returns tiles sorted by `z_index`; `bulkUpsertLayout(tiles)` persists a full editor save atomically.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement with Drizzle (transaction for bulk save).
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit — `feat(home): tiles repository`.

**Acceptance:** Full-canvas save is atomic; read is z-ordered.

## Task 2: Design CSS + tile renderer

**Files:** Create `src/styles/public-home.css`, `src/components/public/TileRenderer.astro`, `tests/tile-renderer.test.ts`

- [ ] **Step 1:** Port the locked visual language from `design/public-homepage-directions.html` into `public-home.css`: palette tokens, `@font-face` (Unbounded, Big Shoulders), the **Develop** hover (`filter` transition, ~1s, no transform), tilted `.marquee`/`.quote-ink`, and the cycle crossfade. Drop the review-only hover switcher/chrome.
- [ ] **Step 2:** `TileRenderer.astro` renders a tile from its record: photo tiles use `imageUrl(image_key, …)` with the Develop classes; quote tiles render the marquee/ink treatment with `text_content`+`cite`. Apply `x/y/width/height` (as %) + `rotate(var)` + `border` + `z-index` inline.
- [ ] **Step 3:** Renderer test (jsdom): a photo tile outputs an element with the transform-position style and the Develop hover class; a quote tile outputs the marquee markup with the text; rotation is applied.
- [ ] **Step 4:** Commit — `feat(home): design CSS + tile renderer`.

**Acceptance:** Rendered tiles match DESIGN; no editor JS or switcher chrome in the public output.

## Task 3: Public homepage page

**Files:** Create/replace `src/pages/index.astro`

- [ ] **Step 1:** SSR: `listOrdered()` → paint tiles via `TileRenderer` on the ochre canvas; masthead "Peter Jurčo"; footer socials (Instagram, LinkedIn, Goodreads, Last.fm, Strava, GitHub, Email — from DESIGN).
- [ ] **Step 2:** Mount `CycleGroup` only for tiles that have a `cycle_group`; respect `prefers-reduced-motion`.
- [ ] **Step 3:** No menu/subpages (REQUIREMENTS). Add page-level OG meta.
- [ ] **Step 4:** Commit — `feat(home): public landing page`.

**Acceptance:** `/` renders the canvas from DB, Develop hover works, cycling is slow/subtle, reduced-motion honored.

## Task 4: Tiles API

**Files:** Create `src/pages/api/home/tiles.ts`, `home/tiles/[id].ts`

- [ ] **Step 1:** Owner-only: `GET` list, `POST` create tile, `PATCH /:id` update one tile, `DELETE /:id`, and `PUT /api/home/tiles` for a full `bulkUpsertLayout` save. Validate numeric ranges (rotation, sizes) and the `hover_effect` enum.
- [ ] **Step 2:** Integration tests: unauth → 401; owner bulk save round-trips.
- [ ] **Step 3:** Commit — `feat(home): tiles API`.

**Acceptance:** Only the owner mutates tiles; bulk save validated.

## Task 5: Admin canvas editor

**Files:** Create `src/pages/app/home-editor.astro`, `src/components/admin/CanvasEditor.tsx`, `TileInspector.tsx`

- [ ] **Step 1:** Gated `/app/home-editor` mounts `CanvasEditor` seeded with `listOrdered()`.
- [ ] **Step 2:** Canvas supports: add photo tile (cover via the Plan-5 `CoverUpload`/presign) or quote tile; **drag to move, handles to resize, a rotation handle**; select a tile → `TileInspector` edits **size, position (numeric), rotation, border, hover effect** (REQUIREMENTS admin edit model). Save → `PUT /api/home/tiles`.
- [ ] **Step 3:** Component test: manipulating a tile updates its model; Save emits the full tile array; the inspector edits each of the five properties.
- [ ] **Step 4:** Commit — `feat(home): admin canvas editor`.

**Acceptance:** All five per-block controls work and persist; reload reflects saved layout.

## Task 6: End-to-end

**Files:** Create `tests/public-home.e2e.test.ts`

- [ ] **Step 1:** Playwright: (authed) in the editor add a photo tile + a quote tile, position/rotate/border them, set hover=Develop, save. (Logged-out) load `/` → tiles appear at the saved layout, hovering a photo triggers the slow filter, the quote is tilted, cycling group crossfades.
- [ ] **Step 2:** Reduced-motion run → no cycling/transition.
- [ ] **Step 3:** Run — expect PASS.
- [ ] **Step 4:** Commit — `test(home): canvas edit → public render`.

**Acceptance:** Editor-authored layout renders publicly per DESIGN; motion rules honored.

## Self-review notes
- Implements every DESIGN element and every admin edit capability (size/position/rotation/border/hover) the user asked for.
- Public output ships no editor code and no review switcher (that was scaffolding).
- Percentage coords chosen for responsiveness; note if a future breakpoint model is needed.
