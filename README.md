# viz-crop

Agricultural field visualization web app for Indian smallholder farmers — draw a polygon over a field, and the app surfaces Sentinel-2 imagery + NDVI / EVI / NDWI heatmaps and zonal statistics for that polygon, sourced through the EOSDA platform.

## Status

Build is staged across phases in [`docs/implementation.md`](./docs/implementation.md); the architecture and demo plan live in [`docs/plan.md`](./docs/plan.md). At the time of writing, **Phase 8 — Polish, tests, README** is the active phase. Always implement modules top-to-bottom; never skip ahead.

## Repository layout

- `apps/web` — `@viz-crop/web`, the React 19 + Vite SPA. TanStack Router for routes/data, MapLibre GL for the map canvas, Tailwind v4 + shadcn/ui for the design system.
- `apps/api` — `@viz-crop/api`, the Fastify HTTP server. Drizzle ORM against Postgres 17 + PostGIS, Clerk JWT auth (`@clerk/fastify`), and a server-side proxy for EOSDA so the browser never sees the EOSDA API key.
- `packages/shared` — `@viz-crop/shared`, the shared zod schemas + DTOs imported by both web and api (notably the India-bbox `polygonGeoJsonSchema`).
- `docs/` — `plan.md` (architecture + demo checklist) and `implementation.md` (phased roadmap, exit criteria, pending items).
- `docker-compose.yml` — local PostGIS 17 dev DB.

## Prerequisites

- **Node.js 20.19+** — matches `engines.node` in the root `package.json`.
- **pnpm 10+** — pinned via `packageManager` (`pnpm@10.33.0`). The repo uses pnpm workspaces; **do not** run with `npm` or `yarn` — the lockfile and workspace protocol (`workspace:*`) will not resolve.
- **Docker Desktop** — runs the local Postgres + PostGIS database.

## Pre-flight: external accounts

Create these three accounts before bring-up. All three are free to start.

| Service | Where | What to copy | Lands in |
|---|---|---|---|
| ArcGIS Developer | <https://developers.arcgis.com> → API Keys | A Basemaps-scoped key. Restrict it to `localhost` and your prod domain. | `VITE_ESRI_API_KEY` (web) |
| EOSDA | <https://api-connect.eos.com/user-dashboard/> → API keys | Register, then **email `api.support@eosda.com`** to activate the trial — the key is dormant until they reply. | `EOSDA_API_KEY` (api) |
| Clerk | <https://dashboard.clerk.com> → API Keys | Create an application; under Paths/Domains add `http://localhost:5173` as an allowed redirect/origin. Copy both the publishable and secret keys. | `VITE_CLERK_PUBLISHABLE_KEY` (web) and `CLERK_SECRET_KEY` (api) |

## Bring-up (cold start)

```sh
pnpm install
docker compose up -d
cp apps/api/.env.example apps/api/.env       # then fill in EOSDA_API_KEY, CLERK_SECRET_KEY
cp apps/web/.env.example apps/web/.env       # then fill in VITE_ESRI_API_KEY, VITE_CLERK_PUBLISHABLE_KEY
pnpm db:migrate
pnpm dev
```

Then open <http://localhost:5173>. You should be redirected to `/sign-in` (Clerk) on first visit.

> Windows note: the `cp` lines work in Git Bash / WSL / PowerShell 7+. In legacy `cmd.exe` use `copy apps\api\.env.example apps\api\.env` instead.

## Env file reference

Env vars are validated with zod at server/client startup, so missing or malformed values fail fast. **Never commit `.env` files.**

### `apps/api/.env` (see `apps/api/.env.example`)

| Var | Required | Owner / where to get it | First needed in |
|---|---|---|---|
| `PORT` | no (default `8080`) | local config | Module 0.3 |
| `DATABASE_URL` | yes | local Postgres; matches `docker-compose.yml` (`postgres://viz:viz@localhost:5432/viz_crop`) | Module 0.5 |
| `ALLOWED_ORIGINS` | yes | comma-separated CORS allowlist; defaults to `http://localhost:5173,http://127.0.0.1:5173` | Module 0.4 |
| `EOSDA_API_KEY` | yes | EOSDA dashboard (see pre-flight). Sent to EOSDA via `x-api-key`; never exposed to the browser. | Module 4.1 |
| `CLERK_SECRET_KEY` | yes | Clerk dashboard → API Keys (Secret keys) | Module 0.8 |

### `apps/web/.env` (see `apps/web/.env.example`)

| Var | Required | Owner / where to get it | First needed in |
|---|---|---|---|
| `VITE_API_BASE_URL` | yes | base URL of `@viz-crop/api`; default `http://localhost:8080` | Module 0.6 |
| `VITE_ESRI_API_KEY` | yes | ArcGIS Developers → API Keys (basemap scope) | Module 2.1 |
| `VITE_CLERK_PUBLISHABLE_KEY` | yes | Clerk dashboard → API Keys (must start with `pk_test_` or `pk_live_`) | Module 0.8 |

## Useful commands

| Command | What it does |
|---|---|
| `pnpm dev` | Runs api (`:8080`) + web (`:5173`) in parallel via `pnpm -r run dev` |
| `pnpm check` | Biome format + lint + safe assists, with autofix (preferred local command) |
| `pnpm run ci` | Biome read-only check used in CI. **Note:** never invoke as `pnpm ci` — that's pnpm's frozen-lockfile install. Always use `pnpm run ci`. |
| `pnpm typecheck` | TypeScript across all workspaces |
| `pnpm test` | Runs vitest in every workspace that has a `test` script |
| `pnpm build` | Production build of every workspace |
| `pnpm db:migrate` | Run pending Drizzle migrations against the dev DB (delegates to `apps/api`) |
| `pnpm db:generate` | Generate a new migration from `apps/api/src/db/schema.ts` changes |
| `pnpm db:studio` | Open Drizzle Studio against the dev DB |
| `docker compose up -d` | Start the local PostGIS container |
| `docker compose down` | Stop the container (data preserved in the named volume) |
| `docker compose down -v` | Stop **and wipe** all data (drops the `viz_pgdata` volume) |
| `docker compose logs -f db` | Tail database logs |

## Database

PostGIS 17 (`postgis/postgis:17-master`) running locally via `docker-compose.yml`. Default connection string is `postgres://viz:viz@localhost:5432/viz_crop`. Data persists in the named volume `viz_pgdata`; a `pg_isready` healthcheck lets dependents wait for `service_healthy`. The credentials are intentional local-only defaults — do not reuse them outside development.

Migration files live in `apps/api/src/db/migrations` and are managed by drizzle-kit. After a schema change in `apps/api/src/db/schema.ts`, run `pnpm db:generate` to create a migration, then `pnpm db:migrate` to apply it.

Verify PostGIS is available:

```sh
docker compose exec db psql -U viz -d viz_crop -c "select postgis_version();"
```

You should see a row like `3.x USE_GEOS=1 USE_PROJ=1 USE_STATS=1`.

## Demo walkthrough

A condensed version of the [end-to-end demo checklist](./docs/plan.md#end-to-end-demo-checklist):

1. Visit <http://localhost:5173> → redirect to `/sign-in` → Clerk login.
2. Land on dashboard with empty state → click "+" → `/fields/new`.
3. Map loads Karnataka satellite + labels at zoom 8.
4. Draw a polygon over a Mandya rice field (4+ points; double-click closes).
5. Fill the form (name, crop, season, village/district/state) → "Create Field" → POST returns in <300 ms → redirect to `/fields/:id`.
6. Analysis screen renders top bar, sidebar shell, bottom-bar shell, and a full-screen map with the field outlined.
7. NDVI heatmap appears once scenes load; date timeline shows available dates and selects the latest non-cloudy.
8. Switching dates updates the heatmap; switching the index dropdown switches to EVI; the opacity slider works.
9. Sample sidebar pane shows mean / p10 / p90 / median; the Chart tab plots the NDVI line.
10. Back to the dashboard → field appears with correct area in hectares.
11. Delete the field → cascade removes cached scenes/stats.
12. The browser network tab shows zero direct EOSDA calls — every request goes through `/api/...`.

For Karnataka-first demos, see the [test fields table](./docs/plan.md#test-fields-for-demo-karnataka-first):

| Region | Coords (lon, lat) | Why test it | Best date |
|---|---|---|---|
| Mandya, Karnataka | `76.90, 12.52` | Cauvery basin rice paddy | Aug–Oct |
| Belagavi, Karnataka | `74.50, 15.85` | Sugarcane belt | Year-round |
| Hassan, Karnataka | `75.70, 13.20` | Coffee belt — Western Ghats | Nov–Feb |
| Ludhiana, Punjab | `75.85, 30.90` | Clean rabi wheat signal | Feb–Mar |
| Tirunelveli, Tamil Nadu | `77.17, 8.50` | Tropical rice | Jan–Mar |

## Troubleshooting

- **`401 Unauthorized` on every API call.** Clerk publishable key not set, or the app domain doesn't match the Clerk dashboard. Check `VITE_CLERK_PUBLISHABLE_KEY` in `apps/web/.env` and confirm `http://localhost:5173` is an allowed origin/redirect URL in the Clerk dashboard.
- **EOSDA `402 Payment Required` / quota exceeded.** Trial activation is still pending or the daily quota has been hit. Email `api.support@eosda.com`. The API does not yet translate upstream 402 responses to a dedicated client sentinel, so today the app surfaces this as a generic 502 "Upstream service unavailable" toast via `notifyError`. (`notify.ts` already has copy reserved for `EOSDA_BUDGET_EXCEEDED` once the API starts emitting it.)
- **`relation "fields" does not exist`.** The dev DB has not been migrated. Run `pnpm db:migrate`.
- **MapLibre StrictMode warnings in the dev console.** Expected. React StrictMode double-mounts effects in dev; see `apps/web/src/hooks/useMapInstance.ts` for the readiness contract that handles it.
- **Polygon refused with `outside India bbox`.** The shared zod `polygonGeoJsonSchema` enforces an India bounding box. See `packages/shared/src/field.ts`.
- **`pnpm ci` fails with `ERR_PNPM_CI_NOT_IMPLEMENTED`.** That's pnpm's not-implemented frozen-lockfile install. Use `pnpm run ci` instead — it runs the Biome CI check defined in `package.json`.

## Quality gates / CI expectations

The bar before merging or calling the prototype done:

```sh
pnpm run ci      # Biome format + lint, read-only
pnpm typecheck   # TypeScript across all workspaces
pnpm test        # vitest in every workspace that has it
pnpm build       # production build of every workspace
```

All four green, plus a manual pass through the demo checklist above.

## License

_TBD — no license file is currently committed._
