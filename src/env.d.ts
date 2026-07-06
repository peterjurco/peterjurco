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
}

declare module 'cloudflare:workers' {
  export const env: Env
}

type Runtime = import('@astrojs/cloudflare').Runtime

declare namespace App {
  interface Locals extends Runtime {}
}
