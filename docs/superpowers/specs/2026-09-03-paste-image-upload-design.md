# Paste-to-upload images in the article editor

## Problem

The article editor's only way to insert an image is a `window.prompt` asking for a URL (`insertImage()` in `EditorToolbar.tsx`) — there's no upload, no paste, no drag-drop. Meanwhile the cover-image flow (`CoverUpload.tsx`) already has a working client-resize → presign → R2 upload pipeline, just not connected to the article body.

Goal: let a user paste an image (Ctrl+V) copied from another app or a screenshot directly into the article body, and have it upload and appear inline.

## Scope

- Raw clipboard image data only (screenshots, images copied from Preview/Finder/etc.) — not drag-and-drop, not pasting an `<img>` referencing a remote URL from a webpage.
- If a paste contains both an image and accompanying text (e.g. from Slack), only the image is handled; the text is dropped. Documented simplification, not a bug.
- The existing URL-prompt "Insert Image" toolbar button is untouched.

## Why decorations, not a new node type

The editor autosaves periodically, and the document schema (`documentExtensions()` in `src/lib/articles/extensions.ts`) is shared between the live editor and the server-side static renderer (`render-doc.ts`). If the "uploading…" placeholder were a real schema node, an autosave firing mid-upload could persist it, and a page reload before the upload finished would leave a permanently broken node with nothing to replace it — the render-doc sanitizer would also need to know to strip it.

ProseMirror decorations solve this by construction: they're view-only, never part of `editor.getJSON()`. Nothing about the "uploading" or "error" state can ever be saved, because it was never in the document to begin with. Only a successful upload results in a real transaction that inserts an actual `image` node.

## Components

- **`src/lib/media/upload-image.ts`** (new) — `uploadImage(file: File, prefix: string): Promise<{ key: string }>`. Extracted from `CoverUpload.tsx`'s inline logic: downscale to WebP (max 2560px longest edge, GIF passthrough), `POST /api/media/presign` with `{ contentType, size, filename, prefix }`, `PUT` the blob to the returned presigned URL, return the object key. Client-side pre-check against `ALLOWED_IMAGE_CONTENT_TYPES` / `MAX_UPLOAD_BYTES` (from `src/lib/media/r2.ts`) for a fast local error before hitting the network.
- **`src/components/CoverUpload.tsx`** — refactored to call `uploadImage(file, 'covers')` instead of its own inline copy. Behavior unchanged.
- **`src/pages/api/media/presign.ts`** — generalized to accept `prefix` in the request body instead of hardcoding `'covers'`, validated against an allowlist (`'covers' | 'articles'`); rejects anything else.
- **`src/lib/articles/image-paste-upload.ts`** (new) — a TipTap `Extension` (no new schema node) that registers a ProseMirror plugin via `addProseMirrorPlugins()`. Editor-only: added directly in `ArticleEditor.tsx`'s `useEditor()` extensions list, alongside (not inside) `documentExtensions()`, so the SSR renderer never sees or needs to know about it.

### Plugin internals

- Plugin state: a `Map<id, { pos: number, status: 'uploading' | 'error', message?: string }>`.
- `apply(tr, prev)`: first maps every stored `pos` through `tr.mapping` (so placeholders stay anchored as the user keeps typing elsewhere), then applies any actions carried in `tr.getMeta(pluginKey)` (`add` / `error` / `remove`).
- `props.handlePaste(view, event)`: inspects `event.clipboardData` for image files. If found, `event.preventDefault()`s the default paste, and for each image file: generates an id, dispatches an `add` action at the current selection to show a spinner decoration immediately, then calls `uploadImage(file, 'articles')` in the background.
  - On success: dispatches a transaction that both removes the placeholder decoration for that id and inserts a real `image` node (`src` built from the returned key via `imageUrl()`) at the mapped position.
  - On failure: dispatches an `error` action; the decoration re-renders as an inline chip with the failure reason and a dismiss (✕) control. Clicking dismiss dispatches a `remove` action — pure view-state cleanup, no document transaction needed since nothing was ever inserted.
- `props.decorations(state)`: builds a `DecorationSet` from the plugin state — a spinner widget for `uploading`, an inline error+dismiss widget for `error`.
- Multiple images pasted in one paste event are each tracked independently (own id, own position, own async upload), so they resolve and land correctly regardless of which finishes first.

## Data flow (happy path)

1. User pastes an image.
2. `handlePaste` detects it, shows a spinner decoration at the cursor.
3. `uploadImage(file, 'articles')` runs (resize → presign → PUT to R2).
4. On success, a transaction swaps the decoration for a real `image` node.
5. The next autosave cycle picks up the change like any normal edit — no special-casing required.

## Error handling

Upload failure (oversized file, disallowed type, network error) turns the placeholder into a dismissable inline error chip. No document mutation ever occurred, so dismissing it is just removing view state.

## Testing

- `upload-image.ts`: unit tests for resize math and the `prefix` parameter (adapted from existing cover-upload tests).
- `presign.ts`: extend existing test coverage for the new `prefix` field, including rejecting an invalid/arbitrary prefix.
- `image-paste-upload.ts`: simulate a paste event with a mocked upload. Assert: a spinner decoration appears immediately; **the document JSON is unchanged while the upload is pending** (the specific regression decorations are meant to prevent); on success the real `image` node appears in the doc; on failure an error chip appears and dismiss cleanly removes it with no doc change.
- No changes needed to `render-doc.ts` or its tests — no new schema node means nothing new to sanitize.
