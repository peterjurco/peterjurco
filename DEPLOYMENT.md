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

## 3. Cloudflare Pages (the app itself)

1. Cloudflare dashboard → Workers & Pages → **Create → Pages → Connect to
   Git** → select `peterjurco/peterjurco`, branch `master`.
2. Build settings:
   - Build command: `pnpm build`
   - Build output directory: `dist`
   - Node version: 24 (matches CI)
3. **Settings → Environment variables** — add every var below as a
   **Secret** (not plaintext) for the Production environment, values from
   steps 1–2 above and the Google/analytics steps below:
   - `DATABASE_URL`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
     (`https://peterjur.co/api/auth/callback`)
   - `SESSION_SECRET` — generate a **fresh** one for prod
     (`openssl rand -base64 32`), don't reuse your local dev value
   - `AUTH_ALLOWED_EMAILS`
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
     (leave `R2_ENDPOINT` unset — that's the local-MinIO-only override)
   - `PUBLIC_R2_PUBLIC_BASE_URL` (from step 2.3) — this one is read at
     **build** time, so it must also be set as a **build-time variable**,
     not just a runtime secret (Cloudflare Pages has separate fields for
     this; check both)
   - `PUBLIC_IMAGE_TRANSFORMS` — leave unset in production (transforms on
     by default; only set to `off` in dev/CI)
   - `PUBLIC_CF_ANALYTICS_TOKEN` (step 6) — also build-time
4. Trigger the first deploy (push to `master`, or "Retry deployment" in the
   dashboard once the vars are saved).

## 4. Point the domain at Cloudflare

1. If `peterjur.co` isn't already on Cloudflare DNS: add the site in the
   Cloudflare dashboard, then update the domain's **nameservers** at your
   registrar (Websupport) to Cloudflare's. This is the one step with real
   downtime risk if done carelessly — DNS propagation can take a few hours;
   do this when you can tolerate a brief gap, not mid-task.
2. Pages project → **Custom domains** → add `peterjur.co` (and `www.` if
   you want it). Cloudflare wires the DNS record automatically once the
   zone is active on Cloudflare.
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
