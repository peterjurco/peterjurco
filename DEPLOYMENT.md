# Deployment checklist

One-time steps to take peterjur.co from `rebuild` branch to live on
`peterjur.co`, per the stack locked in [TECH_DECISIONS.md](./TECH_DECISIONS.md):
Cloudflare Pages + Neon Postgres + Cloudflare R2, behind Cloudflare DNS.

Do these roughly in order — later steps depend on secrets created in earlier
ones. Nothing here is reversible-by-Claude; every step is a manual action in
a dashboard you own.

## 1. Neon Postgres

1. Create an account/project at [neon.tech](https://neon.tech) — region
   **Frankfurt** (closest to Slovakia per TECH_DECISIONS).
2. Create a database (or use the default `neondb`).
3. Copy the **pooled** connection string (Dashboard → Connection Details →
   "Pooled connection"). This is your production `DATABASE_URL`.
4. Apply the schema once, from your machine:
   ```sh
   DATABASE_URL="<pooled connection string>" pnpm drizzle-kit migrate
   ```
   There's no CI step that does this automatically — re-run this command
   by hand any time a new migration lands in `drizzle/`.

## 2. Cloudflare R2 (photo/tile storage)

1. Cloudflare dashboard → R2 → **Create bucket** (e.g. `peterjurco`).
2. R2 → **Manage API tokens** → create a token scoped to that bucket with
   read+write. Note the **Access Key ID**, **Secret Access Key**, and your
   **Account ID** (shown on the R2 overview page) — these become
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`.
3. Give the bucket a public URL — either:
   - **Quick**: bucket Settings → enable the `r2.dev` public URL, or
   - **Nicer**: bucket Settings → add a custom subdomain (e.g.
     `media.peterjur.co`) once the domain is on Cloudflare (step 4).
   Either way, that base URL is `PUBLIC_R2_PUBLIC_BASE_URL`.
4. Enable image transforms so `/cdn-cgi/image/...` URLs work: the zone
   serving that public URL needs **Speed → Optimization → Image Resizing**
   turned on (free tier: 5,000 unique transforms/month per
   TECH_DECISIONS §5). This requires the domain to already be on Cloudflare
   — do this after step 4 (DNS) if using the custom-subdomain option.
5. **CORS policy** — cover uploads (`/app/photos`, `/app/home-editor`) PUT
   directly from the browser to a presigned R2 URL, so R2 itself must allow
   the cross-origin request (it doesn't go through the Worker). Bucket →
   **Settings → CORS Policy** → add:
   ```json
   [
     {
       "AllowedOrigins": [
         "https://peterjurco.<your-workers-subdomain>.workers.dev",
         "https://peterjur.co"
       ],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   Without this, uploads fail in the browser console with a CORS error on
   the presigned PUT (the presign call itself still succeeds — it's the
   follow-up PUT to R2 that's blocked).

## 3. Cloudflare Workers (the app itself)

This deploys via `wrangler deploy`, driven by Cloudflare's own Git-connected
build system (its "Workers Builds" — no GitHub Actions workflow needed; it
rebuilds and redeploys on every push automatically, same idea as a
GitHub Action but running on Cloudflare's infra instead).

1. Cloudflare dashboard → Workers & Pages → **Create application → Connect
   to Git** → select `peterjurco/peterjurco`, branch `master`.
2. Build settings (Cloudflare usually auto-detects these correctly from
   `wrangler.toml` — verify, don't blindly trust):
   - Build command: `pnpm build`
   - Deploy command: `pnpm exec wrangler deploy` (or the pre-filled
     `npx wrangler deploy` — works too since `wrangler` is a direct
     devDependency, see below)
3. **Two separate places for env vars — read carefully, this is the #1
   source of "works locally, 500s in prod" bugs:**

   **Settings → Variables and Secrets** (runtime — read via the Workers
   `env` object on every request; anything the server touches). **Add every
   one of these as type "Secret", not plain "Variable"** — a plain
   dashboard Variable gets silently wiped on the next `wrangler deploy`
   (which runs on every push), since deploy treats `wrangler.toml` as the
   authoritative config and has no idea a dashboard-only var existed.
   Secrets are managed separately and survive deploys. This isn't about
   sensitivity — even non-secret-feeling values like `GOOGLE_CLIENT_ID` or
   `R2_BUCKET` must be "Secret" type purely to persist:
   - `DATABASE_URL`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
     (`https://peterjur.co/api/auth/callback` — or the `*.workers.dev` URL's
     callback if testing before the domain cutover)
   - `SESSION_SECRET` — generate a **fresh** one for prod
     (`openssl rand -base64 32`), don't reuse your local dev value
   - `AUTH_ALLOWED_EMAILS`
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
     (leave `R2_ENDPOINT` unset — that's the local-MinIO-only override)

   If a var vanishes from this list after a deploy, that's this exact
   issue — it was added as a plain Variable; re-add it as a Secret.

   **Settings → Build → Variables and Secrets** (build-time only — baked
   into the bundle via Vite's `import.meta.env`, never read at runtime;
   anything prefixed `PUBLIC_`):
   - `PUBLIC_R2_PUBLIC_BASE_URL` (from step 2.3)
   - `PUBLIC_IMAGE_TRANSFORMS` — leave unset once the domain is live
     (transforms on by default). **Set to `off` temporarily if testing on
     the `*.workers.dev` URL before the domain cutover (step 4)** —
     `/cdn-cgi/image/*` is a zone-level feature and 404s on `workers.dev`
     since there's no zone to enable it on yet. The raw object itself is
     fine; only the transform layer is unavailable pre-cutover. Remove this
     var again once `peterjur.co` is live and Image Resizing is enabled on
     that zone.
   - `PUBLIC_CF_ANALYTICS_TOKEN` (step 6)

4. Trigger the first deploy (push to `master`). **"Retry deployment" reruns
   the same commit/branch it originally cloned** — if you change the
   production branch or an env var after a failed deploy, you need a *new*
   deployment (push a commit, or look for "Create deployment"), not Retry.
5. If the deploy step fails with `wrangler: not found`: the deploy
   environment doesn't fetch `wrangler` fresh via `npx`, it must already be
   in `node_modules` — this repo already has it as a direct devDependency
   for exactly this reason. If you're setting this up on a fresh fork/repo
   without that, add it: `pnpm add -D wrangler`.
6. If the deploy step fails with `The name 'ASSETS' is reserved in Pages
   projects`: `wrangler.toml` already renames the assets binding to
   `STATIC_ASSETS` for this reason (the astro adapter's default `ASSETS`
   name collides with a Pages-reserved name once `wrangler deploy` runs
   through the Pages-compat path that `pages_build_output_dir` triggers).
   Nothing to do — just noting why that config looks unusual if you're
   reading it fresh.

## 4. Point the domain at Cloudflare

1. If `peterjur.co` isn't already on Cloudflare DNS: add the site in the
   Cloudflare dashboard, then update the domain's **nameservers** at your
   registrar (Websupport) to Cloudflare's. This is the one step with real
   downtime risk if done carelessly — DNS propagation can take a few hours;
   do this when you can tolerate a brief gap, not mid-task.
2. Workers project → **Settings → Domains & Routes** → add `peterjur.co`
   (and `www.` if you want it). Cloudflare wires the DNS record
   automatically once the zone is active on Cloudflare.
3. Old Websupport WP hosting can be cancelled once the new site is
   confirmed working on the domain (TECH_DECISIONS: drops ~€73/yr).

## 5. Google OAuth — production redirect URI

If you followed the local dev checklist already, you have a Google Cloud
OAuth client. Add the production callback to the same client (Google Cloud
Console → Credentials → your OAuth client → Authorized redirect URIs):
```
https://peterjur.co/api/auth/callback
```
Keep the `http://localhost:4321/...` one too — no reason to remove it.

## 6. Cloudflare Web Analytics

Dashboard → Analytics & Logs → Web Analytics → **Add a site** → point it at
`peterjur.co` → copy the site token → set as `PUBLIC_CF_ANALYTICS_TOKEN` in
Pages (step 3.3). No Google Analytics anywhere, per TECH_DECISIONS §7.

## 7. GitHub Actions secrets (scheduled DB backups)

The backup workflow (`.github/workflows/backup.yml`) runs independently of
Cloudflare and needs its own secrets — GitHub repo → **Settings → Secrets
and variables → Actions**:
- `DATABASE_URL` — same Neon pooled connection string as step 1
- `R2_BACKUP_ENDPOINT_URL` — `https://<account-id>.r2.cloudflarestorage.com`
- `R2_BACKUP_BUCKET` — can be the same bucket as photos (under a
  `backups/db/` prefix, already how the script namespaces it) or a
  separate one
- `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY` — can reuse the
  R2 token from step 2.2, or mint a separate one scoped to backups only

Once set, trigger the workflow manually once (Actions tab →
"DB backup" → Run workflow) to confirm a dump lands in R2 before trusting
the daily 03:17 UTC schedule.

## 8. Verify

- `https://peterjur.co/api/health` → `{"ok":true,"db":"up"}`
- `https://peterjur.co/` → public homepage (empty until you add tiles)
- `https://peterjur.co/app` → redirects to Google sign-in → lands
  authenticated
- Set up the real homepage via `/app/home-editor` and add photo albums via
  `/app/photos` **directly on the live site** — this is now the permanent,
  production data (see the earlier note: local dev data never migrates
  here automatically).

## Still open (per TECH_DECISIONS)

- **WordPress migration** (plans/08-migration.md, Tasks 3–5) is blocked on
  you exporting the WP DB dump. The pure-conversion pieces (HTML→TipTap,
  taxonomy mapping) are already built and tested; the dump reader and
  import run are not, and shouldn't be attempted without the real dump.
- **Pending migration**: `drizzle/0004_home_tiles_image_keys_array.sql`
  (home_tiles: `image_key`/`cycle_group` → `image_keys` array +
  `cycle_interval_ms`, with any existing `image_key` backfilled into a
  1-element `image_keys` array) has only been applied to the local test
  Postgres. Run it against production the same way as step 1's initial
  schema apply: `DATABASE_URL="<pooled connection string>" pnpm drizzle-kit
  migrate`. It is non-destructive, but do this before relying on the
  editor's multi-image tiles in production.
