# viz-crop

Agricultural field visualization monorepo (`apps/*`, `packages/*`). See `docs/plan.md` for architecture and `docs/implementation.md` for the phased build plan.

## Prerequisites

- Node.js (matching `package.json` `engines`)
- pnpm
- Docker Desktop (for the local Postgres + PostGIS database)

## Local development

### 1. Install workspace dependencies

```sh
pnpm install
```

### 2. Start the database (Postgres 17 + PostGIS)

```sh
docker compose up -d
```

This launches a single `db` service (image `postgis/postgis:17-master`) with:

- User / password: `viz` / `viz`
- Database: `viz_crop`
- Host port: `5432` (mapped to the container's `5432`)
- Persistent storage in the named volume `viz_pgdata`
- A `pg_isready` healthcheck so dependents can wait for `service_healthy`

The default connection string for local development is:

```
postgres://viz:viz@localhost:5432/viz_crop
```

### Verify PostGIS is available

```sh
docker compose exec db psql -U viz -d viz_crop -c "select postgis_version();"
```

You should see a row with the installed PostGIS version (e.g. `3.x USE_GEOS=1 USE_PROJ=1 USE_STATS=1`).

### Useful database commands

```sh
# Stop the database (data is preserved in the volume)
docker compose down

# Stop AND wipe all data (drops the named volume)
docker compose down -v

# Tail database logs
docker compose logs -f db

# Open a psql shell
docker compose exec db psql -U viz -d viz_crop
```

> ⚠️ **Note**: The credentials above are intentional local-only defaults. Do not reuse them for any non-local environment.

## Quality gates

- `pnpm check` — Biome format + lint + safe assists (preferred local command)
- `pnpm run ci` — Biome read-only check (used in CI)
- `pnpm -r run typecheck` — TypeScript project references across the workspace

## Repository layout

- `apps/` — deployable applications (`@viz-crop/web`, `@viz-crop/api`)
- `packages/` — shared libraries (`@viz-crop/shared`)
- `docs/` — architecture (`plan.md`) and the implementation roadmap (`implementation.md`)
- `scripts/` — repo-level utilities
