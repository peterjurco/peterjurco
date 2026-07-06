/// <reference types="astro/client" />

interface Env {
  DATABASE_URL: string
}

declare module 'cloudflare:workers' {
  export const env: Env
}

type Runtime = import('@astrojs/cloudflare').Runtime

declare namespace App {
  interface Locals extends Runtime {}
}
