# Auth Implementation Plan

> **For agentic workers:** Implement task-by-task. Each task ends with green tests and a commit.

**Goal:** Google sign-in (identity only) with a long-lived, revocable session that gates the `/app/*` area to a single allow-listed user.

**Architecture:** Arctic drives the Google OAuth2 authorization-code flow. On callback we verify the account email against an env allow-list, upsert the `users` row, mint a random session token, store its hash in `sessions`, and set a signed, long-lived HttpOnly cookie. An Astro middleware resolves the cookie → session → user into `Astro.locals.user` on every request and 302s unauthenticated `/app/*` requests to login. Google is never called again after login and receives no content scopes.

**Tech Stack:** Arctic (Google OAuth2), Web Crypto (token hashing + cookie signing), Astro middleware.

**Depends on:** Plan 1 (schema `users`/`sessions`, `getDb`).

**Spec refs:** TECH_DECISIONS §6 (Google = identity only, own long-lived session, Arctic), REQUIREMENTS "Authenticated section".

---

## File structure

```
src/
├── lib/auth/
│   ├── google.ts          # Arctic Google client factory (from env)
│   ├── session.ts         # create/validate/revoke session; token hashing
│   ├── cookie.ts          # signed cookie read/write helpers (Web Crypto)
│   └── allowlist.ts       # email allow-list check
├── middleware.ts          # Astro middleware: resolve user, gate /app/*
├── pages/api/auth/
│   ├── login.ts           # 302 → Google authorize URL (+ state cookie)
│   ├── callback.ts        # handle code → session → set cookie → redirect /app
│   └── logout.ts          # revoke session + clear cookie
└── env.d.ts               # types for Astro.locals.user
tests/
├── session.test.ts
├── cookie.test.ts
└── auth.e2e.test.ts       # Playwright, mocked Google
```

## Task 1: Session core (token + hashing + lifecycle)

**Files:** Create `src/lib/auth/session.ts`, `tests/session.test.ts`

- [ ] **Step 1:** Write tests: `createSession(db, userId)` returns a plaintext token and stores only its SHA-256 hash in `sessions` with `expires_at ≈ now+5y`; `validateSession(db, token)` returns the user for a valid token, `null` for unknown/expired/revoked tokens; `revokeSession(db, token)` sets `revoked_at` so subsequent validation returns `null`. Sliding refresh: validating a session close to a refresh threshold extends `expires_at`.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement using Web Crypto `crypto.subtle.digest('SHA-256', …)` for hashing and `crypto.getRandomValues` for the token. Never store the plaintext token.
- [ ] **Step 4:** Run — expect PASS (against real Postgres).
- [ ] **Step 5:** Commit — `feat(auth): revocable long-lived sessions`.

**Acceptance:** Only hashes persist; revoke + expiry both invalidate.

## Task 2: Signed cookie helpers

**Files:** Create `src/lib/auth/cookie.ts`, `tests/cookie.test.ts`

- [ ] **Step 1:** Tests: `signValue(secret, value)` → `value.signature`; `verifyValue(secret, signed)` returns the value for a valid signature and `null` if tampered. HMAC via Web Crypto. Cookie attributes helper yields `HttpOnly; Secure; SameSite=Lax; Path=/` with a ~5-year `Max-Age`.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement HMAC-SHA256 signing with a `SESSION_SECRET` env value.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit — `feat(auth): signed cookie helpers`.

**Acceptance:** Tampered cookies reject; attributes match the spec.

## Task 3: Allow-list + Google client

**Files:** Create `src/lib/auth/allowlist.ts`, `src/lib/auth/google.ts`, extend `.env.example`

- [ ] **Step 1:** `allowlist.ts`: `isAllowed(email)` checks a comma-separated `AUTH_ALLOWED_EMAILS` env value (case-insensitive). Unit-test allowed/denied.
- [ ] **Step 2:** `google.ts`: factory building an Arctic `Google` client from `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`. Only `openid email profile` scopes — assert in a test that no Drive/Photos scope is requested.
- [ ] **Step 3:** Run tests — expect PASS.
- [ ] **Step 4:** Commit — `feat(auth): allow-list + Arctic Google client (identity scopes only)`.

**Acceptance:** Non-allow-listed emails are rejected downstream; scope set is identity-only.

## Task 4: Login / callback / logout endpoints

**Files:** Create `src/pages/api/auth/login.ts`, `callback.ts`, `logout.ts`

- [ ] **Step 1:** `login.ts`: generate Arctic state (+ PKCE), store state in a short-lived signed cookie, 302 to Google's authorize URL.
- [ ] **Step 2:** `callback.ts`: validate state cookie, exchange code via Arctic, decode the ID token for email, `isAllowed(email)` else 403, upsert `users` (by `google_sub`), `createSession`, set the signed session cookie, 302 → `/app`.
- [ ] **Step 3:** `logout.ts`: `revokeSession` + clear cookie, 302 → `/`.
- [ ] **Step 4:** Manual/dev check plus the e2e test in Task 6.
- [ ] **Step 5:** Commit — `feat(auth): login/callback/logout endpoints`.

**Acceptance:** A non-allow-listed Google account gets 403; an allow-listed one lands authenticated on `/app`.

## Task 5: Middleware + gating

**Files:** Create `src/middleware.ts`, `src/env.d.ts`; edit `src/pages/app/index.astro` (remove the Plan-1 TODO)

- [ ] **Step 1:** Middleware reads the session cookie, `validateSession`, sets `Astro.locals.user` (or null). For any `/app/*` path with no user → 302 to `/api/auth/login`. Public routes pass through untouched.
- [ ] **Step 2:** Type `App.Locals.user` in `env.d.ts`.
- [ ] **Step 3:** Update `/app` to greet `locals.user.email` and show a logout link.
- [ ] **Step 4:** Commit — `feat(auth): session middleware + /app gating`.

**Acceptance:** `/app` redirects to login when logged out; renders the user when logged in.

## Task 6: End-to-end auth flow

**Files:** Create `tests/auth.e2e.test.ts`

- [ ] **Step 1:** Playwright test with Google's token endpoint mocked: unauthenticated `/app` → redirected to login; simulate an allow-listed callback → cookie set → `/app` shows the email; logout → `/app` redirects again.
- [ ] **Step 2:** Add a denied-email case → 403.
- [ ] **Step 3:** Run — expect PASS.
- [ ] **Step 4:** Commit — `test(auth): e2e login/logout/deny`.

**Acceptance:** Full loop verified; denied emails blocked.

## Self-review notes
- Satisfies "stay signed in indefinitely" (5y sliding cookie) with a revoke escape hatch (session `revoked_at`).
- Confirms the "Google gets no content access" rule via the scope assertion in Task 3.
- `SESSION_SECRET`, `AUTH_ALLOWED_EMAILS`, and the Google creds are Cloudflare secrets (documented in `.env.example`), never committed.
