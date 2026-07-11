# TODO

Follow-up work identified after the initial build, not yet scheduled into
a plan. Not blocking anything currently in progress.

- **Delete orphaned R2 objects on tile/image removal.** When a home tile is
  deleted, or an image is removed from a multi-image tile via the canvas
  editor, the corresponding R2 object(s) should be deleted too — currently
  only the DB row/array entry is removed, so unused images accumulate in
  the bucket indefinitely. Same consideration likely applies to article
  featured photos and photo-album covers (check whether those already
  handle this — photo tags already GC unreferenced *tag rows*, but no
  code path deletes R2 *objects* anywhere yet).
- **Polish the admin UI.** Forms across `/app` (taxonomy admin, apps admin,
  album form, tile inspector, etc.) are currently bare/unstyled — built
  functional-over-pretty per REQUIREMENTS, but worth a real styling pass
  now that the feature set is stable. Public homepage design is locked
  (DESIGN.md) and out of scope here — this is only the authenticated
  admin surfaces.
