# peterjur.co — Technical Decisions

Record of the stack decisions made while scoping the rebuild, including the
options considered and why each was chosen. Written 2026-07-02.

## Context / goals driving the decisions

- Personal site: curated public **photography** showcase, private articles
  (author writes mostly for himself), semi-protected pages shared with friends,
  and a hub linking to Google Photos albums.
- Author is a **senior full-stack dev (~80% frontend, React/TS)**.
- Priorities, in order: **programmatic control over the app** (add features
  freely, no platform wall) · **not much ops appetite** (unsure about babysitting
  a server) · **fast in Slovakia** (EU hosting, no US) · **cheap** · modest photo
  hosting (hundreds of photos, not huge galleries).
- Editing: light rich text, but wants **more visual control than raw Markdown**,
  and a good **mobile** editing experience (WordPress editor is painful on mobile).

## Decisions

### 1. Build from scratch — not a CMS product, not a CMS framework

**Decision:** Custom app. Own the frontend and a thin content/auth layer.

**Considered:**
- **Stay on WordPress (Websupport)** — rejected: fighting the editor, plugin
  jungle for access tiers, limited programmatic control.
- **Ghost** — rejected: still a CMS-as-product; author expects to hit feature
  walls over time and wants code-level control.
- **Payload CMS (framework)** — rejected: powerful but it's a *framework* that
  owns the admin UI, data conventions, and access model. For modest needs it's a
  lot of framework to bend; adopting-then-fighting it is the worst case.
- **Build from scratch** — chosen: for modest needs, a CMS is really just
  (1) an editor, (2) a few DB tables, (3) auth/access tiers, (4) a rendering
  frontend, (5) media handling. Only the editor is genuinely hard, and that's a
  *library* (see below), not a framework. Everything else is normal app code.

**Guardrail:** "From scratch" means our own data model and UI — **not** our own
auth crypto/session primitives. Use a small, vetted auth library for token/cookie
handling.

### 2. Editor — TipTap (library, free)

**Decision:** [TipTap](https://tiptap.dev) for the editor.

**Why:** Headless editor library — we own the toolbar, UI, styling, and output
format (store JSON/HTML in our own DB). Hits the "more visual control than
Markdown, light rich text" sweet spot and is good on mobile. Used as a
*dependency*, not a framework — no worldview to adopt.

**Cost:** Editor core + standard extensions are open source (MIT) — **free**,
self-hosted. Paid parts are Tiptap Cloud (hosted collaboration/storage — not
needed; docs live in our own Postgres) and a few Pro extensions (not needed).

**Editing model (Google-Docs-style):** Articles are **always in edit mode** —
there is no separate "view page" vs "edit page". The editor *is* the page; a
single component and a single URL, with **permissions deciding editability**
(`editable: true/false`). Read-only mode (shared/friend access, or just reading)
renders the **document only** — **no toolbars or editing chrome**, just the
content. This one-component model is also exactly how access-gating is
implemented for shared articles.

### 3. Framework — Astro

**Decision:** Astro (SSR mode, since auth/editor/gated pages need server code).

**Why:** Site is mostly content + a photo portfolio with an editor admin area —
Astro is lighter and faster to ship than Next.js for this shape. (Next.js would
win only if the site were heavily app-like; it isn't.)

### 4. Hosting — serverless split (LOCKED 2026-07-06)

**Decision:** Cloudflare Pages + Neon + R2, i.e. a managed "serverless split".
Chosen once ops appetite turned out to be low **and** both Workers-runtime
frictions were resolved: image processing via CF Images (#5) and DB backups via a
scheduled GitHub Action (see below). **Accepted tradeoff:** code runs on the
Workers runtime (no Node native modules) — a theoretical limit that the feature
set (OIDC auth, TipTap save = DB writes, gated pages, HTML rendering) does not
strain.

**Considered (hosting spectrum, all run the same portable Astro app):**

| Option | Ops | EU latency | State (photos + DB) | Cost | Verdict |
| --- | --- | --- | --- | --- | --- |
| **AWS / GCP** | high / complex | fine (Frankfurt) | many services + IAM | unpredictable, egress fees | ❌ industrial overkill; lock-in creeps in via managed services |
| **Vercel** | none | ⚠️ dynamic = 1 region | ❌ external add-ons | metered bandwidth/images | ❌ can't hold state; meters image bandwidth (bad for a photographer) |
| **VPS (Netcup Vienna / Hetzner)** | you patch & back up | ✅ excellent (Vienna ≈ Bratislava) | ✅ local | ~€5/mo | ✅ total control, but ops burden |
| **Managed PaaS (Clever Cloud / Render / Fly, Frankfurt)** | none | ✅ good | ✅ volume + managed PG | ~€7–15/mo | ✅ zero ops + full Node (sharp works) |
| **Serverless split (CF Pages + Neon + R2)** | none | ✅ excellent (CF PoP in Bratislava) | ✅ managed | ~€0–1/mo | ✅ **front-runner** — cheapest, ops-free, no image wall |

Key reasoning:
- **Portability, not server ownership, is what prevents platform walls.** Because
  the app is a standard Astro + Postgres app, it can move between any of these in
  an afternoon. So hosting is purely an ops-vs-cost choice, with "control" off the
  table.
- **VPS price check (per year, tier = 2 vCPU / 4 GB / big-enough disk):**
  Websupport wanted **€42.30/mo** for 4 GB; **Netcup VPS Lite 1 (Vienna)** is
  **€4.88/mo** (~€59/yr, VAT in) for 4 GB / 80 GB — ~1/9 the price, and
  Vienna→Bratislava is ~55 km (~5–10 ms), so the Bratislava-proximity premium
  isn't worth it. Hetzner CX22 is similar (~€4.49/mo +VAT) but Germany + 40 GB.
- **Cloudflare has a PoP in Bratislava** → static assets served with near-zero
  latency to Slovak visitors.
- **Neon over Supabase** for the DB: Supabase's free tier **pauses** the project
  after ~7 days idle; Neon merely scales compute to zero (sub-second cold start).
  Both are managed Postgres in Frankfurt (~15–20 ms to Slovakia).

**DB backups (chosen approach):** `pg_dump` is a native binary and can't run on
Workers, so backups run via a **scheduled GitHub Action** (Neon connection string
in a GH secret) → dump uploaded to **R2** (and/or Google Drive, mirroring today's
WP setup), on top of **Neon's built-in backups / point-in-time restore**.

### 5. Photos & image transforms — R2 + Cloudflare Images free tier

**Decision:** Store photos in **Cloudflare R2**; generate display sizes via
**Cloudflare Images transformations** (free tier).

**Why R2:** S3-compatible object storage with **zero egress fees** — the right
cost model for serving heavy images (the axis where AWS/GCP/Vercel bite). ~20 GB
costs ~$0.15/mo (first 10 GB free, ~$0.015/GB after).

**The image-processing wall and how it's solved:** Cloudflare Pages runs dynamic
code on the **Workers runtime (V8 isolates), not full Node**, so native libraries
like **`sharp` don't run** — a real limit for a photographer wanting
thumbnails/responsive sizes. Two verified exits:
- **Cloudflare Images transformations — free tier: 5,000 unique transforms/month**,
  works on images stored anywhere (incl. R2). Cached requests don't count; on
  exceed it returns a `9422` error with **no charge** and can fall back to the
  original via `onerror`. **Chosen as the default** — keeps originals pristine in
  R2, transforms on the edge (doesn't tax the phone), good encoders, any size on
  demand.
- **Client-side compression on upload** (e.g. `browser-image-compression` →
  WebP at a couple of sizes → presigned upload to R2 → store `srcset`). Truly
  $0-compute, but pushes heavy encoding onto a **mobile** device (author edits on
  mobile) and browser encoders yield lower quality — kept as a **fallback** only
  if we ever exceed 5,000 unique transforms.
- Optional hybrid: a *mild* client-side downscale (cap longest edge ~2560px) just
  to speed mobile uploads, then edge-transform for display sizes.

**Consequence:** With image transforms free at the edge, the serverless split has
no remaining wall for this use case, making it the front-runner (#4).

### 6. Authentication — Google as identity only, long-lived own session

**Decision:** "Sign in with Google" (**OpenID Connect / identity only**) plus our
**own long-lived session** for the private area.

**Key points:**
- Google is used **purely for identity** — we request only basic sign-in scopes
  (email/profile). **No Drive, Photos, or content scopes.** Google therefore has
  **no access to the site's content** and is not involved after the initial
  login. This satisfies the "Google must not access the content" requirement.
- **"Stay signed in indefinitely on that device"** is our own concern, not
  Google's: after the first Google login we issue a **long-lived session cookie**
  (HttpOnly, Secure). Because this is effectively a **single-user** private area,
  session handling stays simple.
- **Library (LOCKED 2026-07-06):** **Arctic** (typed OAuth2 client, Workers-
  compatible) drives the Google flow; sessions are our own, stored in the
  `sessions` table, with the cookie signed via the Web Crypto API. Lightweight,
  no framework lock-in. (Lucia — the former default — was sunset in 2025, so it's
  avoided.) Satisfies the #1 guardrail: don't hand-roll crypto primitives.

### 7. Analytics — Cloudflare Web Analytics (not Google Analytics)

**Decision:** **Cloudflare Web Analytics** instead of Google Analytics.

**Why:** GA would ship visitor behaviour to Google — directly against the
"Google gets no access" spirit of this project. Cloudflare Web Analytics is
**free, privacy-friendly, cookie-less (no consent banner needed)**, and since the
site already sits on Cloudflare it's essentially a one-toggle addition.

### 8. Google Photos hub — curated links, no Photos API

**Decision:** The hub stores, per album, a **Google Photos share link + a
manually-set cover image + name + tags**. **No Google Photos API integration.**

**Why:**
- Reading an album's cover/title programmatically needs OAuth **Photos content
  scopes** — the exact access the project forbids (see #6). Manual entry keeps
  the "Google gets no content access" principle intact.
- Google **restricted the Photos Library API in 2025** (apps largely see only
  app-created media), so auto-pull likely wouldn't work anyway.
- Author confirmed manual cover/name entry is acceptable.

### 9. Unified visibility model (LOCKED 2026-07-06)

**Decision:** Two visibility states — **`private`** (only me) and
**`public-by-link`** (unlisted, reachable only by anyone holding the link). This
single primitive covers articles and photo-hub tags uniformly; the separate
"friends" section was dropped in favour of it (sharing with friends = handing out
a public-by-link URL).

**Public-facing IDs — opaque, not sequential (LOCKED 2026-07-06):** "Unlisted"
only holds if links aren't guessable/enumerable. A sequential integer ID
(`/a/42`) lets anyone walk `/a/1`, `/a/2`, … and discover every public-by-link
resource, even though private ones stay blocked — defeating "not listed
anywhere." **Chosen: every article and album gets an opaque, random public ID**
(e.g. nanoid-style, `/a/8xKq2mZ`) — unguessable, uniform across all resource
types, no separate "share token" mechanism needed (Option A, rejected the
sequential-ID-plus-token alternative as unnecessary extra machinery). Since URLs
don't need to be pretty, this costs nothing.

## Settled stack

**Astro (SSR) + TipTap + Neon Postgres (Frankfurt) + Cloudflare R2 +
Cloudflare Images (free) on Cloudflare Pages, behind Cloudflare's network,
keeping the existing `.co` domain (repoint DNS). Auth via Google OIDC (identity
only) + own long-lived session. Analytics via Cloudflare Web Analytics. Two
visibility states (`private` / `public-by-link`) with opaque public IDs.**

- All open source / standard components → portable, no platform wall.
- Zero ops, ~€0–1/mo compute, excellent latency in Slovakia.
- Keep `.co` domain (~€45/yr); drop the Websupport WP hosting (~€73/yr).

## Still open

- **WordPress DB dump** (author to export) — the only remaining blocker; unblocks
  the migration plan (#8). The migration script must flag multi-category posts for
  manual resolution rather than auto-pick — see
  [DATA_MODEL.md](./DATA_MODEL.md#migration-considerations).

## Locked reference docs

- [REQUIREMENTS.md](./REQUIREMENTS.md) — feature requirements.
- [DATA_MODEL.md](./DATA_MODEL.md) — full schema (users/sessions, articles +
  taxonomy, photo hub + taxonomy, apps, home tiles).
- [DESIGN.md](./DESIGN.md) — public-page visual language.
- [plans/](./plans/) — the 8-part implementation plan for handoff.
