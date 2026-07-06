import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['tests/helpers/global-setup.ts'],
    // Dev-server tests (health, auth e2e) share the single .dev.vars file
    // and Astro's dev lock — never run test files concurrently.
    fileParallelism: false,
  },
})
