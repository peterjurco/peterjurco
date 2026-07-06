# peterjur.co

Personal website (articles, photo hub, freeform homepage) — a ground-up rebuild
of the old WordPress site.

**Stack:** Astro (SSR, `@astrojs/cloudflare`) · React islands · TipTap ·
TypeScript · Drizzle ORM on Neon Postgres · Cloudflare Pages/Workers · R2 ·
Biome · Vitest.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the dev server |
| `pnpm build` | Production build |
| `pnpm check` | Type check (`astro check`) |
| `pnpm lint` | Lint/format check (`biome ci .`) |
| `pnpm test` | Run the test suite (`vitest run`) |

## Testing locally

The tests run against a real local Postgres plus a Neon HTTP proxy (so the
production `neon-http` driver works in dev-server tests). Start both with:

```sh
docker compose -f docker-compose.test.yml up -d
pnpm test
```

The suite connects via `TEST_DATABASE_URL` (see `.env.example`; defaults to
`postgresql://postgres:postgres@localhost:5544/peterjurco_test`) and applies
the checked-in drizzle migrations before running.

## Docs

- Implementation plans: [plans/](./plans/README.md)
- Specs: [REQUIREMENTS](./REQUIREMENTS.md) · [TECH_DECISIONS](./TECH_DECISIONS.md)
  · [DATA_MODEL](./DATA_MODEL.md) · [DESIGN](./DESIGN.md)
