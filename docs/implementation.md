# viz-crop — Sequential Implementation Guide

> Companion to [`plan.md`](./plan.md). The plan defines **what** we are building. This document defines **the order in which to build it**.
>
> Each phase contains modules. Each module contains tasks. Tasks are written so they can be executed one at a time, in order. A later task may assume earlier tasks are done. Module-level dependencies are called out at the top of every module.

**Document version:** 1.1
**Source of truth:** [`plan.md`](./plan.md) owns product decisions and sequencing; [`architecture.md`](./architecture.md) owns technical architecture, database schema, and API contracts.
**Status:** Phase 0-2 complete; review corrections applied before Phase 3

---

## How to use this document

1. Work top-to-bottom. Do not jump phases.
2. Inside a module, do tasks in the listed order. They are sequenced by dependency.
3. Each module ends with **Done when** — verify before moving on.
4. Each phase ends with **Phase exit criteria** — verify before starting the next phase.
5. If something feels out of order, the plan.md decision log wins; update both files together.

External account setup (ArcGIS, EOSDA, Clerk) runs in parallel with Phase 0. EOSDA trial activation is the longest pole — start the email on day one.

---

## Table of contents

- [Pre-flight (account setup, in parallel with Phase 0)](#pre-flight-account-setup-in-parallel-with-phase-0)
- [Phase 0 — Monorepo, tooling, auth shell](#phase-0--monorepo-tooling-auth-shell)
- [Phase 1 — Database + field CRUD](#phase-1--database--field-crud)
- [Phase 2 — Map foundation + basemap (Layers 1+2)](#phase-2--map-foundation--basemap-layers-12)
- [Phase 3 — Drawing + Layer 3 + create form](#phase-3--drawing--layer-3--create-form)
- [Phase 4 — EOSDA warm-up service](#phase-4--eosda-warm-up-service)
- [Phase 5 — Analysis layout shells + map overlays](#phase-5--analysis-layout-shells--map-overlays)
- [Phase 6 — NDVI tiles (Layer 4) + DateTimeline](#phase-6--ndvi-tiles-layer-4--datetimeline)
- [Phase 7 — Statistics + Sample pane + Chart tab](#phase-7--statistics--sample-pane--chart-tab)
- [Phase 8 — Polish, tests, README](#phase-8--polish-tests-readme)
- [Appendix A — Module dependency graph](#appendix-a--module-dependency-graph)

---

## Pre-flight (account setup, in parallel with Phase 0)

These are blocking for later phases but require external lead time. Kick them off before writing any code.

| # | Task | Blocks | Where it lands |
|---|---|---|---|
| P.1 | Sign up at [developers.arcgis.com](https://developers.arcgis.com); create API key scoped to **Basemaps**; restrict to `localhost` + prod domain. This key becomes required once Phase 2 ships. | Phase 2 | `VITE_ESRI_API_KEY` |
| P.2 | Sign up at [api-connect.eos.com](https://api-connect.eos.com/user-dashboard/); email `api.support@eosda.com` to activate the trial and ask only for current trial rate limits (RPM) and total monthly quota. The Cropper API creation flow, Render alias support, and Search request shape are already documented in `docs/review-findings.md` §3.5 and need no support clarification. | Phase 4 for Search; Phase 6 for Render | `EOSDA_API_KEY`; quota response recorded in the Phase 4 notes |
| P.3 | Sign up at [clerk.com](https://clerk.com); create application; configure `http://localhost:5173` redirect; copy publishable + secret keys. | Phase 0.8 | `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` |

**Pre-flight done when:** all three keys live in a local `.env` (never committed), the `.env.example` files in `apps/web` and `apps/api` document them. Search and Render can proceed immediately on `EOSDA_API_KEY`; the support reply on rate limits/quota is informational only and does not block any module.

---

## Phase 0 — Monorepo, tooling, auth shell

**Goal:** A repo where `pnpm install && docker compose up -d && pnpm dev` boots a Postgres container, a Fastify API, and a Vite React app; visiting `/` while signed-out redirects to Clerk sign-in; signing in lands on an empty `/`.

**Phase entry:** Pre-flight P.3 (Clerk keys) must be ready before Module 0.7.

### Module 0.1 — Workspace skeleton ✅ (completed 2026-05-07)

Depends on: nothing.

1. `pnpm init` at repo root; set `"name": "viz-crop"`, `"private": true`.
2. Create `pnpm-workspace.yaml` listing `apps/*` and `packages/*`.
3. Add root `tsconfig.base.json` with strict TS settings; per-app `tsconfig.json` extends it.
4. Install Biome at the repo root as a pinned dev dependency: `pnpm add -D -E -w @biomejs/biome`. Biome owns **both** formatting and linting (and import organization) for the whole monorepo — there is no ESLint or Prettier in this project. Pinning (`-E`) is required: Biome's config schema is version-specific and unpinned upgrades can break CI silently.
5. Run `pnpm exec biome init` at the repo root to generate `biome.json`. Edit it to:
   - `"$schema": "https://biomejs.dev/schemas/<version>/schema.json"` (match the installed version).
   - Enable `formatter`, `linter`, and `assist` (organize-imports lives under `assist` in Biome v2).
   - Set `"vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true }` so Biome respects `.gitignore` across the workspace.
   - Configure `files.includes` to scope Biome to `apps/**` and `packages/**` and exclude `**/dist`, `**/coverage`, `**/.turbo`, `**/db/migrations/**`.
   - Pick formatter defaults once for the whole repo (2-space indent, single quotes for JS, trailing commas `all`, line width 100 — adjust to taste, but record the choice here so per-package overrides stay rare).
   - Enable the `recommended` linter rule set and the `style` + `correctness` groups; tune individual rules later as the codebase grows.
6. Add root `package.json` scripts:
   - `dev`, `build`, `test`, `typecheck` — each delegating to `pnpm -r run <name>`.
   - `format`: `biome format --write .`
   - `lint`: `biome lint .`
   - `check`: `biome check --write .` (formats, lints, and applies safe assist actions in one pass — the preferred local command).
   - `ci`: `biome ci .` (read-only, optimized for CI; fails on any diagnostic).
7. Add `.gitignore` (node_modules, dist, .env, .turbo, coverage, .DS_Store).
8. Add `.editorconfig`. Set `"formatter": { "useEditorconfig": true }` in `biome.json` if you want Biome to inherit `indent_style` / `indent_size` / `end_of_line` from it.
9. Add `.vscode/extensions.json` recommending `biomejs.biome`, and `.vscode/settings.json` with `"editor.defaultFormatter": "biomejs.biome"` plus `"editor.codeActionsOnSave": { "source.fixAll.biome": "explicit", "source.organizeImports.biome": "explicit" }` so editor-on-save behavior matches `pnpm run ci`.
10. **Do not** add ESLint, Prettier, or their configs/plugins anywhere in the workspace. If a package ever needs a tweak, create a nested `biome.json` that extends the root via `"extends": "//"`.
11. Commit.

**Done when:** `pnpm install` succeeds at root; `pnpm -r run typecheck` runs (even if no packages yet exist); `pnpm check` runs cleanly against the empty workspace; opening a `.ts` file in VS Code formats with Biome on save.

### Module 0.2 — Local Postgres + PostGIS ✅ (completed 2026-05-07)

Depends on: 0.1.

1. Create `docker-compose.yml` at repo root with one service `db` using `postgis/postgis:17-master`.
2. Set env: `POSTGRES_USER=viz`, `POSTGRES_PASSWORD=viz`, `POSTGRES_DB=viz_crop`.
3. Map port `5432:5432`; add named volume `viz_pgdata`.
4. Add a `healthcheck` using `pg_isready -U viz`.
5. Document `docker compose up -d` in README placeholder.
6. Verify `psql 'postgres://viz:viz@localhost:5432/viz_crop' -c 'select postgis_version();'`.

**Done when:** Postgres responds and `postgis_version()` returns a version string.

### Module 0.3 — `packages/shared` skeleton ✅ (completed 2026-05-07)

Depends on: 0.1.

1. Scaffold `packages/shared` with its own `package.json` (`name: @viz-crop/shared`, `type: module`).
2. Add `tsconfig.json` extending `tsconfig.base.json`; output to `dist/`.
3. Install `zod`.
4. Create `src/index.ts` re-exporting from `./common`, `./field`, `./eosda` (empty stub files for now).
5. Add `build` script (`tsc -b`).

**Done when:** `pnpm --filter @viz-crop/shared build` compiles successfully against empty stubs.

### Module 0.4 — `apps/api` skeleton ✅ (completed 2026-05-07)

Depends on: 0.1, 0.3 (workspace link).

1. Scaffold `apps/api` (`pnpm create fastify` or hand-rolled). In `apps/api/package.json`, set `"name": "@viz-crop/api"` (every later `pnpm --filter @viz-crop/api ...` command depends on this exact name).
2. Install: `fastify`, `@fastify/cors`, `@fastify/sensible`, `pino-pretty`, `zod`, `tsx`, `typescript`, `@types/node`.
3. Add `apps/api/package.json` script `dev: tsx watch src/server.ts`.
4. Create `src/env.ts` — zod-parse `process.env` into a typed `env` object (PORT, DATABASE_URL, ALLOWED_ORIGINS, EOSDA_API_KEY?, CLERK_SECRET_KEY?). Throw on missing required vars (CLERK_SECRET_KEY and EOSDA_API_KEY may stay optional until their respective phases).
5. Create `src/server.ts` — build Fastify with pino logger, register `@fastify/sensible`.
6. Create `src/plugins/cors.ts` — `@fastify/cors` reading `env.ALLOWED_ORIGINS` (comma-separated).
7. Create `src/routes/health.ts` — `GET /api/health` returning `{ ok: true }`.
8. Wire plugins + routes in `server.ts`; bind to `env.PORT`.
9. Add `apps/api/.env.example` listing every variable.

**Done when:** `pnpm --filter @viz-crop/api dev` boots; `curl http://localhost:8080/api/health` returns `{"ok":true}`.

### Module 0.5 — `apps/web` skeleton ✅ (completed 2026-05-08)

Depends on: 0.1, 0.3.

1. Scaffold `apps/web` with `pnpm create vite` (React + TS template). In `apps/web/package.json`, set `"name": "@viz-crop/web"` (every later `pnpm --filter @viz-crop/web ...` command depends on this exact name).
2. Install Tailwind CSS v4 + `@tailwindcss/vite`; wire `vite.config.ts` and `src/styles/globals.css`.
3. Run `pnpm dlx shadcn@latest init`; pick the dark-friendly theme; configure `components.json` with alias `@/components`.
4. Install initial shadcn primitives needed in early phases: `button`, `form`, `dialog`, `sheet`, `tabs`, `tooltip`, `select`, `slider`, `input`.
5. Install `lucide-react`, `sonner`, `date-fns`, `@turf/turf`.
6. Create `src/env.ts` with a small zod-validated reader for `import.meta.env.VITE_*`.
7. Create a placeholder `App.tsx` rendering "viz-crop boot OK".
8. Add `apps/web/.env.example` listing every `VITE_*` variable.

**Done when:** `pnpm --filter @viz-crop/web dev` serves the placeholder at `http://localhost:5173`.

### Module 0.6 — TanStack Router (file-based) ✅ (completed 2026-05-08)

Depends on: 0.5.

1. Install `@tanstack/react-router`, `@tanstack/react-router-devtools`, `@tanstack/router-plugin` (Vite plugin) and `@tanstack/router-cli` if using codegen.
2. Configure `vite.config.ts` with the Router plugin (file-based routes from `src/routes`).
3. Create `src/routes/__root.tsx` with `<Outlet />` and the `<TanStackRouterDevtools />` (dev only).
4. Create `src/routes/index.tsx` rendering "Dashboard placeholder".

> ⚠️ PENDING (resolved in Module 0.8): `routes/index.tsx` was intentionally **not** created — the file would conflict with `routes/_auth/index.tsx` (both pathless-layout `_auth` index and the root index match `/`). The "Dashboard placeholder" lives at `routes/_auth/index.tsx`, which Module 0.8 turned into the gated dashboard via the Clerk redirect in `_auth/route.tsx`. No further action required.
5. Create `src/routes/sign-in.tsx` rendering "Sign-in placeholder".
6. Create `src/routes/_auth/route.tsx` (gated layout placeholder; auth check added in 0.8).
7. Create `src/routes/_auth/index.tsx` and `src/routes/_auth/fields.new.tsx` and `src/routes/_auth/fields.$id.tsx` as placeholders.
8. Mount the router in `src/main.tsx`.

**Done when:** Navigating between `/`, `/sign-in`, `/fields/new`, `/fields/abc` works without 404; router devtools panel is reachable.

### Module 0.7 — TanStack Query ✅ (completed 2026-05-08)

Depends on: 0.5.

1. Install `@tanstack/react-query`, `@tanstack/react-query-devtools`.
2. In `src/main.tsx`, create a `QueryClient` and wrap the router in `<QueryClientProvider>`.
3. Render `<ReactQueryDevtools />` in `__root.tsx` (dev only).
4. Add `lib/api.ts` — `apiFetch(path, init?)` wrapper that:
   - Prefixes `VITE_API_BASE_URL`.
   - Throws on non-2xx with a typed error object.
   - Will inject the Clerk JWT after Module 0.8.

**Done when:** A trivial test query (e.g., `useQuery(['health'], () => apiFetch('/api/health'))`) renders `ok: true` on the placeholder dashboard.

### Module 0.8 — Clerk auth (web + API) ✅ (completed 2026-05-08)

Depends on: 0.4, 0.6, 0.7. Pre-flight P.3.

1. **Web:** install `@clerk/react` (Clerk Core 3 — replaces the deprecated `@clerk/clerk-react`). Wrap `__root.tsx` in `<ClerkProvider publishableKey={env.VITE_CLERK_PUBLISHABLE_KEY}>`.
2. Replace `routes/sign-in.tsx` with Clerk's `<SignIn />` component centered card.
3. In `routes/_auth/route.tsx`, use `useAuth()` to redirect to `/sign-in` when not signed in.
4. Update `lib/api.ts` to read the active session token via Clerk's `getToken()` and send `Authorization: Bearer <jwt>` on every `apiFetch` call.
5. **API:** install `@clerk/fastify`. Register `clerkPlugin()` once in `server.ts`.
6. Add `src/plugins/auth.ts` — a `requireUser` preHandler that calls `getAuth(request)`; if `auth.userId` is missing, throws `httpErrors.unauthorized()`.
7. Apply `requireUser` to all `/api/*` routes except `/api/health` (use route-level `preHandler` or a `withAuth` helper).
8. Add a temporary probe route `GET /api/_auth-check` (protected by `requireUser`, returns `{ userId: auth.userId }`) so the auth wall can be exercised before any business routes exist. Mark it with a `// TODO Phase 1: remove once /api/fields exists` comment.
9. Make `CLERK_SECRET_KEY` required in `apps/api/src/env.ts`.

> ✅ RESOLVED: The temporary auth-check probe `GET /api/_auth-check` was removed when Module 1.6 landed `/api/fields` (no remaining match for `_auth-check` in `apps/api/src`). The auth wall is now exercised through real business routes.

> 📝 NOTE: `clerkPlugin()` is registered globally so `getAuth(request)` works in any handler, but **no route is auto-protected** — routes opt in via `{ preHandler: requireUser }`. This is the inverse of "default-deny" and must be reconsidered in Module 1.6 when business routes land. Audit each new `/api/*` route for the `requireUser` preHandler.

> 📝 NOTE: The web side gates the `<RouterProvider>` mount with `<ClerkLoaded>` so `_auth/route.tsx` `beforeLoad` can safely assume `auth.isLoaded` is `true`. `<InnerApp>` calls `router.invalidate()` whenever `auth.isSignedIn`/`auth.isLoaded` change so sign-out triggers the `_auth` redirect on the next navigation tick.

**Done when:**
- Visiting `/` while signed-out redirects to `/sign-in`.
- After Clerk sign-in, lands on `/` with the placeholder dashboard.
- `curl http://localhost:8080/api/health` still returns 200.
- `curl http://localhost:8080/api/_auth-check` returns 401 without a bearer token and 200 with a valid Clerk JWT.

### Phase 0 exit criteria ✅ (completed 2026-05-08)

- `pnpm install && docker compose up -d && pnpm dev` boots both apps and the DB.
- `pnpm -r run build` succeeds.
- `pnpm -r run typecheck` and `pnpm run ci` (Biome) are clean. (Note: `pnpm ci` without `run` is reserved by pnpm and errors with `ERR_PNPM_CI_NOT_IMPLEMENTED` — always use `pnpm run ci` to invoke the Biome CI script.)
- Sign-in redirect works.

Commit and tag this state as `phase-0-complete` (optional but useful for rollback).

---

## Phase 1 — Database + field CRUD

**Goal:** Authenticated users can create, list, read, rename, and delete fields. The dashboard renders their field list with computed area in hectares. PostGIS protects geometry validity.

**Phase entry:** Phase 0 complete.

### Module 1.1 — Drizzle setup ✅ (completed 2026-05-08)

Depends on: 0.4.

1. Install in `apps/api`: `drizzle-orm`, `drizzle-kit`, `pg`, `@types/pg`.
2. Create `src/db/client.ts` — pg `Pool` from `env.DATABASE_URL`, wrap with Drizzle. Export `db` and `pool`.
3. Create `drizzle.config.ts` at `apps/api/` root (schema path, out path `src/db/migrations`, dialect `postgresql`, dbCredentials from env).
4. Create `src/plugins/db.ts` — Fastify plugin decorating `app.db` with the Drizzle client; closes pool on `app.close`.
5. Register the plugin in `server.ts` after env validation.

**Done when:** `app.db.execute(sql\`select 1 as ok\`)` returns `[{ ok: 1 }]` from a quick sanity script.

### Module 1.2 — Schema + initial migration ✅ (completed 2026-05-08)

Depends on: 1.1, 0.2.

1. Create `src/db/schema.ts` with the tables defined in [`architecture.md` §5](./architecture.md#5-database-schema):
   - `fields` (with PostGIS `geometry('Polygon', 4326)`, generated `area_hectares`, `eosda_cropper_ref`, `sowing_date`, validity + SRID checks).
   - `cached_scenes`.
   - `cached_ndvi_stats`.
2. `pnpm drizzle-kit generate` to produce the SQL migration.
3. Hand-edit the generated SQL (or add a hand-written `0000_extensions.sql`) so the very first statements are:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   CREATE EXTENSION IF NOT EXISTS pgcrypto;
   ```
4. Confirm the migration includes the GIST index on `fields(geometry)` and the `(field_id, view_id)` unique on caches.
5. Apply with `pnpm drizzle-kit migrate`.

**Done when:** `\d fields` shows the generated `area_hectares` column and the GIST index; `INSERT` of a hand-crafted polygon via psql succeeds and `area_hectares` is non-null.

### Module 1.3 — Geometry helpers (server-side) ✅ (completed 2026-05-08)

Depends on: 1.1.

1. Create `src/db/geometry.ts` exporting:
   - `geometryFromGeoJson(geom)` → `sql\`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geom)}), 4326)\``.
   - `geometryToGeoJson(col)` → `sql\`ST_AsGeoJSON(${col})::json\`` for selects.
2. Add a tiny unit test that round-trips a polygon literal through pg via `app.db.execute`.

**Done when:** Insert + select round-trips a small polygon and gets back the same coordinates within float tolerance.

> **Polygon ser/des contract.** Drizzle's built-in `geometry()` column type only auto-converts `Point` (see [`docs/review-findings.md` §3.1](./review-findings.md#31-phase-01--drizzle--postgis-for-polygons)). For polygons we treat the column as opaque on insert/select and route every read/write through the helpers above so the SRID 4326 tag and `ST_AsGeoJSON` projection stay consistent. The matching CHECK constraints in `apps/api/src/db/schema.ts` (`fields_geometry_valid`, `fields_geometry_srid`) enforce the same invariants at the database. Note also the open Drizzle bug [#3040](https://github.com/drizzle-team/drizzle-orm/issues/3040): `drizzle-kit generate` can emit `geometry(point)` for a polygon column — review every generated migration before commit. Our `0000_green_swarm.sql` already encodes `geometry(Polygon,4326)` correctly.

### Module 1.4 — Shared zod schemas (fields + geometry) ✅ (completed 2026-05-08)

Depends on: 0.3.

1. In `packages/shared/src/common.ts`:
   - `polygonGeoJsonSchema` — strict GeoJSON Polygon (single outer ring, optional holes), float lon/lat.
   - Refinements: ring closed (first === last), at least 4 positions in outer ring, all points inside India bbox `[68, 6, 98, 38]`.
2. In `packages/shared/src/field.ts`:
   - `cropTypeEnum` — exactly the 10 crops in [`plan.md` Create flow](./plan.md#create-fieldsnew).
   - `seasonEnum` — `['Kharif', 'Rabi', 'Zaid', 'Annual']`.
   - `createFieldDto` — name (1–120), cropType, season, optional metadata, geometry.
   - `updateFieldDto` — `createFieldDto.partial().omit({ geometry: true })` (geometry is immutable for v2; document this).
   - `fieldDto` — server-shaped record (id, name, area_hectares, etc.).
3. In `packages/shared/src/eosda.ts` add stubs for `sceneDto` and `ndviStatsDto` (filled in later phases).
4. Re-export everything from `src/index.ts`.

**Done when:** `pnpm --filter @viz-crop/shared build` succeeds and `apps/web` + `apps/api` can both import the schemas.

### Module 1.5 — Geometry area + bounds validation tests ✅ (completed 2026-05-08)

Depends on: 1.4.

1. Add `vitest` to `packages/shared` (devDep) and a minimal `vitest.config.ts`.
2. Write tests for `polygonGeoJsonSchema`:
   - Accepts a valid Karnataka polygon (~1 ha).
   - Rejects open ring.
   - Rejects polygon outside India bbox (e.g., NYC).
   - Rejects sub-0.05 ha polygons (use `@turf/area` in the refinement; install Turf in `packages/shared` or implement minimal area math locally — pick one and document).
   - Rejects polygons larger than 200 km².
3. Wire `pnpm test` at root to run all package tests.

**Done when:** `pnpm test` runs and the suite passes.

> ✅ RESOLVED in Module 3.2 (2026-05-09): Terra Draw's built-in `ValidateNotSelfIntersecting` is now invoked in `useFieldDrawing`'s `finish` handler, so bowties are caught client-side with a toast before they reach the store. The PostGIS `ST_IsValid` CHECK constraint remains as a defense-in-depth backstop for any path that bypasses the drawing UI (e.g., a future API import).

### Module 1.6 — Field routes (CRUD) ✅ (completed 2026-05-09)

Depends on: 1.2, 1.3, 1.4, 0.8.

1. Create `src/routes/fields.ts`. Use the `requireUser` preHandler.
2. `GET /api/fields` — select all fields where `user_id = auth.userId`, ordered by `created_at DESC`. Use `geometryToGeoJson` to project geometry.
3. `POST /api/fields` — parse body with `createFieldDto`, insert with `geometryFromGeoJson`, return `{ id }`. Leave a `// TODO Phase 4: void warmField(id)` marker.
4. `GET /api/fields/:id` — fetch by id, 404 if not owned by `auth.userId`.
5. `PATCH /api/fields/:id` — parse with `updateFieldDto`, update only metadata fields, bump `updated_at`.
6. `DELETE /api/fields/:id` — hard delete; ON DELETE CASCADE handles caches.
7. Register the route file in `server.ts`.
8. Remove the temporary `GET /api/_auth-check` probe route added in Module 0.8 — `/api/fields` is now the canonical authed route.

**Done when:** A signed-in `curl` flow can POST → GET → PATCH → DELETE a field. A second user gets an empty list and 404 for the first user's IDs.

### Module 1.7 — Web `useFields` hook ✅ (completed 2026-05-09)

Depends on: 0.7, 0.8, 1.6.

1. Create `apps/web/src/hooks/useFields.ts`:
   - `useFieldList()` — `useQuery(['fields'])`.
   - `useField(id)` — `useQuery(['fields', id])`.
   - `useCreateField()` — `useMutation` POST + invalidate `['fields']`.
   - `useUpdateField(id)` and `useDeleteField(id)` similar.
2. Set sensible TanStack defaults (5 min stale for both `useFieldList()` / `['fields']` and `useField(id)` / `['fields', id]` per [`plan.md` TanStack Query cache defaults](./plan.md#tanstack-query-cache-defaults)).

**Done when:** A scratch component listing `useFieldList().data` renders the seeded user's fields.

> ✅ RESOLVED: Module 1.8 shipped (line 329) and exercises this hook end-to-end via `useFieldList`, `useUpdateField`, and `useDeleteField`. Visual smoke entry consolidated under Module 1.8.

### Module 1.8 — Dashboard UI ✅ (completed 2026-05-09)

Depends on: 1.7, 0.5 (shadcn).

1. Create `layouts/DashboardLayout.tsx` — basic chrome + sign-out button.
2. Create `components/dashboard/EmptyState.tsx` — large "Add your first plot" panel + `+` button → `/fields/new`.
3. `components/dashboard/FieldCard.tsx` — name, crop, area in ha, last update; kebab menu (Open / Rename / Delete with confirm dialog).
4. `components/dashboard/FieldList.tsx` — grid of cards.
5. Wire `routes/_auth/index.tsx` to render either `EmptyState` or `FieldList` based on `useFieldList()`.

**Done when:**
- Empty state appears for a fresh user.
- After creating a field via curl, refreshing the dashboard shows the card with the correct hectares.
- Delete from the kebab menu removes the card after confirm.

> ✅ RESOLVED: Covered by Playwright e2e smoke at `apps/web/e2e/dashboard.spec.ts` — 6 scenarios including sign-in, dashboard, placeholders, rename/delete dialog round-trip, sign-out, and secondary auth pages. Run with `pnpm --filter @viz-crop/web e2e` while `pnpm dev` is running.

> ⚠️ DEVIATION: Step 1 (`layouts/DashboardLayout.tsx`) was intentionally skipped — `apps/web/src/routes/_auth/route.tsx::AuthLayout` already provides the chrome + sign-out via `<UserButton>`. The page-level shell is inlined in the dashboard route. A separate file would be empty duplication for one consumer. Confirmed sound by both pre-implementation rubber-duck and gpt-5.5 review.

### Module 1.9 — Auth/ownership smoke tests for the API ✅ (completed 2026-05-09)

Depends on: 1.6.

1. Add an `apps/api/test/` folder with a minimal Vitest setup that boots Fastify with a test DB URL (or uses pg-mem if integration is too heavy — pick one and document; pg-mem does not speak PostGIS, so prefer a disposable Docker DB or `postgres-meta`-style isolation).
2. Tests:
   - `GET /api/health` returns 200 unauthenticated.
   - `GET /api/fields` returns 401 without bearer token (mock Clerk by short-circuiting the preHandler in tests).
   - With a fake authed user, POST returns 201, GET returns the created row, PATCH updates name, DELETE removes it.
   - A second fake user cannot read or mutate user-1 records.

**Done when:** `pnpm --filter @viz-crop/api test` passes.

> ✅ Implemented in `apps/api/test/fields.routes.test.ts` (14 new tests, plus the pre-existing geometry round-trip = 15 total). Clerk is faked via `vi.mock('@clerk/fastify', …)` — `getAuth(request)` reads an `x-test-user-id` header, `clerkPlugin` is a no-op. The dev PostGIS container is reused with synthetic `crypto.randomUUID()`-namespaced user IDs and `beforeAll`+`afterAll` cleanup (pg-mem rejected because it can't run PostGIS). `vitest.config.ts` now also picks up `test/**/*.test.ts`; `tsconfig.test.json` overrides `rootDir: "."` so the new directory compiles. Reviewed by gpt-5.5 — no issues.

> ⚠️ PENDING: `apps/api/test/` currently has no migration bootstrap — running the suite against a fresh DB will fail with "relation fields does not exist" until `pnpm --filter @viz-crop/api db:migrate` has been executed. Acceptable for v1 (every developer has the dev DB migrated); will be revisited if/when the API gets a CI runner that provisions a clean DB on every job.

### Phase 1 exit criteria ✅ (completed 2026-05-09)

- All field CRUD works end-to-end via curl and via the dashboard.
- Generated `area_hectares` matches a Turf-computed value within ~1%.
- Tests pass: `pnpm test` at root.
- No EOSDA code yet — it is fine for `cached_scenes`/`cached_ndvi_stats` to be empty.

---

## Phase 2 — Map foundation + basemap (Layers 1+2) ✅ (completed 2026-05-09)

**Goal:** `/fields/new` renders a full satellite map of Karnataka with road and place labels, no flicker, and no duplicate live MapLibre instances/canvases/listeners after React StrictMode's dev-only extra setup/cleanup cycle settles.

**Phase entry:** Phases 0-1 complete. ArcGIS API key from Pre-flight P.1.

### Module 2.1 — MapLibre installation + base styles ✅ (completed 2026-05-09)

Depends on: 0.5.

1. In `apps/web`: install MapLibre v5 (for example `maplibre-gl@^5.24.0`; do not float to v6 until `@esri/maplibre-arcgis` declares compatibility).
2. Import `maplibre-gl/dist/maplibre-gl.css` once in `src/main.tsx`.
3. Promote `VITE_ESRI_API_KEY` from "optional in early phases" to required in `src/env.ts` and update `apps/web/.env.example`; fail startup with a clear env error instead of letting ArcGIS basemap requests fail later with 499/401 responses.

**Done when:** Build still passes; CSS is bundled; missing `VITE_ESRI_API_KEY` fails with the web env validation message.

### Module 2.2 — `useMapInstance` hook (StrictMode-safe) ✅ (completed 2026-05-09)

Depends on: 2.1.

1. Create `hooks/useMapInstance.ts`:
   - Accepts a container ref + initial `center`/`zoom` options.
   - Initializes a `maplibregl.Map` with a ref guard, but cleanup must always call `map.remove()` and clear the ref. React StrictMode intentionally runs one extra setup/cleanup cycle in dev; the requirement is one live map after the final mount, not exactly one constructor call in dev.
   - Tracks map/style readiness:
      - `isReady` — flips on the first `map.on('load')` event (basic MapLibre load).
      - `isStyleReady` — flips when the **active** map style has finished loading. Initially `false`. Provide exported style-lifecycle helpers (for example `beginStyleChange(map)` and `markStyleReady(map)`) or equivalent setters that the basemap module uses to set `false` before `BasemapStyle.applyStyle(...)` and `true` only after the new style's `style.load`/`idle` completion.
      - `styleEpoch` — increments every time the active style becomes ready. Dynamic layer effects depend on this value so they can re-add sources/layers after any future basemap/style swap.
   - **`transformRequest` hook.** Configure MapLibre's `transformRequest(url, resourceType)` at construction time. For Phase 2 it should simply return `{ url }` for all URLs. Phase 6 will attach `Authorization: Bearer <clerk-jwt>` only to URLs beginning with `${env.VITE_API_BASE_URL}/api/eosda/render/`; do not call `getToken()` per tile request. Instead, Module 6.4 must keep a synchronous token ref fresh from a Clerk-aware effect/subscription.
   - Returns `{ map, isReady, isStyleReady, styleEpoch }`.
   - Cleans up via `map.remove()` on unmount and nulls the map ref.
2. Document the StrictMode rationale in the hook with a brief comment.
3. Document the rule: **all dynamic layers and drawing adapters (Field, Terra Draw, NDVI, overlays that reference style layers) must wait on `isStyleReady` + `styleEpoch`, not `isReady`.** Applying a basemap style replaces sources/layers, so anything mounted on `isReady` alone will silently disappear when the style swaps in.

**Done when:** Mounting and unmounting a host component does not leak `<canvas>` elements (verify in DOM inspector); StrictMode settles with one live map/canvas; `isStyleReady` is observably `false` until the basemap style applies and `true` afterward; `styleEpoch` increments after the ArcGIS style is ready.

### Module 2.3 — `MapView` component ✅ (completed 2026-05-09)

Depends on: 2.2.

1. Create `components/map/MapView.tsx`:
   - Accepts `children` (overlay components) and a `style` prop (CSS-only sizing, no MapLibre style here yet).
   - Owns a `<div ref={containerRef}>` and calls `useMapInstance`.
   - Provides `map`, `isReady`, `isStyleReady`, and `styleEpoch` via React context so descendant overlays can subscribe without prop-drilling.
2. Create `components/map/MapContext.ts` exposing the typed context.

**Done when:** `<MapView style={{ height: '100%' }} />` renders an empty grey MapLibre canvas inside a sized parent.

### Module 2.4 — ArcGIS basemap plugin ✅ (completed 2026-05-09)

Depends on: 2.3, Pre-flight P.1.

1. Install `@esri/maplibre-arcgis@^1.2.0` (peer requires MapLibre `>=5.11.0`; keep MapLibre pinned to v5 for now).
2. Create `lib/arcgis.ts` exporting an `applyArcgisImageryWithLabels(map, token)` helper:
   - Use the documented MapLibre ArcGIS plugin call: `maplibreArcGIS.BasemapStyle.applyStyle(map, { style: 'arcgis/imagery', token })` — `arcgis/imagery` is the `complete` style per the [Basemap Styles types reference](https://developers.arcgis.com/rest/basemap-styles/types/) (satellite imagery + place/road labels). Do **not** use `arcgis/imagery/standard` (imagery base/detail layer only, no labels) or `arcgis/imagery/labels` (labels only).
   - The Phase 2 goal is satellite **plus road/place labels**. The selected style must contain `symbol` layers; a console warning is useful for diagnosis but is not enough to satisfy the goal.
   - Resolve only after the newly applied style has emitted `style.load` and/or the next `idle`.
3. Create `components/map/BasemapLayer.tsx` — child of `MapView` that calls `beginStyleChange(map)` before `applyArcgisImageryWithLabels(...)` and `markStyleReady(map)` after the new style finishes loading. Gate on `isReady` and ensure the effect is idempotent under StrictMode.
4. Add `findFirstSymbolLayerId(map)` in `lib/map-style.ts` (or similar) by scanning `map.getStyle().layers` for the first layer with `type === 'symbol'`; never hard-code Esri layer IDs.
5. Verify Esri attribution is automatically displayed by the plugin.

**Done when:** `MapView + BasemapLayer` shows Maxar Vivid/satellite imagery with road and place labels, Esri attribution is visible, and the style contains at least one `symbol` layer.

### Module 2.5 — `CreateLayout` shell + Karnataka default ✅ (completed 2026-05-09)

Depends on: 2.4.

1. Create `layouts/CreateLayout.tsx` — 2-column responsive layout: ~70% map, ~30% form column. Form column contains a placeholder for now. Account for the authenticated layout's sticky 3.5rem header (`min-height: calc(100vh - 3.5rem)` or equivalent) so the map does not overflow the viewport.
2. Wire `routes/_auth/fields.new.tsx` to render `CreateLayout` with `<MapView center={[75.7139, 15.3173]} zoom={8}><BasemapLayer /></MapView>`.
3. Keep the map subtree independent from the form placeholder; future form state must not be passed as props into `MapView`.

**Done when:**
- `/fields/new` shows a satellite map of Karnataka with road/place labels.
- Esri attribution visible.
- StrictMode dev-mode settles with one live map/canvas/listener set.

### Phase 2 exit criteria ✅ (completed 2026-05-09)

- Map renders satellite + labels at zoom 8 over Karnataka.
- No console errors related to MapLibre or ArcGIS.
- Page survives multiple navigations between `/` and `/fields/new` without duplicate canvases/WebGL contexts/listeners.
- `VITE_ESRI_API_KEY` is documented and validated as required for the web app.

---

## Phase 3 — Drawing + Layer 3 + create form ✅ (completed 2026-05-10)

**Goal:** A signed-in user can draw a polygon on the create-map, fill out the field form, and successfully create a field that appears on the dashboard.

**Phase entry:** Phases 1 and 2 complete.

### Module 3.1 — `useUiStore` and `useFieldStore` (Zustand) ✅ (completed 2026-05-09)

Depends on: 0.5.

1. Install `zustand`.
2. Create `stores/useFieldStore.ts`:
   - State: `draftPolygon: GeoJSON.Polygon | null`, `draftAreaHectares: number | null`, `draftValid: boolean`, `draftErrors: string[]`, `currentFieldId: string | null`.
   - Actions: `setDraftPolygon`, `setDraftValidation`, `clearDraft`, `setCurrentField`.
3. Create `stores/useUiStore.ts` (used by Phase 5 onward):
   - State: `selectedViewId`, `selectedIndex`, `ndviOpacity`, `activeSidebarItem`, `bottomBarTab`.
   - Actions: corresponding setters.
4. Use selectors for all store reads; use `useShallow` when selecting multiple values so form typing and UI state changes do not re-render the map subtree.

**Done when:** A scratch component reads/writes both stores and re-renders only for selected slices.

> ⚠️ DEVIATION: `apps/web` has no test runner (only `apps/api` and `packages/shared` use vitest). Per the module guidance, no runner was added for a single module. Verification instead lives in `apps/web/src/stores/__scratch__/`: a `StoreScratch.tsx` manual harness (never mounted in any route) plus a non-React `verify.mts` runtime harness (run with `node --experimental-strip-types apps/web/src/stores/__scratch__/verify.mts`). The harness subscribes to the whole store with Zustand v5's plain `subscribe(listener)` and applies the selector + equality check manually — exactly mirroring `useSyncExternalStoreWithSelector` (used by Zustand's React hook + `useShallow`). It asserts unrelated-slice updates do not "render", and that `setDraftGeometry` produces a single render across polygon + validation. 20/20 checks pass.

> ⚠️ DEVIATION: Added a fifth action `setDraftGeometry({ polygon, areaHectares, valid, errors })` on top of the spec's four (`setDraftPolygon`, `setDraftValidation`, `clearDraft`, `setCurrentField`). It atomically writes the polygon and the three validation slices in a single `set()` call so Module 3.2's `useFieldDrawing` only triggers one re-render per Terra Draw `change`/`finish` event instead of two — the gpt-5.5 review of Module 3.1 flagged the two-call pattern as a re-render hazard for consumers selecting `{ draftPolygon, draftValid, draftAreaHectares }` together. The two original setters are retained for the (rarer) cases where polygon and validation arrive separately and for the `setDraftPolygon(null)` "reset" ergonomics from the toolbar's clear button.

### Module 3.2 — Terra-draw integration ✅ (completed 2026-05-09)

Depends on: 2.4, 3.1.

1. Install `terra-draw` and `terra-draw-maplibre-gl-adapter`.
2. Create `hooks/useFieldDrawing.ts`:
   - Subscribes to the map context and constructs Terra Draw only when `isStyleReady` is true. The Terra Draw MapLibre adapter touches style layers, so it must not initialize on `isReady` alone.
   - Constructs a `TerraDraw` instance with `new TerraDrawMapLibreGLAdapter({ map })` and a single `TerraDrawPolygonMode`.
   - Configure polygon-mode client validation for self-intersections using Terra Draw's built-in `ValidateNotSelfIntersecting` (or an equivalent shared segment-intersection guard). Run it on `finish`/`commit` updates so bowties never become accepted drafts.
   - Listen to Terra Draw `change`/provisional updates for live area/errors and `finish` for completed drafts. Use `getSnapshotFeature(id)` / `getSnapshot()` to read the completed Polygon feature.
   - Keep one draft polygon per field: when a new polygon is accepted, clear any previous Terra Draw feature and replace `useFieldStore.draftPolygon`.
   - Run `polygonGeoJsonSchema.safeParse(...)` after finish to populate `draftValid`/`draftErrors` (area and India-bbox issues should remain visible inline instead of silently discarding the shape). Only structural/self-intersection failures should be rejected with a toast and discarded.
   - Exposes `start()`, `stop()`, `clear()`; cleanup must unsubscribe Terra Draw events and call `draw.stop()`/`draw.clear()` as appropriate.
3. Create `components/map/DrawControl.tsx` — a small toolbar (top-right of map) with a "Draw" button that toggles draw mode and a "Clear" button.

**Done when:** Drawing a polygon on the map writes a GeoJSON Polygon plus validation state into `useFieldStore`; self-intersecting polygons show a toast and are discarded; too-small/too-large/outside-India polygons remain visible but are marked invalid with inline errors.

> ⚠️ DEVIATION: `ValidateNotSelfIntersecting` is invoked **manually inside the `finish` handler** instead of being passed to the polygon mode's `validation` config. Terra Draw's mode-level validation rejects the store write when invalid, which suppresses the `finish` event entirely — the user would see the polygon vanish with no toast and no signal that they need to redraw. Calling the validator ourselves on `finish` keeps the same "bowties never become accepted drafts" guarantee while preserving the toast-and-clear UX the spec requires. See `useFieldDrawing.ts` JSDoc, the `## Why we run ValidateNotSelfIntersecting manually` section.

> ⚠️ DEVIATION: Live `change` updates write only `draftAreaHectares` (via `setDraftValidation`), **not** the partial polygon to `draftPolygon`. Module 3.3's `<FieldLayer />` reads `draftPolygon` and would otherwise paint a half-formed shape on top of Terra Draw's own provisional render. The full polygon is written on `finish` via `setDraftGeometry`. This satisfies the "live area/errors" requirement while keeping the visual stack unambiguous.

> ✅ RESOLVED in Module 3.4: The "live errors during `change`" half of the spec was deferred to Module 3.4 — Geometry feedback, which now writes `draftValid` and `draftErrors[]` from the `change` handler so India-bbox / size hints surface live.

### Module 3.3 — `FieldLayer` (Layer 3) ✅ (completed 2026-05-10)

Depends on: 2.3, 2.4 (`isStyleReady`), 3.1.

1. Create `components/map/FieldLayer.tsx`:
   - **Waits for `isStyleReady` from `useMapInstance` before touching the style** (do not mount on `isReady` alone — the basemap style swap will erase any sources/layers added too early).
   - Reads `draftPolygon` from `useFieldStore` via a selector (or, on the analysis screen, the persisted polygon from `useField(id)`).
   - Adds a MapLibre `geojson` source named `field` once, then updates it with `GeoJSONSource#setData(...)` when the polygon changes.
   - Adds a `fill` layer (`fill-color: #ffffff`, `fill-opacity: 0.15`) and a `line` layer (`line-color: #ffffff`, `line-width: 2`).
   - Removes layers before removing the source on unmount.
   - Re-adds/re-orders itself when `styleEpoch` changes because a MapLibre style replacement removes custom sources/layers.
2. **Layer ordering:** Append the field `fill` and `line` layers **on top of the basemap symbol/label layers**, not below them. Per [`plan.md` Field Analysis Screen Anatomy](./plan.md#2-field-analysis-screen-anatomy), the required stack is `satellite → NDVI → labels → field fill → field outline`. Use `map.moveLayer('field-fill')` / `map.moveLayer('field-outline')` without a `beforeId` to keep them at the top after style/layer changes. Phase 6 can use `findFirstSymbolLayerId(map)` to insert NDVI below labels; do not hard-code Esri layer IDs.

**Done when:** A drawn polygon shows a translucent fill with a white outline, and clearing the draft removes the layer cleanly.

> ⚠️ DEVIATION: `<FieldLayer />` exposes a single **optional `polygon?: GeoJSON.Polygon | null` prop** instead of two sibling components (`<DraftFieldLayer />` + `<PersistedFieldLayer />`). When the prop is omitted, the component subscribes to `useFieldStore.draftPolygon` (create-field flow). When the prop is provided — including `polygon={null}` — it uses the prop verbatim and ignores the store (analysis screen passing `useField(id).data.geometry`, with `null` while the query is pending). Splitting into two siblings would duplicate the entire MapLibre source/layer/`moveLayer`/style-epoch lifecycle for no payoff; one component with a `undefined` vs `null` distinction keeps the visual contract identical for both consumers and prevents the analysis screen from accidentally leaking draft state. See `FieldLayer.tsx` JSDoc, the `## Why optional polygon prop` section.

### Module 3.4 — Geometry feedback (live area + validation hints) ✅ (completed 2026-05-10)

Depends on: 3.2, 3.3.

1. In `lib/geometry.ts`, expose `polygonAreaHectares(geom)` using `@turf/area` (or a shared `@viz-crop/shared` export if added); avoid importing all of `@turf/turf` for one calculation.
2. In `useFieldDrawing`, update `useFieldStore` with derived `draftAreaHectares`, `draftValid`, and `draftErrors[]` from Terra Draw change/finish events so the form can render live readouts without instantiating another drawing hook.

**Done when:** As the user draws, a small chip near the form shows the current area in hectares.

### Module 3.5 — `CreateFieldForm` ✅ (completed 2026-05-10)

Depends on: 1.4 (shared schemas), 3.1, 0.5 (shadcn `Form`).

1. `react-hook-form` and `@hookform/resolvers/zod` are already dependencies in `apps/web`; if they are ever removed, reinstall them here.
2. Create `components/forms/CreateFieldForm.tsx`:
   - Uses `useForm` with `zodResolver(createFieldDto.omit({ geometry: true }))`, explicit `defaultValues`, and `mode: 'onChange'` so `formState.isValid` updates before submit. Keep this form in a separate subtree from `MapView` to avoid map re-renders on every keystroke.
   - Fields: name, cropType (Select with the 10 crops), season (4-option segmented control built from shadcn `Tabs` or radio group), farmerName, village, district, state.
   - Reads `draftPolygon`, `draftValid`, `draftErrors`, and `draftAreaHectares` from `useFieldStore` via selectors.
   - "Create Field" button disabled until `formState.isValid`, `draftPolygon != null`, `draftValid`, and `!mutation.isPending`.
3. On submit, assembles `{ ...form, geometry: draftPolygon }`, validates it with `createFieldDto.safeParse(...)` for a final client-side guard, then calls `useCreateField().mutateAsync(...)`.
4. On success, navigates with `await navigate({ to: '/fields/$id', params: { id } })`, then clears the draft via `clearDraft()` to avoid a brief empty-map flash while still on `/fields/new`.
5. Renders inline geometry errors from `draftErrors` and inline server validation errors from `ApiError.body`.

**Done when:**
- Submitting a complete form with a valid polygon creates a row visible on `/`.
- Invalid form or missing polygon keeps the button disabled.
- Server-side validation errors are displayed.

> ⚠️ DEVIATION: The form's `zodResolver` is given a slightly wider local `formSchema` (optional metadata fields are `z.string().max(120).optional()`) instead of `createFieldDto.omit({ geometry: true })` literally. Reason: `createFieldDto` declares `farmerName`/`village`/`district`/`state` as `metadataString.optional()`, which permits `undefined` but **rejects `''`**. With `mode: 'onChange'` and `defaultValues: { farmerName: '' }`, the canonical resolver would mark the form invalid the moment the user focused and blurred (or erased a typo from) any optional field, leaving the submit button stuck disabled. The wider local schema lets `''` pass live validation; on submit, empty optional metadata is normalized to `undefined`, the assembled payload is re-validated against the canonical `createFieldDto.safeParse(...)` for a final contract guard, and only then is `useCreateField().mutateAsync(...)` called. Net effect: identical wire contract, better keystroke-time UX. Documented at the top of `apps/web/src/components/forms/CreateFieldForm.tsx`.

### Module 3.6 — Wire `CreateLayout` form column ✅ (completed 2026-05-10)

Depends on: 2.5, 3.5.

1. Replace the placeholder in `CreateLayout` with `<CreateFieldForm />`.
2. Mount `<DrawControl />` and `<FieldLayer />` as `MapView` children.
3. Keep form state local to `<CreateFieldForm />` and draft geometry in Zustand; do not pass changing form values into the map column.

**Done when:** The full create flow is usable end-to-end on `/fields/new`.

### Phase 3 exit criteria ✅ (completed 2026-05-10)

- A signed-in user draws a polygon, fills the form, and lands on `/fields/:id` (which can still be a placeholder).
- The dashboard reflects the new field with the correct area.
- Self-intersecting polygons are rejected client-side before submit.
- Invalid polygons (too small/large/outside India) are shown inline and blocked on the client, and are still rejected by the server if submitted through any bypass.

---

## Phase 4 — EOSDA warm-up service ✅ (completed 2026-05-10)

**Goal:** Whenever a field is created, the API kicks off a non-blocking warm-up that (a) creates and persists an EOSDA Render `cropper_ref` for the polygon via the documented `POST /api/render/cropper/` endpoint and (b) discovers the latest available Sentinel-2 scene metadata via Search and upserts that scene into `cached_scenes`. The two requests run independently. The POST response is fast: warm-up is fire-and-forget. Do **not** prefetch six months of imagery, statistics, or tiles during field creation; the timeline is expanded later through the cache-first scenes route.

> Design note: EOSDA Search is the source of available Sentinel-2 dates. Search still requires a date range, so "latest available" means querying a configurable recent window with `sort: { date: 'desc' }` and a small `limit`, then expanding the window only if no scene is found.

**Phase entry:** Phase 1 complete. Pre-flight P.2 (EOSDA key activated).

### Module 4.1 — EOSDA HTTP client ✅ (completed 2026-05-10)

Depends on: 0.4, 0.8.

1. Create `apps/api/src/services/eosda-client.ts`:
   - `eosda.request(path, init)` — wraps `fetch` against `https://api-connect.eos.com`, injects `EOSDA_API_KEY` via the `x-api-key` header, and only supports an `api_key` query fallback behind an explicit live-tested option for endpoints that reject header auth.
   - Maps non-2xx responses to typed errors (`EosdaError` with `status`, `body`).
   - Logs only the path + status, **never** the full URL when it carries credentials.
2. Make `EOSDA_API_KEY` a required env var (now that this phase is active).

**Done when:** Unit tests prove request construction/error mapping, and an optional `RUN_EOSDA_LIVE=1` smoke can hit Search with a tiny `limit` against a known polygon without leaking the API key in logs.

> ✅ RESOLVED: Unit coverage is complete (22 tests after Phase 4 review hardening, covering request construction, error mapping, query-auth fallback, percent-encoded `api_key` smuggling, control-character paths, and logging-leak canaries). The optional `RUN_EOSDA_LIVE=1` smoke remains useful for first-env-with-creds validation but is no longer a Phase 4 blocker — see Pending Items row 4.3.

### Module 4.2 — Cropper-ref creation/reuse ✅ (completed 2026-05-10)

Depends on: 4.1, 1.2.

1. Add `services/eosda-cropper.ts` with `getOrCreateCropperRef(field)`:
   - If `field.eosda_cropper_ref` is set, return it.
   - Otherwise POST the field polygon wrapped as a GeoJSON `Feature` to `POST /api/render/cropper/` (full spec: [`docs/review-findings.md` §3.5.3](./review-findings.md#353-cropper-api--full-spec)). Capture the 32-character hex `cropper_ref` from the response and `UPDATE fields SET eosda_cropper_ref = $1 WHERE id = $2`.
   - On non-2xx response or network failure, log a structured error (`{ fieldId, status, body }`) and return `null` so warm-up continues with scene discovery. Do not block field creation or scene caching on clipping.

> Schema note: `eosda_cropper_ref` is permanently `TEXT`. The Cropper response is a 32-character hex string; do not migrate to `INTEGER`/`BIGINT` and do not store EOSDA Field Management `field_id` here — that is a different identifier for a different system.

**Done when:** Calling `getOrCreateCropperRef(field)` from a one-off scratch script for an existing field row populates `eosda_cropper_ref` with a 32-char hex hash, and a second call returns the same value without a new EOSDA POST. A unit test with a mocked `fetch` covers the failure path (returns `null`, logs error, leaves column NULL). End-to-end "create field → cropper appears" verification waits until Module 4.6.

> ✅ RESOLVED: Module 4.6 wired `warmField` into `POST /api/fields`, so normal field creation now exercises this exact path end-to-end (cropper-ref persists on first create, second create reuses it). The scratch script is no longer needed; the integration test suite (10 unit + warm-up integration tests) pins the contract.

### Module 4.3 — Search wrapper ✅ (completed 2026-05-10)

Depends on: 4.1.

1. Add `services/eosda-search.ts` with `searchScenes({ geometry, from, to })`:
   - POSTs to `/api/lms/search/v2/sentinel2` with `intersection_validation: true`, `fields: ['date', 'sceneID', 'view_id', 'cloudCoverage', 'dataCoveragePercentage', 'tms']`, `limit`, `page`, `search.shape: <GeoJSON>`, `search.shapeRelation: 'CONTAINS'`, `search.cloudCoverage: { from: 0, to: 80 }`, date range, and `sort: { date: 'desc' }`.
   - Supports a `limit` option so callers can request only the latest scene during create warm-up (`limit: 1`) or a broader page for the analysis timeline.
   - Normalizes EOSDA's mixed response names: `sceneID → sceneId`, `view_id → viewId`, `date → sceneDate`, `cloudCoverage → cloudPercent`, `dataCoveragePercentage → dataCoveragePercent`, and `tms → tmsTemplate`.
   - Treats `tmsTemplate` as stored metadata only. The Search docs may return `render.eosda.com` templates; app tiles must still go through our authenticated Render proxy built from `viewId`.

**Done when:** A unit test mocks `fetch` and asserts the mapping.

> ✅ RESOLVED: Unit coverage (now 19 tests after the Phase 4 review made `searchScenes` lenient on missing/null `results` — coercing to `[]` so genuine no-coverage no longer throws — while still rejecting present-but-non-array shapes). Live-test of the empty-results shape remains useful for first-env-with-creds confirmation; see Pending Items row 4.3 for the de-risked entry.

### Module 4.4 — Scene cache service ✅ (completed 2026-05-10)

Depends on: 4.3, 1.2.

1. Add `services/scene-cache.ts`:
   - `upsertScenes(fieldId, scenes)` — `INSERT ... ON CONFLICT (field_id, view_id) DO UPDATE` for the columns that may change (scene id, cloud, data coverage, tms template, last-seen timestamp).
   - `listScenes(fieldId, dateRange?)` — read from `cached_scenes`, ordered by date desc.
   - `getMostRecentScene(fieldId)` — reads the newest cached scene for default selection and smoke checks.
2. If needed, add a small migration extending `cached_scenes` with `scene_id` and `last_seen_at`/`updated_at`. The initial Phase 1 schema already has the core `(field_id, view_id)` uniqueness; this timestamp is only for deciding when we last checked EOSDA if the latest scene has not changed.

**Done when:** Inserts and re-inserts of the same `view_id` are idempotent.

### Module 4.5 — `field-warmup` orchestrator ✅ (completed 2026-05-10)

Depends on: 4.2, 4.3, 4.4.

1. Create `services/field-warmup.ts` exporting `warmField(fieldId)`:
   - Loads the field (by id) — log and return if missing.
   - Runs `getOrCreateCropperRef(field)` and `searchLatestScene({ geometry: field.geometry })` **in parallel** via `Promise.allSettled` (latest-first Search over a configurable recent window, e.g. 90 days, with fallback expansion to 180/365 days if EOSDA returns no scenes).
   - On Search success, `upsertScenes(field.id, latestScene ? [latestScene] : [])`. Cropper persistence happens inside `getOrCreateCropperRef`; nothing else to do here for that branch.
   - Let unexpected errors reject. Module 4.6 owns the single `.catch(...)` that logs `{ fieldId }`, avoiding double-handling where the outer catch never fires.

**Done when:** Calling `warmField(id)` from a scratch script populates the newest available row in `cached_scenes` when EOSDA has data for the polygon, and populates `eosda_cropper_ref` from a successful Cropper POST. If either upstream call fails, the failure is logged with `fieldId` and warm-up exits cleanly without throwing.

### Module 4.6 — Wire `warmField` into `POST /api/fields` ✅ (completed 2026-05-10)

Depends on: 1.6, 4.5.

1. After the insert in `POST /api/fields`, call `void warmField(id).catch((err) => req.log.error({ err, fieldId: id }, 'warm failed'))` — **do not** await.
2. Verify the POST still returns within ~100 ms in the local dev environment.

**Done when:** Creating a field returns immediately; logs show warm-up running asynchronously and completing later.

### Phase 4 exit criteria

- `cached_scenes` has the newest available Sentinel-2 scene metadata within ~30 s of field creation when EOSDA has data for the polygon.
- `eosda_cropper_ref` is populated from a successful Cropper API POST. If the POST fails, the column stays NULL and a structured log line records `{ fieldId, status, body }`; later Render tiles fall back to scene-wide imagery under the field outline.
- If EOSDA returns an error, the POST still succeeds and a structured log line records the failure.
- `EOSDA_API_KEY` never appears in client-visible network requests.
- No imagery tiles or `mt_stats` tasks are fetched during field creation.

> 🔒 Phase 4 review hardening (2026-05-10) — three fixes applied after Claude/GPT-5.5 dual review:
> 1. **`assertSafePath` (eosda-client.ts)** — added control-character rejection (`\x00–\x1f`, `\x7f`) and a post-`URL`-parse `searchParams.has('api_key')` check that catches percent-encoded smuggling like `%61pi_key=` or `api%5fkey=` that the literal regex never sees.
> 2. **`searchScenes` (eosda-search.ts)** — coerce missing/null `results` to `[]` so genuine no-coverage from EOSDA cleanly enters Module 4.5's fallback widening; still throws on present-but-non-array shapes to defend against silent garbage coercion.
> 3. **`warmField` upsert catch (field-warmup.ts)** — recognise SQLSTATE `23503` (foreign_key_violation) on `upsertScenes` as a benign delete-after-create race (user deleted the field while warm-up was in flight); log at `info` instead of letting Module 4.6's outer `.catch(...)` log it as `'warm failed'`. The check walks Drizzle's `DrizzleQueryError.cause` chain because Drizzle 0.45 wraps every pg error.
>
> Test coverage delta: 98 → 102 tests (added encoded-api_key, control-char, search empty-results coercion, FK-23503 race, and non-23503 propagation). All pass; `pnpm check` and `pnpm run ci` green.

> 🔧 Phase 4 cropper-persistence reliability fix (2026-05-12) — three changes after live debugging found ALL 9 dev-DB rows had `eosda_cropper_ref = NULL` despite Module 4.6 being marked complete:
> 1. **`field-warmup.ts`** — replaced fire-and-forget `void getOrCreateCropperRef(...)` with an awaited `Promise.all` that bounds cropper at `cropperTimeoutMs` (default 30 s, exported as `DEFAULT_CROPPER_TIMEOUT_MS`). Root cause: the detached promise was being killed by `tsx watch` dev-server restarts within ~1 s of field creation, before the DB UPDATE could land. Awaiting holds the warm-up function alive until the UPDATE commits; the timeout is a safety valve so a wedged EOSDA endpoint can't stall warm-up forever (warns and continues).
> 2. **`eosda-cropper.ts`** — added INFO log `'cropper persisted'` on successful UPDATE so future regressions are visible in logs without DB inspection.
> 3. **`routes/eosda.render.ts`** — added lazy self-heal: when a tile request finds `cropper_ref` NULL, kick `getOrCreateCropperRef(...)` in the background (with an in-process Set guard to dedupe concurrent kicks) so the next tile request will be properly clipped. Current tile is served scene-wide as graceful fallback. Defense-in-depth against any future warm-up regression.
>
> Dev-DB recovery: pre-existing rows were truncated rather than backfilled (project is pre-production, no migration needed). Verified end-to-end via direct upstream probe: cropper POST returns `7b8df71295f951cf3526bcd2fb92a366` for the test polygon, render with that hash returns 90.6% transparent at z=16 (clipped to polygon).

> 🔧 NDVI tile-clipping & request-flood fix (2026-05-12) — three changes after a user report that "the index is not getting applied to the selected polygon" (NDVI bleeding past the field) and "we're getting too many requests rate limit when I zoom out". Direct EOSDA probe with the persisted `cropper_ref` returned a 334-byte 100% transparent PNG for tiles outside the polygon — proving the upstream cropper mechanism worked. The bug was on the proxy + client side:
> 1. **`routes/eosda.render.ts`** — split `Cache-Control` by branch. Cropper-bound tiles still get `private, max-age=86400` (stable). The un-clipped fallback (no `cropper_ref` yet) now gets `private, no-store` so a tile fetched during the warm-up race can't poison-cache the browser for 24 h. Root cause of issue #1: the user's browser had cached an un-clipped fallback PNG from before warm-up await landed; the long max-age held that response in cache for 24 h even after the DB had the hash.
> 2. **`components/map/NdviLayer.tsx`** — added `bounds` and `cropperRef` props; passed `bounds` to `map.addSource(...)` per [MapLibre `raster.bounds` spec](https://maplibre.org/maplibre-style-spec/sources/#raster) so MapLibre never requests tiles outside the field bbox; appended `&v=<cropperRef|pending>` to the tile URL as a cache-buster so the URL changes the moment warm-up flips the column from `NULL` → hash, evicting any stale fallback tiles without a hard refresh. The proxy strips `v` via zod (it never reaches EOSDA upstream).
> 3. **`layouts/AnalysisLayout.tsx`** — passes the existing `bounds` (already computed from `bbox(field.geometry)`) and `field.eosdaCropperRef` to `<NdviLayer>`.
>
> Test coverage delta: 154 → 155 tests (added `'private, no-store'` Cache-Control assertion for the un-clipped fallback path). Live Chrome MCP validation: tile-request count dropped from 38 (with 18× HTTP 429 + 5 ERR_ABORTED) to 2 on initial load; aggressive zoom-out (4 successive `Zoom out` clicks) issued 0 additional tile requests; visual screenshot confirms NDVI is contained inside the triangle while surroundings show raw imagery.

---

## Phase 5 — Analysis layout shells + map overlays ✅ (completed 2026-05-12)

**Goal:** `/fields/:id` shows the full-bleed analysis layout matching the reference screenshots: top bar, collapsible right sidebar, collapsible bottom bar, and all map overlay controls — even if most are visual stubs.

**Phase entry:** Phases 1, 2, 3 complete. Phase 4 is **not** required for layout work.

### Module 5.1 — `AnalysisLayout` shell ✅ (completed 2026-05-10)

Depends on: 2.3.

1. Create `layouts/AnalysisLayout.tsx`:
   - Full-bleed `<MapView>` with `<BasemapLayer />` and `<FieldLayer />`.
   - Slots for `<TopBar />`, `<RightSidebar />`, `<BottomBar />` rendered as siblings (absolute positioning).
2. Wire `routes/_auth/fields.$id.tsx` to load the field via `useField(id)` and render `AnalysisLayout`.
3. While loading, show a subtle skeleton; on 404, redirect to `/`.

**Done when:** Visiting `/fields/:id` for an existing field shows the polygon centred and outlined on the satellite basemap.

### Module 5.2 — `TopBar` ✅ (completed 2026-05-10)

Depends on: 5.1.

1. Create `components/shell/TopBar.tsx`: back arrow → `/`, field icon, field name, area in ha, crop type, "Get Overview" CTA (no-op for v2), "All fields ▾" placeholder dropdown.

**Done when:** Visual match to reference screenshot's top bar.

### Module 5.3 — `RightSidebar` (collapsible) ✅ (completed 2026-05-10)

Depends on: 5.1, 0.5 (shadcn `Sheet`/`Tabs`/`Tooltip`).

1. Create `components/shell/sidebar-items.ts` with the array of items from [`plan.md` Field Analysis Screen Anatomy](./plan.md#2-field-analysis-screen-anatomy).
2. Create `components/shell/RightSidebar.tsx`:
   - Collapsed (~64 px) icon rail with tooltips.
   - Expanded (~300 px) shows the active item's pane.
   - Active item state in `useUiStore`.
   - Only the **Sample** pane renders a real container (filled in Phase 7); everything else renders a "Coming soon" placeholder.

**Done when:** Click an icon → expands, shows pane title, second click collapses.

### Module 5.4 — `BottomBar` ✅ (completed 2026-05-10)

Depends on: 5.1, 0.5 (shadcn `Tabs`).

1. Create `components/shell/BottomBar.tsx`:
   - Collapsible (~280 px when open).
   - Tabs: **Crop info** (renders crop rotation card with current season + crop, plus growth-stages / risks / sown-area placeholders), **Chart** (placeholder until Phase 7), **Activities** (empty list + disabled "Add" button).

**Done when:** Crop info tab shows real metadata for the current field; the other two render placeholders without errors.

### Module 5.5 — Map overlays (visual only) ✅ (completed 2026-05-10)

Depends on: 5.1.

1. Build small components in `components/map/overlays/`, each taking `MapContext` for live data:
   - `CoordsBadge` — top-left, live cursor lon/lat.
   - `ScaleBar` — top-right, MapLibre's built-in scale control wrapper.
   - `ZoomControls` — left, MapLibre nav control.
   - `DateTimeline` — bottom (above BottomBar), renders a flat strip; **purely visual stub** until Phase 6 wires data.
   - `CloudHiddenToast` — bottom-left static info.
   - `SourceSwitcher` — bottom-right, defaults to "Sentinel-2 ▾", disabled secondary options.
   - `IndexSwitcher` — bottom-right, NDVI/EVI/NDWI; writes to `useUiStore.selectedIndex` (no-op visual until Phase 6).
   - `OpacitySlider`, `DownloadButton`, `FullscreenButton`, sidebar-collapse toggle — wired to `useUiStore` where applicable; download is stubbed.
2. Mount all overlays inside `AnalysisLayout`'s `<MapView>` children.

**Done when:** Visual regression vs reference screenshot lands the overlays in the correct positions; all stubs render without console errors.

### Module 5.6 — UI/UX redesign: edge-anchored chrome ✅ (completed 2026-05-11)

Depends on: 5.1 – 5.5. Driver: `docs/ui-ux-redesign.md`.

The first-cut analysis screen used a centered "dodge" pattern (timeline + cluster + toast all repositioned with `lg:translate-x-*` when the sidebar pane opened). Module 5.6 replaces that with **edge-anchored chrome**: every chip lives in a corner or along an edge and never repositions, while persistent overlays escalate to shadcn `Sheet`s on `<md` so they stop fighting `LayerControlCluster` / `DateTimeline` for space on phones.

1. Centralized visual tokens in `lib/tokens.ts` (`CHIP_BASE`, `CHIP_FOCUS`); reused across every chip + overlay. Added SSR-safe `hooks/useMediaQuery.ts` and a `components/ui/popover.tsx` primitive (wraps `radix-ui` Popover).
2. **TopBar** trimmed to back-arrow · pin · name · area (10 × clamp width). "Get overview" CTA and "All fields ▾" hoisted out into standalone right-aligned chips `GetOverviewButton` + `FieldSwitcherChip` rendered by `AnalysisLayout`.
3. **RightSidebar** unchanged on `md+` (rail 64 → pane 364 inline). On `<md` only the rail stays inline; the pane escalates to `<Sheet side="right">`. `PaneBody` extracted with `inSheet` prop so chip chrome is suppressed inside the sheet.
4. **BottomBar** rebuilt as a bottom-left tray: collapsed 280 × 36 pill (tab triggers + chevron); expanded 360 × 320 panel on `md+` with `grid-cols-1 md:grid-cols-2` cards. On `<md` the expanded body opens as `<Sheet side="bottom">`.
5. **LayerControlCluster** (new) consolidates `SourceChip` · `IndexDropdown` (replaces `IndexSwitcher`) · `OpacityPopover` (replaces always-visible `OpacitySlider`) · palette stub · download · collapse chevron into one bottom-right chip. On `<md` collapses to a `LayersIcon` puck opening a popover with the same controls. **Deleted:** `AnalysisToolbar.tsx`, `SourceSwitcher.tsx`, `IndexSwitcher.tsx`, `OpacitySlider.tsx`.
6. **DateTimeline** rebuilt: horizontal scrollable row of 36 × 36 date chips with `ChevronLeft/Right` scroll arrows, "Next: …" hint pill, anchored `bottom-20` always (no longer repositions when the tray expands). `role="toolbar"` + `aria-orientation="horizontal"` so it announces correctly.
7. **CloudHiddenToast** moved to `bottom-16 left-3`, shifts up to `bottom-[22rem]` when the tray expands; auto-dismisses after 8 s.
8. **ScaleBar** repinned to `top-3 right-3` and hidden below `lg` (read-out matters on desktop, not phones).
9. **AnalysisLayout** now positions chrome via `<div className="pointer-events-none absolute inset-0">` with edge-anchored child slots (`top-3 left-3`, `top-3 right-20`, `top-3 right-3 bottom-3`, `bottom-3 left-3`). `FitToFieldBounds` padding updated to `{ top: 64, right: 88, bottom: 96, left: 88 }`. Added a one-shot `hasInitialisedRef`-gated effect that closes any open sidebar pane on first mount when the viewport is `<lg` (responsive default; doesn't override later user toggles).
10. Audits: `motion-safe:transition-transform` purged repo-wide; no leaks of `activeSidebarItem` truthiness outside `RightSidebar` + the layout init effect; `pnpm biome check apps/web/src` and `pnpm --filter @viz-crop/web typecheck` both clean.

**Done when:** every chip uses `CHIP_BASE`/`CHIP_FOCUS`; the centered overlays no longer reposition when the sidebar pane opens; `<md` renders without overlay collisions because persistent overlays escalate to `Sheet`s; typecheck + biome are clean.

### Module 5.7 — Edge-anchored chrome v2 ✅ (completed 2026-05-11)

Depends on: 5.6.

Field-test feedback after 5.6 led to four shifts: (1) the `_auth` header is gated off on `/fields/$id` so the map owns the full viewport (`useMatches()` against the literal route id `/_auth/fields/$id`); (2) the bottom-left `BottomBar` tray became a full-width `BottomDock` that opens upward with `Crop / Chart / Activities`, capped at `40vh` and laid out as `grid-cols-1 md:2 lg:4`; (3) `DateTimeline` (chips now `flex-1 min-w-12 max-w-20` to fill the row evenly) and `LayerControlCluster` moved into a new `BottomRow` that floats above the dock and shifts up with it; (4) `RightSidebar` rail + pane unified into a single growing chip — the outer container owns `CHIP_BASE`, the rail and pane both shed their own chip chrome, and a `border-r border-white/10` hairline plus a 150 ms cross-fade body replace the slide-in. `ZoomControls`, `FullscreenButton`, and `CloudHiddenToast` re-anchored to the left edge with `bottom` driven by `bottomBarTab`. Adversarial review (gpt-5.3-codex / gpt-5.5 / claude-opus-4.6) caught four cascading bugs that were fixed before commit: (a) `useUiStore.bottomBarTab` defaulted to `'cropInfo'` so the dock auto-opened on mount — now `null` (collapsed by default per spec V5); (b) `BottomDock`'s `min-h-[260px]` could exceed `40vh` on short viewports, breaking every dependent offset — removed; (c) `BottomRow` expanded `bottom-[calc(40vh+0.75rem)]` (literal spec value) placed it 32 px INSIDE the dock body since the dock height is `40vh + h-11`, not `40vh` — corrected to `bottom-[calc(40vh+3.5rem)]`; (d) the entire left-edge stack's expanded values were systematically off by 2 rem (failed to absorb the row's correction) — `ZoomControls`, `FullscreenButton`, `CloudHiddenToast` expanded values bumped from `+5/+12/+16rem` to `+7/+14/+18rem` so each maintains its collapsed gap above the next chip. Spec deviations remain documented: `FullscreenButton` collapsed `bottom-[14rem]` and `CloudHiddenToast` collapsed `bottom-[18rem]` instead of the spec's `bottom-[calc(7rem+52px)]` / `bottom-[7rem]` (those values overlapped the ~88 px `ZoomControls` column). The `RightSidebar` wrapper in `AnalysisLayout.tsx` was bumped from `bottom-3` to `bottom-14` so the last rail item stays clickable above the collapsed dock. `BottomBar.tsx` deleted; no remaining imports. See [`docs/ui-ux-redesign-v2.md`](./ui-ux-redesign-v2.md) for the full plan.

**Done when:** `/fields/$id` renders without the `_auth` header; `BottomDock` exists as a full-width dock with `Crop / Chart / Activities`; `BottomRow` hosts `DateTimeline` (no trailing dead space) + `LayerControlCluster`; left chrome shifts up with the dock and is never covered; `RightSidebar` opens as a single chip with hairline divider; `BottomBar.tsx` is deleted; `pnpm --filter @viz-crop/web typecheck` and `pnpm biome check apps/web/src` are clean.

### Module 5.8 — Drag-resizable dock + integrated timeline ✅ (completed 2026-05-12)

Depends on: 5.7.

Field-test feedback after 5.7: (a) "the timeline view is moving up very high" — when the dock expanded the floating `BottomRow` jumped upward by `40vh` because it was anchored to the viewport bottom and offset by `bottomBarTab !== null`, so the timeline travelled with the dock body instead of staying pinned to the dock floor; (b) "to toggle the bottom panel, the only option we have is to click the arrow in the bottom right" — the chevron was the sole toggle affordance and there was no resize handle. Two-pronged fix:

1. **Lifted `DateTimeline + LayerControlCluster` INTO `BottomDock`.** They now render as a fixed `h-12` strip directly above the tab bar and below the (conditional) body, so the timeline is glued to the dock's tabs row regardless of expand state. `BottomRow.tsx` deleted; `MapOverlays.tsx` no longer imports the moved components (verified — single import path is now `BottomDock`).

2. **Added a visible drag-handle pill at the dock's top edge.** Renders as a `<button type="button">` with a slim 4px visual pill inside a 24px-tall hit area (touch-friendly per WCAG target sizing). Behaviours: click → toggle expand/collapse; drag up → expand and grow the body; drag below `BOTTOM_DOCK_MIN_VH` → auto-collapse; double-click → reset to default. Keyboard: `Enter`/`Space` toggle, `ArrowUp`/`ArrowDown` resize ±5vh, `Escape` (on dock root) collapses. The button has `aria-label`, `aria-expanded`, and `aria-controls` (conditionally set only when the body is mounted, so screen readers don't reference a nonexistent element). `touch-action: none` on the grabber disables the browser's native vertical-pan gesture so finger drags actually reach our pointer handler.

3. **Replaced the cascading `bottomBarTab` selector + `bottom-[calc(40vh+Nrem)]` ternaries with a single CSS variable.** `BottomDock` publishes its current outer height to `--bottom-dock-h` on `:root` via `useLayoutEffect` (synchronous so floating chrome paints in lockstep, not a frame behind). Floating consumers (`ZoomControls`, `FullscreenButton`, `CloudHiddenToast`, and the `RightSidebar` wrapper in `AnalysisLayout.tsx`) each use `style={{ bottom: 'calc(var(--bottom-dock-h, 7.5rem) + Nrem)' }}` and tag themselves with the `dock-bottom-anchored` utility class. A global rule in `globals.css` (`:root[data-bottom-dock-dragging='true'] .dock-bottom-anchored { transition-property: none !important }`) suppresses their `bottom` transitions for the duration of a drag — chevron-driven toggles still animate, but continuous resize is jank-free.

4. **Store changes.** Added `bottomDockHeightVh: number` (default 40) and `setBottomDockHeightVh` to `useUiStore`, plus exported constants `BOTTOM_DOCK_MIN_VH = 15`, `BOTTOM_DOCK_MAX_VH = 70`, `BOTTOM_DOCK_DEFAULT_VH = 40`. The store stays dumb (no clamping) so unit tests can exercise edge values; the drag handler in `BottomDock` enforces the range. Height is per-session (no Zustand persist middleware) — acceptable for v1.

Adversarial review (rubber-duck) caught five issues that were addressed before commit:

- (a) **Floating chrome lagged the dock during drag** — fixed by switching the CSS-var publishing to `useLayoutEffect` and adding the `data-bottom-dock-dragging` attribute on `<html>` to suppress transitions on `.dock-bottom-anchored` consumers for the drag duration.
- (b) **Touch drag unreliable** — added `touch-action: none` (`touch-none` Tailwind class) on the grabber so the browser doesn't claim vertical pan gestures.
- (c) **Grabber hit target too small** — bumped from `h-3` (12px) to `h-6` (24px); the visible pill stays slim (4px) so it still reads as a grabber.
- (d) **Large dead zone when dragging from collapsed** — when the drag starts collapsed the handler now seeds the body at `MIN_VH` on the first past-threshold move and re-anchors the pointer origin, so the body grows continuously from the cursor instead of waiting until the user has dragged ~120px.
- (e) **Pointer-capture loss not handled** — added `onLostPointerCapture` to clear drag refs without toggling, so a stolen capture (alert / route unmount / OS focus swap) doesn't leave the dock in a stuck "dragging" state.

Drag-vs-click threshold also bumped from 4px to 8px (still snappy for mouse, absorbs touch jitter). `aria-controls` is conditionally `undefined` when collapsed.

**Done when:** the date timeline stays pinned to the dock floor across collapsed/expanded transitions; the user can collapse/expand the dock by clicking the visible top-edge handle (no longer dependent on the corner chevron); dragging the handle resizes the body smoothly between ~15vh and ~70vh; floating chrome (zoom / fullscreen / cloud toast / right sidebar) tracks the dock height in lockstep without lag; keyboard users can resize via `ArrowUp`/`ArrowDown`; `BottomRow.tsx` is deleted; `pnpm --filter @viz-crop/web typecheck` and `pnpm biome check apps/web/src` are clean (no new diagnostics vs baseline).

### Phase 5 exit criteria

- `/fields/:id` renders the full layout with the polygon visible.
- All shells/overlays present even if their data is not wired.
- No console errors; navigation between dashboard ↔ analysis is smooth.

---

## Phase 6 — NDVI tiles (Layer 4) + DateTimeline ✅ (completed 2026-05-11)

**Goal:** `/fields/:id` displays an NDVI heatmap clipped to the field polygon for the latest non-cloudy scene; clicking another date in the DateTimeline switches the heatmap; the IndexSwitcher swaps to EVI / NDWI.

**Phase entry:** Phase 4 complete (so cached scenes exist) and Phase 5 complete (so the timeline shell is on screen).

### Module 6.1 — `POST /api/eosda/scenes` ✅ (completed 2026-05-11)

Depends on: 4.4, 1.6.

1. Add `routes/eosda.scenes.ts` with auth and ownership check (verify `auth.userId` owns `fieldId`).
2. Body: `{ fieldId, dateRange?, forceRefresh? }` validated with zod from `packages/shared`.
3. Behavior: read `cached_scenes` first; if empty or stale for the requested range (or `forceRefresh` is true), run EOSDA Search for that range and upsert the returned scene metadata, then return.
4. Default `dateRange`: a configurable timeline window, e.g. the last 90 days. This is metadata-only and exists so the DateTimeline can show the available Sentinel-2 dates; it is not a tile/statistics prefetch.
5. Response: `SceneDto[]` from shared, ordered newest first.

**Done when:** Calling the route returns the latest warm-up scene immediately, refreshes/expands the timeline metadata when needed, and still returns no direct EOSDA URLs or API keys to the browser.

**Adversarial review fixes (Phase 6 wave-A, gpt-5.5):** When the caller passes only `dateRange.to`, the default `from` is now anchored on the resolved `to` (not on `now`), so requesting `{ to: '2024-01-01' }` produces a 90-day window ending on that date instead of skipping the requested date entirely. New regression test in `apps/api/test/eosda.scenes.routes.test.ts`.

### Module 6.2 — `useEosdaScenes` hook ✅ (completed 2026-05-11)

Depends on: 6.1, 0.7.

1. Create `hooks/useEosdaScenes.ts` wrapping `apiFetch('/api/eosda/scenes', ...)` via TanStack Query.
2. `staleTime: 60 * 60 * 1000` (1 h) per [`plan.md` TanStack Query cache defaults](./plan.md#tanstack-query-cache-defaults).
3. Auto-select the newest scene with cloud < 30% by writing to `useUiStore.selectedViewId` on first successful load (only if `selectedViewId` is unset). If no low-cloud scene exists, select the newest scene and let the timeline mark it as cloudy.

> ✅ RESOLVED (Module 6.4, 2025-11-07): `useAutoSelectDefaultScene(field.id)` is mounted in `AnalysisLayout.tsx` immediately after the Clerk-token-ref / `transformRequest` setup, so `/fields/:id` populates `selectedViewId` as soon as `useEosdaScenes` resolves.

**Done when:** Mounting `/fields/:id` populates the DateTimeline with real scene dates and selects a default.

**Adversarial review fixes (Phase 6 wave-A):**
- gpt-5.5 BLOCKER — `useAutoSelectDefaultScene` now picks from `bestPerDate(scenes)` (shared helper in `apps/web/src/lib/scene-helpers.ts`) instead of raw scenes, so the auto-selected `viewId` is guaranteed to have a chip in `DateTimeline`. The `isCurrentValid` check uses the same best-per-date list to avoid surfacing a "valid" selection that has no visible chip.
- sonnet-4.6 — `useEosdaScenes` now sets `retry: false` for `ApiError` 401/403 responses (kept `failureCount < 1` for everything else), so transient auth failures fail fast instead of forcing a doomed retry while the user waits.
- sonnet-4.6 nit #4 — Removed the stale "TODO for Module 6.4 sub-agent" wiring block in the `useAutoSelectDefaultScene` JSDoc; the wiring is done.

### Module 6.3 — Render proxy route ✅ (completed 2026-05-11)

Depends on: 1.6, 4.4, 4.2.

1. Add `routes/eosda.render.ts`:
   - `GET /api/eosda/render/:z/:x/:y` with query params `fieldId`, `viewId`, `band`.
   - zod-validate params: `band ∈ {'NDVI','EVI','NDWI'}`, `z/x/y` are integers, `viewId` non-empty string, `fieldId` UUID.
   - Verify `auth.userId` owns `fieldId`.
   - Verify `(fieldId, viewId)` exists in `cached_scenes` (otherwise 404 — prevents enumerating arbitrary scenes through our quota).
   - Decode `viewId` from the query param before embedding it in the upstream path.
   - Build upstream URL: `${EOSDA_BASE}/api/render/${viewId}/${band}/${z}/${x}/${y}` where `band` is the documented Sentinel-2 alias (`NDVI`, `EVI`, or `NDWI`). Aliases are accepted directly by EOSDA — do **not** translate them to formulas (see [`docs/review-findings.md` §2.1](./review-findings.md#21--eosda-does-not-accept-index-names-as-bands--wrong)).
   - Add query params **unconditionally**: `CALIBRATE=1`, `mimetype=image/png`, and the per-band `COLORMAP`/`MIN_MAX` defaults — `NDVI`/`EVI`: `RdYlGn` and `-1,1`; `NDWI`: `Blues` and `-1,1`. Setting these unconditionally is harmless if EOSDA's default already matches and required if it falls back to grayscale. Add `cropper_ref` from `fields.eosda_cropper_ref` when present.
   - Send `EOSDA_API_KEY` via `x-api-key` header. Only use `api_key` query fallback if a live Render test proves header auth is rejected, and never log that full URL.
   - Stream the upstream PNG response back to the client.
   - Set `Cache-Control: private, max-age=86400`.
2. Reject any path that contains `..` or unexpected characters in `viewId` (defense in depth even though it's a query param).

**Done when:** A direct browser GET (with the Clerk JWT) returns a PNG tile; without ownership returns 403/404; a live smoke confirms header auth and alias rendering (`NDVI`) work before closing the module.

> ⚠️ PENDING: Live smoke test of EOSDA Render header auth + alias rendering still required — tracked in the existing 6.3 Pending Items entry. Resolved when Phase 6 wave-A live smoke is run end-to-end.

**Implementation notes:**
- Added `eosdaFetch(path, options): Promise<Response>` sibling to `eosdaRequest` in `apps/api/src/services/eosda-client.ts` for binary streaming. Reuses `assertSafePath` + header auth + sanitised logging.
- Route enforces XYZ tile bounds (`x < 2^z`, `y < 2^z`) in addition to `z ≤ 22` so an attacker can't enumerate impossible coordinates into our quota.
- `viewId` allowlist regex: `/^[A-Za-z0-9/_-]+$/`, with separate rejections for `..`, leading `/`, and malformed percent-encoding.
- Single LEFT-JOIN against `cached_scenes` collapses both "wrong owner" and "scene not cached" to 404 (no enumeration distinction).
- Streaming strategy: `Buffer.from(await upstream.arrayBuffer())` then `reply.header('Content-Type', 'image/png').send(buf)`. Buffer keeps Fastify's default JSON serializer out of the picture, and the upfront `Content-Type` header makes the contract explicit.
- Upstream non-2xx is mirrored with an EMPTY body — never forward the upstream HTML/error page (which can echo the request URL when `useQueryAuth` is on).
- Tests: `apps/api/src/services/eosda-client.test.ts` (+22 tests for `eosdaFetch`), `apps/api/test/eosda.render.routes.test.ts` (22 tests covering auth, validation, ownership, happy path, cache headers, upstream failure mirroring).

**Adversarial review fixes (Phase 6 wave-A, opus-4.6):** A failure draining the upstream body via `arrayBuffer()` (e.g., mid-stream disconnect after a 200 OK) is now caught and surfaced as 502 instead of falling through to a generic 500. New regression test mocks a `Response` whose `arrayBuffer()` rejects and asserts both the 502 and the empty body (no half-decoded PNG forwarded).

### Module 6.4 — `NdviLayer` (Layer 4) ✅ (completed 2026-05-11)

Depends on: 2.3, 2.4 (`isStyleReady`), 6.2, 6.3, 3.1.

1. **Authenticated tile loading (critical).** MapLibre fetches raster tiles itself, not via `apiFetch`, so it does not pick up the Clerk JWT or the `VITE_API_BASE_URL` prefix automatically. Two pieces are required:
    - **Absolute tile URL.** Build the template against `VITE_API_BASE_URL`, e.g. `${env.VITE_API_BASE_URL}/api/eosda/render/{z}/{x}/{y}?fieldId=...&viewId=${encodeURIComponent(viewId)}&band=...`. Never rely on a relative `/api/...` URL — in dev that resolves to `http://localhost:5173` (Vite), not the Fastify API on port 8080. Only `viewId` is URL-encoded; MapLibre must keep `{z}/{x}/{y}` tokens intact.
   - **`transformRequest` on the map.** Configure MapLibre's `transformRequest(url, resourceType)` so that, for any URL beginning with `${env.VITE_API_BASE_URL}/api/eosda/render/`, it adds `headers: { Authorization: \`Bearer ${token}\` }` using the current Clerk session token. Wire `transformRequest` once when the map is created (in `useMapInstance`); read the latest token via a ref so it stays fresh after Clerk refreshes.
2. Create `components/map/NdviLayer.tsx`:
   - **Waits for `isStyleReady`** before adding sources/layers (same reason as `FieldLayer`).
   - Reads `useUiStore` for `selectedViewId`, `selectedIndex`, `ndviOpacity`.
   - Reads `useField(id)` for `fieldId`.
   - Adds a MapLibre `raster` source whose tile URL uses the absolute template above.
   - Adds a `raster` layer with `raster-opacity` bound to `ndviOpacity` (default 0.75).
   - Inserts **below the first symbol/label layer** if present (so labels and the field outline added in Module 3.3 stay visible above NDVI).
   - When `viewId` or `index` changes, removes the old source/layer and adds new ones (no in-place URL updates — MapLibre is fussy about that).
3. After mounting `NdviLayer`, `FieldLayer` may need a `map.moveLayer('field-fill')` / `map.moveLayer('field-outline')` nudge to remain on top — handle this in `FieldLayer`'s effect that watches the layer list.
4. Mount `<NdviLayer />` inside `AnalysisLayout`'s `<MapView>` children.

**Done when:** NDVI heatmap appears for the default scene; the network panel shows authenticated `200` responses to `/api/eosda/render/...` (not `401`/`404`); switching scene/index visibly updates the raster.

**Implementation notes (2025-11-07):**
- `apps/web/src/components/map/NdviLayer.tsx` — two-effect (lifecycle + opacity-only) component that mounts a `raster` source + `raster` layer driven by `useUiStore` (`selectedViewId`, `selectedIndex`, `ndviOpacity`).
- Lifecycle effect gates on `isAuthReady === true && selectedViewId != null` so MapLibre never fires tile requests before the Clerk JWT resolves (avoids the 401 storm called out in the rubber-duck review).
- `beforeId = findFirstSymbolLayerId(map)` (helper now in `apps/web/src/lib/map-style.ts`) inserts NDVI under basemap label symbols. `<NdviLayer>` is mounted *before* `<FieldLayer>` in JSX so `FieldLayer.moveLayer(...)` keeps the field outline on top.
- Opacity slider updates go through `setPaintProperty` (no source rebuild), keeping per-tick cost flat.
- `useAutoSelectDefaultScene(field.id)` from Module 6.2 is now mounted in `AnalysisLayout.tsx`, resolving the Module 6.2 pending row.

**Adversarial review fixes (Phase 6 wave-A, gpt-5.5 BLOCKER):** Added a third lifecycle gate — `isViewIdValidForField` — that subscribes to `useEosdaScenes(fieldId)` (TanStack Query dedupes; no extra request) and only allows the source to mount when `selectedViewId` actually exists in the current field's scene list. Without this gate, the field-A → field-B navigation would race the auto-select hook and fire MapLibre tile requests with the new `fieldId` and the old `viewId`, every one of which the API 404s by design (no enumeration). The gate eliminates those avoidable failed-tile loads.

### Module 6.5 — Wire DateTimeline interactivity ✅ (completed 2026-05-11)

Depends on: 5.5, 6.2, 6.4.

1. Replace the visual stub `DateTimeline` with a data-bound version:
   - Receives scenes from `useEosdaScenes`.
   - Renders one chip per available Sentinel-2 acquisition date from the EOSDA Search response, not a fixed/generated date sequence.
   - If multiple scenes share the same date, groups them and uses the best candidate for that chip (lowest cloud, then highest data coverage).
   - Shows a cloud icon when `cloudPercent > 50`.
   - Hovering a chip calls a tooltip with cloud + data coverage.
   - Clicking writes `viewId` to `useUiStore.selectedViewId`.
2. Hide chips with `cloudPercent > 50` behind a "show cloudy" toggle that defaults to off (matches `CloudHiddenToast` in [`plan.md` Field Analysis Screen Anatomy](./plan.md#2-field-analysis-screen-anatomy)).

**Done when:** Clicking different dates updates the NDVI raster on the map.

**Implementation notes (2025-11-07):**
- Added `showCloudyScenes: boolean` (default `false`) + `setShowCloudyScenes(next | updater)` to `apps/web/src/stores/useUiStore.ts`. Setter accepts a value OR an updater function so both `CloudHiddenToast` ("Show all") and `DateTimeline` (toggle) can flip it without an extra read.
- `apps/web/src/components/map/overlays/DateTimeline.tsx` rewritten: takes `fieldId: string`; subscribes to `useEosdaScenes(fieldId)`; computes best-per-date in render via `useMemo` (lowest `cloudPercent` with `null` ranked as `+∞`, tie-broken by highest `dataCoveragePercent` with `null` ranked as `-∞`); chips sorted oldest → newest; the currently selected chip is unioned into the visible set even when cloudy and the toggle is off (rubber-duck #8); skeleton loading + error pill with retry + empty-state `<output>`; "Show / Hide cloudy" toggle lives at the right end of the strip with `aria-pressed`. Strip uses `role="toolbar"` + `<button aria-pressed>` chips (matches the existing visual stub and Biome's lint guidance against `role="radio"` on non-input elements).
- `apps/web/src/components/map/overlays/CloudHiddenToast.tsx` rewritten: takes `fieldId: string`; subscribes to the same `useEosdaScenes` query (TanStack Query dedupes — no extra request); computes `hiddenCloudyCount` from best-per-date in `useMemo`; renders only when `!showCloudyScenes && hiddenCloudyCount > 0`; "Show all" button calls `setShowCloudyScenes(true)`; preserves the `dock-bottom-anchored` class and the `var(--bottom-dock-h) + 11rem` anchor; auto-dismiss removed (now carries an actionable affordance).
- Resolves Pending Item 5.5 N4: kept `<output>` because the chip is now a live computed-from-server-data result.
- Prop chain: `AnalysisLayout` already receives `field`; passes `fieldId={field.id}` to `<MapOverlays>` (new prop) which forwards to `<CloudHiddenToast>`. `BottomDock` already receives `field` and now passes `fieldId={field.id}` to `<DateTimeline>`. No Context introduced.

**Adversarial review fixes (Phase 6 wave-A):**
- sonnet-4.6 BLOCKER — `DateTimeline`'s chip strip now implements the WAI-ARIA APG roving-tabindex toolbar pattern. Exactly one chip is in the tab order at a time (`tabIndex={isFocusable ? 0 : -1}`); `ArrowLeft` / `ArrowRight` / `Home` / `End` move focus between chips (do NOT auto-select; selection still requires Space/Enter); `aria-orientation="horizontal"` is set on the toolbar; the focused chip is brought into view with `scrollIntoView` so it stays visible in the horizontally-scrolling strip. The chevron scroll buttons and the "Show / Hide cloudy" toggle stay outside the toolbar's focus loop with their own tab stops.
- gpt-5.5 BLOCKER cleanup — `DateTimeline` and `CloudHiddenToast` now both consume `bestPerDate(scenes)` / `isCloudyScene(scene)` from the new shared `apps/web/src/lib/scene-helpers.ts`. The duplicated inline copies are gone and the auto-select hook + the timeline + the hidden-toast count are guaranteed to agree. The force-render-active-chip path is preserved for the case where a user manually selects a cloudy chip with the filter on and then turns it off.
- opus-4.6 + sonnet-4.6 — `CloudHiddenToast` now resets its `dismissed` state via `useEffect(..., [fieldId])` so a previously-dismissed toast for one field doesn't suppress the toast for the next. Handles both the "component remounted" and "component persisted" navigation modes.

### Module 6.6 — `IndexDropdown` wiring ✅ (completed 2026-05-11)

Depends on: 5.5, 6.4.

Verification only — no code changes. Confirmed:
- `IndexDropdown` (Module 5.6 renamed from `IndexSwitcher`) calls `useUiStore.setSelectedIndex` on selection.
- `useUiStore.selectedIndex` typed as exactly `'NDVI' | 'EVI' | 'NDWI'` (Module 3.1).
- `NdviLayer` lifecycle effect includes `selectedIndex` in deps (Module 6.4 line 171) so tile URL `?band=${selectedIndex}` changes on index swap.
- `OpacityPopover` writes to `ndviOpacity` via separate effect (no source rebuild).
- `pnpm --filter @viz-crop/web typecheck` ✅ exit 0.
- `pnpm --filter @viz-crop/web build` ✅ exit 0.

**Done when:** Choosing EVI/NDWI swaps the raster. ✅ Chain validated; no bugs found.

### Phase 6 exit criteria

- NDVI tiles visible. They are field-clipped when `cropper_ref` is available; otherwise the accepted v2 fallback is scene-wide tiles under the field outline.
- DateTimeline + IndexSwitcher drive the raster.
- Network panel: no direct EOSDA calls from the browser; render proxy returns 200 PNGs.

---

## Phase 7 — Statistics + Sample pane + Chart tab

**Goal:** The Sample sidebar pane shows real NDVI statistics (Mean/p10/p90/median + cloud/data-coverage confidence). The Chart tab plots Mean NDVI across cached scenes.

**Phase entry:** Phase 6 complete.

### Module 7.1 — `POST /api/eosda/stats` ✅ (completed 2026-05-12)

Depends on: 1.6, 4.4, 4.1.

1. Add `eosdaStatsRequest` and `eosdaStatsResponse` to `packages/shared/src/eosda.ts`. Response envelope mirrors Phase 6: `{ stats: NdviStatsDto[] }`. When the requested range has no scenes the route returns the discriminator `{ stats: [], error: 'NO_SCENES_FOR_RANGE' }` (still HTTP 200; empty is a legitimate steady state — the frontend renders an empty-state message and DOES NOT spend EOSDA quota running `mt_stats` against zero scenes).
2. Add `apps/api/src/lib/date-range.ts` extracting `resolveDateRange` from `routes/eosda.scenes.ts` so both routes share the same default (last 90 days anchored on resolved `to`). Update the scenes route to import from the new module.
3. Add `apps/api/src/services/eosda-stats.ts` exporting `runMtStats({ geometry, indexes, dateRange, log, signal })` (mirrors the `eosda-search.ts` pattern from Phase 4). The service owns:
   - Create-task POST to `/api/gdw/api` with body `{ type: 'mt_stats', params: { bm_type, date_start, date_end, geometry, reference, sensors: ['sentinel2'], cloud_masking_level: 1 } }`. Use `geometry` (NOT `cropper_ref`) per [`docs/review-findings.md` §3.7](./review-findings.md). `reference = vizcrop-${shortHash}-${Date.now()}` where `shortHash` is the first 12 hex chars of `sha256(fieldId|sortedIndexes|date_start|date_end)` — gives a useful grep-key in EOSDA dashboards while the timestamp guarantees uniqueness so we never accidentally rejoin a stale task.
   - Poll `GET /api/gdw/api/<task_id>` every 2s using `setTimeout` + `await` (NOT `setInterval` — interval can't be cancelled cleanly). User-safe cap = `min(task_timeout, 60)` seconds. On timeout return `STATS_TIMEOUT` so the route can map to HTTP 504.
   - Normalize the nested EOSDA response: each scene row has `view_id`, `date`, `cloud`, and `indexes[indexName].{ average, median, min, max, p10, p90 }`. Map `average` → `mean` before returning to caller.
   > ⚠️ DEVIATION: EOSDA `mt_stats` also returns `std`, `variance`, `q1`, `q3` per scene. The `cached_ndvi_stats` schema has no columns for these and v2 has no UI for them — discarded by choice. A future phase that needs them must add columns + a migration.
4. Add `apps/api/src/services/eosda-stats.test.ts` (mock `eosdaRequest`).
5. Add `apps/api/src/services/stats-cache.ts` encapsulating cache reads/writes (mirrors `scene-cache.ts`):
   - `upsertNdviStats(fieldId, rows, opts)` — bulk INSERT … ON CONFLICT (`field_id, view_id, index_name`) DO UPDATE.
   - `listNdviStats(fieldId, { viewIds?, indexes?, db? })` — SELECT projected to numeric-string-preserving wire shape (shared zod uses `z.coerce.number()`).
   - `findMissingPairs(fieldId, viewIds, indexes, opts)` — returns `(viewId, index)` tuples NOT in cache.
6. Add `apps/api/src/services/stats-cache.test.ts` (round-trip against dev PostGIS).
7. Add `apps/api/src/routes/eosda.stats.ts`. Orchestration:
   1. Auth + ownership SELECT on `fieldId` (also fetches `geometry` to avoid a second round-trip — Phase 6 pattern).
   2. Use `listScenesForApi(fieldId, { dateRange, db })` to learn which `view_ids` exist for the requested range. **If zero**, short-circuit and return `{ stats: [], error: 'NO_SCENES_FOR_RANGE' }` (no EOSDA quota burn).
   3. Use `findMissingPairs` to compute `(viewId, index)` tuples not yet cached.
   4. **If at least one missing**, fire ONE `mt_stats` task for the FULL geometry + FULL `dateRange` + ALL requested indexes (cheap on quota — one task covers many scenes). Upsert results into `cached_ndvi_stats` and re-read.
   5. **If all cached**, return immediately.
   - Re-read cache after upsert so the wire shape matches the shared zod schema.
   - On EOSDA error degrade to stale cache where possible (Phase 6 pattern); only return 502 when there's no usable cached row at all.
8. Add `apps/api/test/eosda.stats.routes.test.ts` (mock `runMtStats`; Clerk mock with `x-test-user-id`).
9. Register the new route plugin in `apps/api/src/server.ts`.

**Done when:** First call kicks the task and returns once results land; subsequent calls are instant cache hits; empty-range request returns `NO_SCENES_FOR_RANGE` without consuming quota.

### Module 7.2 — `useEosdaStats` hook ✅ (completed 2026-05-12)

Depends on: 7.1, 0.7.

1. Create `hooks/useEosdaStats.ts`:
   - Signature: `useEosdaStats({ fieldId, indexes?, dateRange? })` returning `UseQueryResult<NdviStatsDto[], Error>`.
   - Query key (rubber-duck #2): `eosdaKeys.stats(fieldId, sortedIndexes, dateRange)` where `sortedIndexes = [...indexes].sort().join(',')` and `dateRange` contributes `from` + `to`. Add `stats(...)` to the existing `eosdaKeys` factory in `useEosdaScenes.ts`. Without these dimensions in the key, switching NDVI → EVI would reuse the NDVI cache.
   - Subscribe to `useEosdaScenes(fieldId)` for `enabled: scenesQuery.isSuccess && fieldId.length > 0` (rubber-duck #1 race fix). Stats must never run before scenes cache is fresh for the same `(fieldId, dateRange)`.
   - `staleTime: 60 * 60 * 1000`.
   - Re-parse the response with `eosdaStatsResponse.parse(data)` (boundary validation pattern from Phase 1).
   - 504 retry semantics (TanStack Query v5):
     - `retry: (failureCount, error) => is504(error) && failureCount < 1` — first failure: `failureCount === 0`, retries; second failure: `failureCount === 1`, returns `false`, stops.
     - `retryDelay: 10_000` — 10s sleep only when `retry` returns `true`. After the second timeout the user sees the final error immediately.
     - `is504(err) === err instanceof ApiError && err.status === 504`.
   - Toast on FINAL error: `useQuery` has NO `onError` in v5 (removed). Use a local `useEffect` on `query.isError && !query.isFetching` with a `useRef` guard to fire `toast.error('Stats are still computing — try again in a moment')` exactly once. Module 8.1 may consolidate into a `notifyError` helper later.
   - The Sample pane filters by `selectedViewId` + `selectedIndex` client-side to keep API calls minimal.

**Done when:** Hook returns an array of `NdviStatsDto` for the test field after the API completes; toggling between NDVI and EVI triggers a new fetch (different cache key) instead of reusing the wrong index's data.

### Module 7.3 — Sample sidebar pane ✅ (completed 2026-05-12)

Depends on: 5.3, 7.2.

1. Create `apps/web/src/lib/ndvi-colors.ts` exporting `getNdviColor(value: number | null): 'red' | 'yellow' | 'green' | 'gray'` and `NDVI_COLOR_CLASSES` (Tailwind tokens — match the palette already used in `scene-helpers.ts`/legend overlays). Used by both Sample pane and Chart tab so thresholds stay in sync (red <0.3, yellow 0.3–0.5, green >0.5; null/undefined → gray).
2. Build `components/shell/sample/SamplePane.tsx`:
    - Big number: Mean NDVI for the selected `(viewId, index)`; this is EOSDA `average` mapped to the app's `mean` field. Color via `getNdviColor`.
   - Smaller line: p10 / p90 / median.
   - Cloud + data-coverage line; show "low confidence" tag when cloud > 50% or data coverage low/missing.
   > ⚠️ DEVIATION: mini-histogram skipped in v2. EOSDA `mt_stats` does not return a histogram and `cached_ndvi_stats` has no column. Re-add when a future phase persists the buckets.
   - All eight UI states must be handled: no-selected-scene, scenes-loading, stats-computing-first-time, stats-retrying-after-504, final-error-with-retry-button, no-scenes-for-range (`error: 'NO_SCENES_FOR_RANGE'`), no-stats-for-pair, happy.
3. Wire `RightSidebar` to render `<SamplePane field={field} />` when `activeSidebarItem === 'sample'`. Remove the now-dead `SamplePanePlaceholder` helper.

**Done when:** The pane shows realistic numbers and re-renders on date/index switches; loading/empty/error states render appropriately.

### Module 7.4 — Chart tab ✅ (completed 2026-05-12)

Depends on: 5.4, 7.2.

1. Install `recharts: ^3.3.0` (verified React 19 compatible — peer deps `react: ^16.0.0 || ^17.0.0 || ^18.0.0 || ^19.0.0`).
2. Build `components/shell/chart/NdviChart.tsx`: a `LineChart` with x = scene date, y = Mean NDVI, dot color matching the same red/yellow/green thresholds via the shared `getNdviColor` from Module 7.3. De-emphasize (lower opacity, e.g. 0.4) points with cloud > 50% or low data coverage. Use a custom `<Dot />` per-point to drive the per-scene fill color.
3. Replace the BottomBar Chart tab placeholder body with `<NdviChart fieldId={field.id} />`.
4. Render the same eight UI states as the Sample pane.

**Done when:** Switching the BottomBar to the Chart tab shows the line for the field; dots are color-coded and low-confidence points are visually de-emphasized.

### Phase 7 exit criteria

- Sample pane shows live stats with confidence indicators.
- Chart tab shows the NDVI series.
- Cached requests are sub-100 ms; the first request blocks on the EOSDA poll but completes within the documented `mt_stats` window.

---

## Phase 8 — Polish, tests, README

**Goal:** The prototype passes the [`plan.md` end-to-end demo checklist](./plan.md#end-to-end-demo-checklist), has the smoke tests committed, and is reproducible cold from a `pnpm install`.

### Module 8.1 — Loading + error UX

Depends on: 7.4, 6.5.

1. Add skeletons (shadcn) for: dashboard list, analysis polygon load, DateTimeline, Sample pane, Chart tab.
2. Wrap every TanStack Query / mutation with a `<Sonner />` toast on error using a single `notifyError(err)` helper in `lib/notify.ts`.
3. Map known server errors (e.g., `EOSDA_BUDGET_EXCEEDED`) to friendlier messages.

**Done when:** Cutting the API mid-render shows a toast, not a blank panel.

### Module 8.2 — Field rename + delete dialogs

Depends on: 1.7, 1.8.

1. Implement the dashboard kebab menu's Rename (shadcn `Dialog` with name input + PATCH) and Delete (shadcn `Dialog` confirm + DELETE).
2. Add the same actions to the analysis screen TopBar's "All fields ▾" dropdown.

**Done when:** Both flows work, with optimistic UI invalidations.

### Module 8.3 — API smoke tests (expanded)

Depends on: 1.9, 6.1, 7.1.

1. Add tests for:
   - `POST /api/eosda/scenes` rejects a foreign `fieldId` with 403/404.
   - `GET /api/eosda/render/...` rejects an unknown `viewId` with 404 even if `fieldId` is owned.
   - Render route rejects non-allowlisted `band`.
2. Mock `fetch` for EOSDA where possible; gate any live-network tests behind `RUN_EOSDA_LIVE=1`.

**Done when:** `pnpm --filter @viz-crop/api test` passes including these.

### Module 8.4 — Demo data & README

Depends on: 8.1, 8.2.

1. Walk through the [`plan.md` end-to-end demo checklist](./plan.md#end-to-end-demo-checklist) for the five test fields. Capture any timing surprises.
2. Write `README.md`: prerequisites (Node 20+, pnpm 9+, Docker), pre-flight account links, `pnpm install && docker compose up -d && pnpm db:migrate && pnpm dev`, env file expectations, troubleshooting (Clerk redirect mismatch, EOSDA quota messages, MapLibre StrictMode warnings).
3. Add a top-level `pnpm db:migrate` script that delegates to `apps/api`'s drizzle-kit.

**Done when:** A teammate can clone the repo and follow the README from zero to a working app.

### Phase 8 exit criteria — also the project exit criteria

- All checklist items in the [`plan.md` end-to-end demo checklist](./plan.md#end-to-end-demo-checklist) pass.
- `pnpm run ci` (Biome), `pnpm test`, and `pnpm build` are green.
- README is sufficient for cold-start.

---

## Pending Items

| Module | Item | Blocked until | Notes |
|--------|------|---------------|-------|
| 1.6 | Allow PATCH `/api/fields/:id` to clear nullable metadata (`farmerName`, `village`, `district`, `state`, `sowingDate`) by sending `null` | Whenever the dashboard adds inline metadata editing (post-Phase 2) | `updateFieldDto` is derived from `createFieldDto.partial()` whose nullable columns only accept strings/dates, not `null`. Module 1.8's rename dialog only sends `{ name }`, so this didn't need to land in 1.8. When dashboard exposes inline metadata editing, extend `updateFieldDto` to accept `null` for those keys and pass it through to Drizzle. |
| 1.9 | Bootstrap migrations inside the API test setup so the suite works against a fresh DB | Whenever the API gets a CI runner that provisions clean DBs per job | `apps/api/test/fields.routes.test.ts` assumes the dev DB has already been migrated. On a fresh DB the first POST will fail with "relation fields does not exist". For now every developer has the dev DB migrated; revisit when CI provisions disposable DBs (likely add a `beforeAll` that runs `drizzle-kit migrate` programmatically). |
| 4.3 | Live-test EOSDA Search empty-results response shape (de-risked) | First env with EOSDA creds | Originally a code-correctness risk: `searchScenes` would throw on missing/null `results`, misclassifying genuine no-coverage as failure. Phase 4 review fix made the wrapper lenient (missing/null → `[]`, only present-but-non-array throws), so the runtime risk is closed. Live POST against a polygon outside Sentinel-2 coverage is still a useful contract confirmation but no longer blocks Phase 4 exit. |
| 6.3 | Live-test EOSDA Render header auth and alias visualization in browser | Phase 6 manual verification (next session) | Header auth + aliases (`NDVI`/`EVI`/`NDWI`) are unit-tested against the verified spec from `docs/review-findings.md` § 3.6 (mocked `eosdaFetch`). A real round-trip from MapLibre via the proxy to EOSDA still needs a browser session with a Clerk JWT; defer to the first interactive session that loads `/fields/$id`. If header auth fails for Render in practice, fall back to `api_key` query param with sanitized logging; if alias rendering is grayscale despite the unconditional `COLORMAP`/`MIN_MAX`, escalate to EOSDA support. |
| 5.5 | Smooth out the RightSidebar pane's two stacked motion effects (width animation + slide-in-from-right) | Phase 6 polish | Final UI/UX audit (N1) flagged the brief drift between `motion-safe:transition-[width]` on the outer container and `slide-in-from-right-2 + fade-in-0` on the pane itself. Defer to Phase 6 once real pane content stops being the dominant motion noise. |
| 5.5 | Lock IndexSwitcher per-button width via `min-w-[3.5rem]` so AnalysisToolbar doesn't jitter when Phase 6+ adds NDMI / MSAVI / SAVI | Phase 6 | Final UI/UX audit (N2). Currently NDVI / EVI / NDWI are all 3–4 chars so the bar is stable; pin widths before adding longer index names. |
| 5.2 | Surface a visible "Back" label on the TopBar back-arrow at `sm+` so the escape route doesn't depend on tooltip discovery | Phase 6 polish | Final UI/UX audit (N3). The screen has no breadcrumb, so an explicit label improves wayfinding. |
| 5.5 | Provide a tap-revealed lat/lng readout for `< lg` viewports (CoordsBadge currently `hidden lg:inline-flex`) | Phase 6 mobile pass | Final UI/UX audit (N5). On a 12" laptop / iPad the lat/lng is invisible; revisit alongside the broader mobile collision matrix in Phase 6+. |
| 5.5 | Tighten the gap between `ZoomControls` and `FullscreenButton` to a 4 px hairline so the left rail reads as one piece of chrome | Phase 6 polish | Final UI/UX audit (N6). Currently ~11 px sliver of map between them; could merge into one container or drop FullscreenButton's offset to `top-[calc(50%+44px)]`. |
| 5.3 | Add a small `sr-only` "Use arrow keys to navigate the sidebar" hint near the rail so keyboard users discover the roving-tabindex pattern | Phase 6 polish | Final UI/UX audit (N7). With 12 rail buttons reachable only by Arrow keys after focusing one, the navigation pattern needs a discoverability aid. |
| Phase 5 | Standardise "coming soon" copy + disabled-stub mechanism across `TopBar`, `BottomBar`, `RightSidebar`, `SourceSwitcher`, `DownloadButton` (all use Radix Tooltip; copy format `"<Action> coming soon…"`) | When the next stub is added or replaced | Final UI/UX audit (R5). Critical mismatch resolved (TopBar now uses Radix Tooltip + sentence case + ellipsis); remaining copy unification across in-pane "Coming soon…" placeholders can land alongside Phase 6/7 content. |
| 6.4 | Make `NdviLayer` resilient when the active basemap has no symbol layers | Phase 7+ basemap-toggle work | Adversarial review (sonnet-4.6 #3) — when `findFirstSymbolLayerId(map)` returns `null`, `<NdviLayer>` paints on top of the map instead of below labels, which would put the NDVI raster above basemap labels (and above `FieldLayer`'s `moveLayer(...)`-promoted outline only because the outline is moved AFTER NDVI is added). Not exploitable today: the ArcGIS hybrid basemap always exposes label symbol layers and `FieldLayer.moveLayer` runs unconditionally. Revisit when adding alternate basemaps (e.g. a label-less satellite) or a basemap toggle. |

---

## Appendix A — Module dependency graph

A compact view of cross-phase module dependencies. Use this to sanity-check parallelization within a phase.

```
Pre-flight P.1 (ArcGIS)  ─────────────────────────────────────────┐
Pre-flight P.2 (EOSDA)   ─────────────────────────────────┐        │
Pre-flight P.3 (Clerk)   ──────────────┐                  │        │
                                       │                  │        │
0.1 workspace                          │                  │        │
 ├─ 0.2 docker postgis                 │                  │        │
 ├─ 0.3 shared pkg                     │                  │        │
 ├─ 0.4 api skeleton ──┐               │                  │        │
 └─ 0.5 web skeleton ──┼─ 0.6 router   │                  │        │
                       │   └─ 0.7 query                   │        │
                       └─ 0.8 clerk ◀──┘                  │        │
                                                           │        │
1.1 drizzle ─ 1.2 schema ─ 1.3 geom helpers                │        │
1.4 shared zod ─ 1.5 zod tests                             │        │
1.6 routes ─ 1.7 useFields ─ 1.8 dashboard ─ 1.9 api tests │        │
                                                           │        │
                            2.1 maplibre ─ 2.2 useMap ─ 2.3 MapView ─ 2.4 ArcGIS ◀───── (P.1)
                                                                                  │
                                                       2.5 CreateLayout ◀─────────┘
                                                                                  │
3.1 stores ─ 3.2 terra-draw ─ 3.3 FieldLayer ─ 3.4 area chip ─ 3.5 form ─ 3.6 wire
                                                                                  │
4.1 eosda client ◀── (P.2)                                                        │
 ├─ 4.2 cropper                                                                   │
 ├─ 4.3 search ─ 4.4 scene-cache                                                  │
 └─ 4.5 warmField ─ 4.6 wire to POST /api/fields                                  │
                                                                                  │
5.1 AnalysisLayout ─ 5.2 TopBar ─ 5.3 RightSidebar ─ 5.4 BottomBar ─ 5.5 overlays │
                                                                                  │
6.1 scenes route ─ 6.2 useScenes ─ 6.3 render proxy ─ 6.4 NdviLayer ─ 6.5 timeline ─ 6.6 index switcher
                                                                                  │
7.1 stats route ─ 7.2 useStats ─ 7.3 SamplePane ─ 7.4 Chart                       │
                                                                                  │
8.1 polish ─ 8.2 dialogs ─ 8.3 expanded tests ─ 8.4 README                        │
```

Edges that cut across phases:
- **0.8 → every later API task** (auth wall must exist before any user-data routes).
- **1.4 → 1.6, 3.5, 6.1, 7.1** (shared zod is the contract).
- **1.6 → 4.6, 6.1, 6.3, 7.1** (route file ownership/auth pattern).
- **2.3 → 3.3, 5.1, 6.4** (`MapView` + context is the foundation for every layer).
- **4.4 → 6.1, 7.1** (cached_scenes table is the source of truth for downstream routes).
- **5.5 → 6.5, 6.6, 7.3, 7.4** (overlays/shells must exist before they can be wired to live data).

If any of these edges fail, you are doing tasks out of order — back up.
