/**
 * Vitest stand-in for the `cloudflare:workers` virtual module (aliased in
 * vitest.config.ts). Unit tests importing src/middleware.ts read this env.
 */
export const env = {
  SESSION_SECRET: 'middleware-test-secret-32-chars!!!!!',
  DATABASE_URL: 'postgres://stub:stub@localhost:5432/stub',
} as Env
