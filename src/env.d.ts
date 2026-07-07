/// <reference types="astro/client" />

interface Env {
  DATABASE_URL: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  GOOGLE_REDIRECT_URI: string
  SESSION_SECRET: string
  AUTH_ALLOWED_EMAILS: string
  /** Test-only Google token endpoint override — unset in production. */
  AUTH_TOKEN_ENDPOINT?: string
  // R2 S3-API credentials for presigned uploads (src/lib/media/r2.ts).
  R2_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_BUCKET?: string
  /** Test-only S3 endpoint override (MinIO) — unset in production. */
  R2_ENDPOINT?: string
}

// Build-time public env (Vite) — read by src/lib/media/image-url.ts.
interface ImportMetaEnv {
  readonly PUBLIC_R2_PUBLIC_BASE_URL?: string
  /** Set to `off` where no Cloudflare zone serves /cdn-cgi/image (dev/tests). */
  readonly PUBLIC_IMAGE_TRANSFORMS?: string
}

declare module 'cloudflare:workers' {
  export const env: Env
}

type Runtime = import('@astrojs/cloudflare').Runtime

declare namespace App {
  interface Locals extends Runtime {
    /** Set by src/middleware.ts from the session cookie; null when logged out. */
    user: import('./lib/auth/session').SessionUser | null
  }
}
