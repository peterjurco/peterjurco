import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // src/middleware.ts imports virtual modules that only exist inside the
      // Astro/Cloudflare build — unit tests get small stubs instead.
      'astro:middleware': new URL(
        './tests/helpers/stub-astro-middleware.ts',
        import.meta.url,
      ).pathname,
      'cloudflare:workers': new URL(
        './tests/helpers/stub-cloudflare-workers.ts',
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    globalSetup: ['tests/helpers/global-setup.ts'],
    // Dev-server tests (health, auth e2e) share the single .dev.vars file
    // and Astro's dev lock — never run test files concurrently.
    fileParallelism: false,
  },
})
