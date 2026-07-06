/**
 * Local dev / CI only: the Neon HTTP driver cannot talk to plain Postgres, so
 * a local Neon HTTP proxy (ghcr.io/timowilhelm/local-neon-http-proxy — see
 * docker-compose.test.yml) serves the Neon wire-over-HTTP protocol.
 *
 * `db.localtest.me` resolves to 127.0.0.1; its presence in a database URL is
 * the marker that routes `getDb` through the proxy (src/db/client.ts). Shared
 * with tests/helpers/test-db.ts so the two sites cannot drift.
 */
export const LOCAL_NEON_PROXY_HOST = 'db.localtest.me'
export const LOCAL_NEON_PROXY_FETCH_ENDPOINT = `http://${LOCAL_NEON_PROXY_HOST}:4444/sql`
