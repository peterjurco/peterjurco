import { deleteObject, type R2Env } from './r2'

/**
 * Best-effort R2 cleanup for keys a DB write has already dropped. Only ever
 * called AFTER that write has succeeded (see the "no interactive
 * transactions" invariant documented in src/lib/{home,photos,apps}/repo.ts)
 * — so a key passed here is never at risk of still being referenced.
 *
 * Never throws: each delete is attempted independently and a failure is
 * logged and swallowed, since the owning row is already correct — a
 * lingering object in the bucket is a space optimization, not a
 * correctness guarantee (see TODO.md history).
 *
 * Shared across home tiles (array of images per tile), photo album covers,
 * and app icons (single nullable key) so the same "try delete, log on
 * failure" behavior can't drift between call sites — pass a single key
 * wrapped in an array (`key ? [key] : []`) for the single-key cases.
 */
export async function deleteOrphanedImages(
  env: R2Env,
  keys: string[],
): Promise<void> {
  await Promise.all(
    keys.map((key) =>
      deleteObject(env, key).catch((error) => {
        console.error(`Failed to delete orphaned R2 object ${key}:`, error)
      }),
    ),
  )
}
