# Photo Hub Implementation Plan

> **For agentic workers:** Implement task-by-task. Each task ends with green tests and a commit.

**Goal:** A hub of Google Photos albums (link + manual cover + name + tags), authenticated list and per-tag pages, and public-tag pages shareable without login. Establishes R2 upload + Cloudflare Images transforms (reused by Plan 6).

**Architecture:** An album is a curated record — a Google Photos share URL, a name, and a cover image uploaded to R2 (no Google Photos API, per TECH_DECISIONS §8). Photo tags carry a `visibility`; a public tag's page is served at `/t/:publicId` without auth, listing that tag's albums (cover + name linking out to Google Photos). Cover images upload directly to R2 via a presigned URL; display sizes come from Cloudflare Images transforms.

**Tech Stack:** R2 (S3 API / presigned PUT), Cloudflare Images transform URLs, Drizzle.

**Depends on:** Plan 3 (auth patterns, `newPublicId`).

**Spec refs:** REQUIREMENTS "Google Photos album hub"; DATA_MODEL photo_albums/photo_tags; TECH_DECISIONS §5 (R2 + CF Images), §8 (no Photos API), §9 (opaque ids).

---

## File structure

```
src/
├── lib/media/
│   ├── r2.ts              # presigned PUT url + object key helpers
│   └── image-url.ts       # build Cloudflare Images transform URLs (w/h/quality/format)
├── lib/photos/repo.ts     # albums + tags CRUD, listByTag, getPublicTag
├── components/
│   ├── AlbumForm.tsx       # add/edit album: name, GPhotos URL, tags, cover upload
│   └── CoverUpload.tsx     # client compress-lite + presigned R2 upload
├── pages/
│   ├── app/photos/
│   │   ├── index.astro     # all albums (authed)
│   │   └── tags/[id].astro # albums for a tag (authed)
│   ├── t/[publicId].astro  # public tag page (no auth) — only if tag is public
│   └── api/
│       ├── photos/albums.ts, photos/albums/[id].ts, photos/tags.ts
│       └── media/presign.ts
tests/
├── media.image-url.test.ts
├── photos.repo.test.ts
└── photos.e2e.test.ts
```

## Task 1: R2 + image-url helpers

**Files:** Create `src/lib/media/r2.ts`, `src/lib/media/image-url.ts`, `tests/media.image-url.test.ts`

- [ ] **Step 1:** `image-url.test.ts`: `imageUrl(key, {width,height,quality,format})` returns a Cloudflare Images transform URL for the R2-backed object with the right params, and a sensible default (e.g. `format=auto`).
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement `image-url.ts`. Implement `r2.ts`: `objectKey(prefix, filename)` (opaque, collision-safe) and `presignPut(env, key, contentType)` returning a short-lived upload URL via the R2 S3 API. Restrict content types to images and cap size.
- [ ] **Step 4:** Run — expect PASS. (`presignPut` covered in the e2e/integration task.)
- [ ] **Step 5:** Commit — `feat(media): R2 presign + Cloudflare Images URLs`.

**Acceptance:** Transform URLs are correct; presign returns a usable, scoped URL.

## Task 2: Photos repository

**Files:** Create `src/lib/photos/repo.ts`, `tests/photos.repo.test.ts`

- [ ] **Step 1:** Tests (real Postgres): create/edit album (name, `google_photos_url`, `cover_image_key`); attach/detach tags; `listAlbums()`; `listByTag(tagId)`; tags carry `visibility` with `newPublicId()`; `getPublicTagByPublicId(pid)` returns the tag + its albums **only when `visibility='public'`**, else `null`.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement with Drizzle.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit — `feat(photos): albums + tags repository`.

**Acceptance:** Private tags are unreachable via the public accessor.

## Task 3: Presign endpoint + cover upload

**Files:** Create `src/pages/api/media/presign.ts`, `src/components/CoverUpload.tsx`

- [ ] **Step 1:** `POST /api/media/presign` (owner-only) → `{url, key}` for an image content-type. Rejects non-images / oversize.
- [ ] **Step 2:** `CoverUpload.tsx`: optional light client downscale (cap longest edge ~2560px, per DESIGN motion/upload note), request presign, PUT to R2, return the stored `key`.
- [ ] **Step 3:** Integration test: presign requires auth; a PUT to the returned URL stores an object (against R2 test bucket or a mock honoring the S3 contract).
- [ ] **Step 4:** Commit — `feat(media): cover upload via presigned R2`.

**Acceptance:** Authenticated cover upload lands in R2 and yields a key.

## Task 4: Album form + tag management API

**Files:** Create `src/components/AlbumForm.tsx`, `src/pages/api/photos/albums.ts`, `albums/[id].ts`, `photos/tags.ts`

- [ ] **Step 1:** Album CRUD API (owner-only). Tag API: create tag, set `visibility` (private/public). All defense-in-depth authed.
- [ ] **Step 2:** `AlbumForm`: name, Google Photos URL, tag multi-select (create-on-the-fly), cover via `CoverUpload`.
- [ ] **Step 3:** Integration tests: create album with cover + tags; flip a tag public.
- [ ] **Step 4:** Commit — `feat(photos): album form + tag API`.

**Acceptance:** An album can be created end-to-end with cover and tags; tags can be made public.

## Task 5: Pages — authed list, tag pages, public tag page

**Files:** Create `src/pages/app/photos/index.astro`, `app/photos/tags/[id].astro`, `src/pages/t/[publicId].astro`

- [ ] **Step 1:** `/app/photos` lists all albums (cover via `imageUrl`, name, tags, edit link). `/app/photos/tags/:id` lists albums for a tag (authed, internal id).
- [ ] **Step 2:** `/t/:publicId` (no auth) → `getPublicTagByPublicId`; renders the tag's albums (cover + name linking to `google_photos_url`); 404 if tag missing or not public. Add OG meta for a nice shared card.
- [ ] **Step 3:** Wire the homepage photo-hub widget (Plan 4 slot) to list the tags/hubs.
- [ ] **Step 4:** Commit — `feat(photos): hub pages + public tag sharing`.

**Acceptance:** A `family`-style public tag page is viewable logged-out; private tags 404 publicly.

## Task 6: End-to-end

**Files:** Create `tests/photos.e2e.test.ts`

- [ ] **Step 1:** Playwright (authed): add album (cover upload + tag) → appears in list and on its tag page → mark tag public → open `/t/:publicId` logged-out → shows albums, links out to Google Photos. Mark tag private → `/t/:publicId` 404s.
- [ ] **Step 2:** Run — expect PASS.
- [ ] **Step 3:** Commit — `test(photos): hub + public sharing flow`.

**Acceptance:** Curated-link hub works; public-tag sharing matches REQUIREMENTS.

## Self-review notes
- No Google Photos API anywhere (§8); covers/names are manual, per REQUIREMENTS.
- R2 + CF Images helpers (Tasks 1/3) are the shared media layer reused by Plan 6.
- Public reach only via opaque tag `public_id` (§9); authed pages use internal ids.
