# Articles + Editor Implementation Plan

> **For agentic workers:** Implement task-by-task. Each task ends with green tests and a commit.

**Goal:** Google-Docs-style articles — a single always-mounted TipTap editor that is the page, editable when authorized and a clean read-only document otherwise — with categories, tags, visibility toggle, opaque public URLs, and correct social preview cards.

**Architecture:** Articles are stored as TipTap/ProseMirror JSON in `articles.content`. One `<Article>` island renders the editor with `editable` driven by permission; read-only hides all toolbars/chrome (DESIGN + REQUIREMENTS). Autosave PATCHes the doc. Public reading uses the opaque `public_id` at `/a/:publicId` and is server-rendered (static HTML from the JSON) so it's fast and crawlable for OG cards; editing loads the interactive island under `/app/articles/:id`.

**Tech Stack:** TipTap (StarterKit + link, image, text-style/color, font-family), Drizzle, Astro islands (React or Solid — pick one and stay consistent), a ProseMirror-JSON→HTML renderer for SSR read view.

**Depends on:** Plan 2 (auth/locals.user, gating).

**Spec refs:** REQUIREMENTS "Articles"; DATA_MODEL articles/taxonomy; DESIGN (read-only hides chrome); TECH_DECISIONS §2, §9.

---

## File structure

```
src/
├── lib/articles/
│   ├── repo.ts            # CRUD data access (Drizzle)
│   ├── excerpt.ts         # derive OG description from content JSON
│   └── render-doc.ts      # ProseMirror JSON → sanitized HTML (SSR read view)
├── components/
│   ├── ArticleEditor.tsx  # TipTap island: editable | read-only (no chrome)
│   └── EditorToolbar.tsx  # shown only when editable
├── pages/
│   ├── app/articles/
│   │   ├── index.astro    # list my articles (all visibilities)
│   │   ├── new.astro      # create → redirect to editor
│   │   └── [id].astro     # editor (gated)
│   ├── a/[publicId].astro # public read view (SSR, opaque id)
│   └── api/articles/
│       ├── index.ts       # POST create
│       └── [id].ts        # PATCH autosave, PATCH visibility, DELETE
tests/
├── articles.repo.test.ts
├── excerpt.test.ts
├── render-doc.test.ts
└── articles.e2e.test.ts
```

## Task 1: Article repository

**Files:** Create `src/lib/articles/repo.ts`, `tests/articles.repo.test.ts`

- [ ] **Step 1:** Tests (real Postgres): `create()` inserts with a `newPublicId()` and `visibility='private'`; `update()` changes title/content and bumps `updated_at`; `setVisibility()` flips private↔public; `getByPublicId()` returns public articles and `null` for private ones (public read must not leak private); `listForOwner()` returns all; `setCategory`/`setTags` manage the FK + join rows.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement with Drizzle. `getByPublicId` filters `visibility='public'`.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit — `feat(articles): repository`.

**Acceptance:** Private articles are unreachable via the public accessor; tags/category wire correctly.

## Task 2: Excerpt + doc renderer

**Files:** Create `src/lib/articles/excerpt.ts`, `render-doc.ts`, tests

- [ ] **Step 1:** `excerpt.test.ts`: `deriveExcerpt(contentJson, max)` returns plain text from the first paragraph(s) up to `max` chars, stripping marks. `render-doc.test.ts`: `renderDoc(contentJson)` produces sanitized HTML for headings, bold/italic/strike, color/font-family marks, links (rel/target safe), lists, blockquotes, and images (with the stored src) — and that arbitrary HTML in text nodes is escaped (no XSS).
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement using the ProseMirror schema's `DOMSerializer` (or `@tiptap/html` `generateHTML`) plus a sanitizer allow-list. 
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit — `feat(articles): excerpt + SSR doc renderer`.

**Acceptance:** Read view HTML is faithful and XSS-safe; excerpt feeds OG tags.

## Task 3: Editor island (editable + read-only)

**Files:** Create `src/components/ArticleEditor.tsx`, `EditorToolbar.tsx`

- [ ] **Step 1:** Build the TipTap editor with the REQUIREMENTS feature set: headings, quotes, bold/italic/strike, text color, font family, lists, indentation, links, inline images. Mobile-friendly toolbar.
- [ ] **Step 2:** Prop `editable: boolean`. When `false`, set TipTap `editable:false` **and render no toolbar/chrome** — document only (DESIGN). When `true`, render `EditorToolbar`.
- [ ] **Step 3:** Autosave: on change (debounced) PATCH `/api/articles/:id` with the JSON; show a subtle "saved" state.
- [ ] **Step 4:** Component test (jsdom): renders content read-only with no toolbar in the DOM when `editable=false`; toolbar present when `true`.
- [ ] **Step 5:** Commit — `feat(articles): TipTap editor island (editable/read-only)`.

**Acceptance:** Read-only mode has zero toolbar nodes; editable mode autosaves.

## Task 4: Article API endpoints

**Files:** Create `src/pages/api/articles/index.ts`, `[id].ts`

- [ ] **Step 1:** All endpoints require `locals.user` (owner) except none are public (public reading is via the SSR page, not the API). `POST /api/articles` creates an empty article, returns `{id}`. `PATCH /api/articles/:id` updates content/title (autosave) or visibility/category/tags/featured fields. `DELETE` removes it.
- [ ] **Step 2:** Enforce auth in each handler (defense-in-depth beyond middleware).
- [ ] **Step 3:** Integration tests: unauthenticated PATCH → 401; owner PATCH → 200 + persisted.
- [ ] **Step 4:** Commit — `feat(articles): CRUD API`.

**Acceptance:** Only the owner can mutate; autosave persists JSON.

## Task 5: Pages — editor, list, public read

**Files:** Create `src/pages/app/articles/index.astro`, `new.astro`, `[id].astro`, `src/pages/a/[publicId].astro`

- [ ] **Step 1:** `/app/articles` lists owner articles (title, category, visibility badge, updated_at). `new.astro` POSTs create then redirects to `/app/articles/:id`.
- [ ] **Step 2:** `/app/articles/:id` loads the article and mounts `ArticleEditor editable={true}`.
- [ ] **Step 3:** `/a/:publicId` server-renders via `getByPublicId` → `renderDoc` (read-only, no editor JS needed) → 404 if not public. Include OG/Twitter meta: title + `deriveExcerpt` + featured photo if present. This is the "correct preview card" requirement.
- [ ] **Step 4:** Commit — `feat(articles): editor, list, and public read pages`.

**Acceptance:** Sharing `/a/:publicId` yields a correct card; private ids 404 publicly.

## Task 6: End-to-end

**Files:** Create `tests/articles.e2e.test.ts`

- [ ] **Step 1:** Playwright (authed): create → type → reload shows persisted content → set category + tags → toggle public → copy public URL → open it logged-out → reads correctly, no toolbar. Toggle back private → public URL now 404s.
- [ ] **Step 2:** Assert the public page's `<meta property="og:title">` and description are present.
- [ ] **Step 3:** Run — expect PASS.
- [ ] **Step 4:** Commit — `test(articles): full authoring + sharing flow`.

**Acceptance:** The Google-Docs-style loop and public-by-link sharing both work end to end.

## Self-review notes
- "Always in edit mode / easy read" = one island with `editable` prop; read-only strips chrome (Task 3) — matches DESIGN + the user's toolbar note.
- Opaque public ids (Task 1 via `newPublicId`) enforce the §9 unlisted decision.
- OG cards (Task 5) satisfy the social-preview requirement; no revision history (single mutable row) per DATA_MODEL.
- Featured drag-order fields exist on the row but are exercised in Plan 4 (homepage).
- **Featured-photo upload** needs the media layer (R2 presign + `imageUrl`) built in Plan 5. This plan only *reads* `featured_photo_key` (for OG cards). Wire the upload control into the editor once Plan 5 lands — until then `featured_photo_key` stays null and OG cards fall back to no image.
