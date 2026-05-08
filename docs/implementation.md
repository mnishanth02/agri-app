# viz-crop — Sequential Implementation Guide

> Companion to [`plan.md`](./plan.md). The plan defines **what** we are building. This document defines **the order in which to build it**.
>
> Each phase contains modules. Each module contains tasks. Tasks are written so they can be executed one at a time, in order. A later task may assume earlier tasks are done. Module-level dependencies are called out at the top of every module.

**Document version:** 1.0
**Source of truth for architecture/decisions:** [`plan.md`](./plan.md)
**Status:** Implementation-ready

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
| P.1 | Sign up at [developers.arcgis.com](https://developers.arcgis.com); create API key scoped to **Basemaps**; restrict to `localhost` + prod domain. | Phase 2 | `VITE_ESRI_API_KEY` |
| P.2 | Sign up at [api-connect.eos.com](https://api-connect.eos.com/user-dashboard/); email `api.support@eosda.com` to activate the trial. | Phase 4 | `EOSDA_API_KEY` |
| P.3 | Sign up at [clerk.com](https://clerk.com); create application; configure `http://localhost:5173` redirect; copy publishable + secret keys. | Phase 0.8 | `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` |

**Pre-flight done when:** all three keys live in a local `.env` (never committed) and the `.env.example` files in `apps/web` and `apps/api` document them.

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
9. Add `.vscode/extensions.json` recommending `biomejs.biome`, and `.vscode/settings.json` with `"editor.defaultFormatter": "biomejs.biome"` plus `"editor.codeActionsOnSave": { "source.fixAll.biome": "explicit", "source.organizeImports.biome": "explicit" }` so editor-on-save behavior matches `pnpm ci`.
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

> ⚠️ PENDING: The auth-check probe `GET /api/_auth-check` is a temporary route added in Module 0.8 step 8. It must be deleted in **Module 1.6** once `/api/fields` exists and exercises the auth wall through real business routes. The route file is `apps/api/src/routes/auth-check.ts` and its registration in `apps/api/src/server.ts`.

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
- `pnpm -r run typecheck` and `pnpm ci` (Biome) are clean.
- Sign-in redirect works.

Commit and tag this state as `phase-0-complete` (optional but useful for rollback).

---

## Phase 1 — Database + field CRUD

**Goal:** Authenticated users can create, list, read, rename, and delete fields. The dashboard renders their field list with computed area in hectares. PostGIS protects geometry validity.

**Phase entry:** Phase 0 complete.

### Module 1.1 — Drizzle setup

Depends on: 0.4.

1. Install in `apps/api`: `drizzle-orm`, `drizzle-kit`, `pg`, `@types/pg`.
2. Create `src/db/client.ts` — pg `Pool` from `env.DATABASE_URL`, wrap with Drizzle. Export `db` and `pool`.
3. Create `drizzle.config.ts` at `apps/api/` root (schema path, out path `src/db/migrations`, dialect `postgresql`, dbCredentials from env).
4. Create `src/plugins/db.ts` — Fastify plugin decorating `app.db` with the Drizzle client; closes pool on `app.close`.
5. Register the plugin in `server.ts` after env validation.

**Done when:** `app.db.execute(sql\`select 1 as ok\`)` returns `[{ ok: 1 }]` from a quick sanity script.

### Module 1.2 — Schema + initial migration

Depends on: 1.1, 0.2.

1. Create `src/db/schema.ts` with the tables defined in [plan.md §7](./plan.md#7-database-schema):
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

### Module 1.3 — Geometry helpers (server-side)

Depends on: 1.1.

1. Create `src/db/geometry.ts` exporting:
   - `geometryFromGeoJson(geom)` → `sql\`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geom)}), 4326)\``.
   - `geometryToGeoJson(col)` → `sql\`ST_AsGeoJSON(${col})::json\`` for selects.
2. Add a tiny unit test that round-trips a polygon literal through pg via `app.db.execute`.

**Done when:** Insert + select round-trips a small polygon and gets back the same coordinates within float tolerance.

### Module 1.4 — Shared zod schemas (fields + geometry)

Depends on: 0.3.

1. In `packages/shared/src/common.ts`:
   - `polygonGeoJsonSchema` — strict GeoJSON Polygon (single outer ring, optional holes), float lon/lat.
   - Refinements: ring closed (first === last), at least 4 positions in outer ring, all points inside India bbox `[68, 6, 98, 38]`.
2. In `packages/shared/src/field.ts`:
   - `cropTypeEnum` — exactly the 10 crops in plan.md §3.
   - `seasonEnum` — `['Kharif', 'Rabi', 'Zaid', 'Annual']`.
   - `createFieldDto` — name (1–120), cropType, season, optional metadata, geometry.
   - `updateFieldDto` — `createFieldDto.partial().omit({ geometry: true })` (geometry is immutable for v2; document this).
   - `fieldDto` — server-shaped record (id, name, area_hectares, etc.).
3. In `packages/shared/src/eosda.ts` add stubs for `sceneDto` and `ndviStatsDto` (filled in later phases).
4. Re-export everything from `src/index.ts`.

**Done when:** `pnpm --filter @viz-crop/shared build` succeeds and `apps/web` + `apps/api` can both import the schemas.

### Module 1.5 — Geometry area + bounds validation tests

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

### Module 1.6 — Field routes (CRUD)

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

### Module 1.7 — Web `useFields` hook

Depends on: 0.7, 0.8, 1.6.

1. Create `apps/web/src/hooks/useFields.ts`:
   - `useFieldList()` — `useQuery(['fields'])`.
   - `useField(id)` — `useQuery(['fields', id])`.
   - `useCreateField()` — `useMutation` POST + invalidate `['fields']`.
   - `useUpdateField(id)` and `useDeleteField(id)` similar.
2. Set sensible TanStack defaults (5 min stale on the list per plan.md §10).

**Done when:** A scratch component listing `useFieldList().data` renders the seeded user's fields.

### Module 1.8 — Dashboard UI

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

### Module 1.9 — Auth/ownership smoke tests for the API

Depends on: 1.6.

1. Add an `apps/api/test/` folder with a minimal Vitest setup that boots Fastify with a test DB URL (or uses pg-mem if integration is too heavy — pick one and document; pg-mem does not speak PostGIS, so prefer a disposable Docker DB or `postgres-meta`-style isolation).
2. Tests:
   - `GET /api/health` returns 200 unauthenticated.
   - `GET /api/fields` returns 401 without bearer token (mock Clerk by short-circuiting the preHandler in tests).
   - With a fake authed user, POST returns 201, GET returns the created row, PATCH updates name, DELETE removes it.
   - A second fake user cannot read or mutate user-1 records.

**Done when:** `pnpm --filter @viz-crop/api test` passes.

### Phase 1 exit criteria

- All field CRUD works end-to-end via curl and via the dashboard.
- Generated `area_hectares` matches a Turf-computed value within ~1%.
- Tests pass: `pnpm test` at root.
- No EOSDA code yet — it is fine for `cached_scenes`/`cached_ndvi_stats` to be empty.

---

## Phase 2 — Map foundation + basemap (Layers 1+2)

**Goal:** `/fields/new` renders a full satellite map of Karnataka with road and place labels, no flicker, no double-init under React StrictMode.

**Phase entry:** Phase 0 complete. ArcGIS API key from Pre-flight P.1.

### Module 2.1 — MapLibre installation + base styles

Depends on: 0.5.

1. In `apps/web`: install `maplibre-gl`.
2. Import `maplibre-gl/dist/maplibre-gl.css` once in `src/main.tsx`.

**Done when:** Build still passes; CSS is bundled.

### Module 2.2 — `useMapInstance` hook (StrictMode-safe)

Depends on: 2.1.

1. Create `hooks/useMapInstance.ts`:
   - Accepts a container ref + initial `center`/`zoom` options.
   - Initializes a `maplibregl.Map` exactly once (guarded against StrictMode double-effect using a ref).
   - Tracks two distinct ready signals:
     - `isReady` — flips on the first `map.on('load')` event (basic MapLibre load).
     - `isStyleReady` — flips when the **active** map style has finished loading. Initially `false`. Provide an exported `markStyleReady(map)` helper (or a `setStyleReady` setter) that the basemap module calls after it applies the ArcGIS style. Re-arms to `false` whenever a new style is being applied and back to `true` on the next style `idle`/`load`.
   - **`transformRequest` hook.** Configure MapLibre's `transformRequest(url, resourceType)` at construction time. Phase 6 will use it to attach a `Authorization: Bearer <clerk-jwt>` header to any URL beginning with `${env.VITE_API_BASE_URL}/api/eosda/render/`. To keep the token fresh after Clerk refreshes, read the latest token from a ref (e.g., a module-scope `latestTokenRef`) that the Clerk-aware caller updates. For Phase 2, `transformRequest` may simply return `{ url }` for non-render URLs; Module 6.4 wires the auth branch.
   - Returns `{ map, isReady, isStyleReady }`.
   - Cleans up via `map.remove()` on unmount.
2. Document the StrictMode rationale in the hook with a brief comment.
3. Document the rule: **all dynamic layers (Field, NDVI, overlays that reference style layers) must wait on `isStyleReady`, not `isReady`.** Applying a basemap style replaces sources/layers, so anything mounted on `isReady` alone will silently disappear when the style swaps in.

**Done when:** Mounting and unmounting a host component does not leak `<canvas>` elements (verify in DOM inspector); `isStyleReady` is observably `false` until the basemap style applies and `true` afterward.

### Module 2.3 — `MapView` component

Depends on: 2.2.

1. Create `components/map/MapView.tsx`:
   - Accepts `children` (overlay components) and a `style` prop (CSS-only sizing, no MapLibre style here yet).
   - Owns a `<div ref={containerRef}>` and calls `useMapInstance`.
   - Provides `map` via React context so descendant overlays can subscribe.
2. Create `components/map/MapContext.ts` exposing the typed context.

**Done when:** `<MapView style={{ height: '100vh' }} />` renders an empty grey MapLibre canvas.

### Module 2.4 — ArcGIS basemap plugin

Depends on: 2.3, Pre-flight P.1.

1. Install `@esri/maplibre-arcgis`.
2. Create `lib/arcgis.ts` exporting an `applyArcgisImagery(map, token)` helper that calls `maplibreArcGIS.BasemapStyle.applyStyle(map, { style: 'arcgis/imagery', token })` and resolves once the style finishes loading (await the underlying promise / wait for the next `map.once('idle')` if the helper is fire-and-forget).
3. Create `components/map/BasemapLayer.tsx` — child of `MapView` that calls `applyArcgisImagery` once `isReady` flips true. **After** the style finishes applying, call `markStyleReady(map)` from `useMapInstance` so downstream layers can mount.
4. Add a check: log a warning if the resolved style does not contain any `symbol` layers (some imagery styles don't ship labels — needed to know whether Phase 6 must use `beforeId` differently).

**Done when:** `MapView + BasemapLayer` shows Maxar Vivid imagery with road and place labels (or, if the style ships without labels, a clear console note about it).

### Module 2.5 — `CreateLayout` shell + Karnataka default

Depends on: 2.4.

1. Create `layouts/CreateLayout.tsx` — 2-column responsive layout: ~70% map, ~30% form column. Form column contains a placeholder for now.
2. Wire `routes/_auth/fields.new.tsx` to render `CreateLayout` with `<MapView center={[75.7139, 15.3173]} zoom={8}><BasemapLayer /></MapView>`.
3. Add Esri attribution display verification (the plugin should add it automatically; visually confirm).

**Done when:**
- `/fields/new` shows a satellite map of Karnataka.
- Esri attribution visible.
- StrictMode dev-mode does not double-init the map.

### Phase 2 exit criteria

- Map renders satellite + (where available) labels at zoom 8 over Karnataka.
- No console errors related to MapLibre or ArcGIS.
- Page survives multiple navigations between `/` and `/fields/new` without leaks.

---

## Phase 3 — Drawing + Layer 3 + create form

**Goal:** A signed-in user can draw a polygon on the create-map, fill out the field form, and successfully create a field that appears on the dashboard.

**Phase entry:** Phases 1 and 2 complete.

### Module 3.1 — `useUiStore` and `useFieldStore` (Zustand)

Depends on: 0.5.

1. Install `zustand`.
2. Create `stores/useFieldStore.ts`:
   - State: `draftPolygon: GeoJSON.Polygon | null`, `currentFieldId: string | null`.
   - Actions: `setDraftPolygon`, `clearDraft`, `setCurrentField`.
3. Create `stores/useUiStore.ts` (used by Phase 5 onward):
   - State: `selectedViewId`, `selectedIndex`, `ndviOpacity`, `activeSidebarItem`, `bottomBarTab`.
   - Actions: corresponding setters.

**Done when:** A scratch component reads/writes both stores and re-renders correctly.

### Module 3.2 — Terra-draw integration

Depends on: 2.3, 3.1.

1. Install `terra-draw` and `terra-draw-maplibre-gl-adapter`.
2. Create `hooks/useFieldDrawing.ts`:
   - Subscribes to the map context.
   - Constructs a `TerraDraw` instance with the MapLibre adapter and a single `TerraDrawPolygonMode`.
   - On feature finish, validates with the shared `polygonGeoJsonSchema` (reusing zod from `packages/shared`).
   - On valid finish, writes the polygon to `useFieldStore.setDraftPolygon`.
   - Exposes `start()`, `stop()`, `clear()`.
3. Create `components/map/DrawControl.tsx` — a small toolbar (top-right of map) with a "Draw" button that toggles draw mode and a "Clear" button.

**Done when:** Drawing a polygon on the map writes a valid GeoJSON Polygon into `useFieldStore`. Drawing an invalid polygon (e.g., self-intersecting) shows a toast and discards.

### Module 3.3 — `FieldLayer` (Layer 3)

Depends on: 2.3, 2.4 (`isStyleReady`), 3.1.

1. Create `components/map/FieldLayer.tsx`:
   - **Waits for `isStyleReady` from `useMapInstance` before touching the style** (do not mount on `isReady` alone — the basemap style swap will erase any sources/layers added too early).
   - Reads `draftPolygon` from `useFieldStore` (or, on the analysis screen, the persisted polygon from `useField(id)`).
   - Adds (or updates) a MapLibre `geojson` source named `field`.
   - Adds a `fill` layer (`fill-color: #ffffff`, `fill-opacity: 0.15`) and a `line` layer (`line-color: #ffffff`, `line-width: 2`).
   - Removes both on unmount.
2. **Layer ordering:** Append the field `fill` and `line` layers **on top of the basemap symbol/label layers**, not below them. Per plan.md §2 the required stack is `satellite → NDVI → labels → field fill → field outline`. Phase 6 will insert NDVI below the first symbol/label layer; if `FieldLayer` is also inserted below labels it will be hidden. If you need to re-insert field layers when other layers change, do so by calling `map.moveLayer('field-fill')` / `map.moveLayer('field-outline')` to the top after the change.

**Done when:** A drawn polygon shows a translucent fill with a white outline, and clearing the draft removes the layer cleanly.

### Module 3.4 — Geometry feedback (live area + validation hints)

Depends on: 3.2, 3.3.

1. In `lib/geometry.ts`, expose `polygonAreaHectares(geom)` (Turf wrapper).
2. In `useFieldDrawing`, also expose a derived `area`, `valid`, `errors[]` so the form can render live readouts.

**Done when:** As the user draws, a small chip near the form shows the current area in hectares.

### Module 3.5 — `CreateFieldForm`

Depends on: 1.4 (shared schemas), 3.1, 0.5 (shadcn `Form`).

1. Install `react-hook-form` and `@hookform/resolvers/zod`.
2. Create `components/forms/CreateFieldForm.tsx`:
   - Uses `useForm` with `zodResolver(createFieldDto.omit({ geometry: true }))`.
   - Fields: name, cropType (Select with the 10 crops), season (4-option segmented control built from shadcn `Tabs` or radio group), farmerName, village, district, state.
   - Reads `draftPolygon`, `valid` from `useFieldStore` / `useFieldDrawing`.
   - "Create Field" button disabled until both `formState.isValid` and `draftPolygon != null && polygonValid`.
3. On submit, calls `useCreateField().mutateAsync({ ...form, geometry: draftPolygon })`.
4. On success, clears the draft via `clearDraft()` and navigates with `useNavigate({ to: '/fields/$id', params: { id } })`.
5. Renders inline errors from server validation.

**Done when:**
- Submitting a complete form with a valid polygon creates a row visible on `/`.
- Invalid form or missing polygon keeps the button disabled.
- Server-side validation errors are displayed.

### Module 3.6 — Wire `CreateLayout` form column

Depends on: 2.5, 3.5.

1. Replace the placeholder in `CreateLayout` with `<CreateFieldForm />`.
2. Mount `<DrawControl />` and `<FieldLayer />` as `MapView` children.

**Done when:** The full create flow is usable end-to-end on `/fields/new`.

### Phase 3 exit criteria

- A signed-in user draws a polygon, fills the form, and lands on `/fields/:id` (which can still be a placeholder).
- The dashboard reflects the new field with the correct area.
- Invalid polygons (too small/large/outside India) are rejected on both client and server.

---

## Phase 4 — EOSDA warm-up service

**Goal:** Whenever a field is created, the API kicks off a non-blocking warm-up that creates an EOSDA `cropper_ref`, runs a Search for the last 6 months of Sentinel-2, and upserts results into `cached_scenes`. The POST response is fast either way.

**Phase entry:** Phase 1 complete. Pre-flight P.2 (EOSDA key activated).

### Module 4.1 — EOSDA HTTP client

Depends on: 0.4, 0.8.

1. Create `apps/api/src/services/eosda-client.ts`:
   - `eosda.request(path, init)` — wraps `fetch` against `https://api-connect.eos.com`, injects `EOSDA_API_KEY` (via header where supported, query fallback otherwise per plan.md §13).
   - Maps non-2xx responses to typed errors (`EosdaError` with `status`, `body`).
   - Logs only the path + status, **never** the full URL when it carries `api_key`.
2. Make `EOSDA_API_KEY` a required env var (now that this phase is active).

**Done when:** A small ad-hoc script can hit a low-impact EOSDA endpoint (e.g., user/profile if available) and parse the response.

### Module 4.2 — Cropper-ref creation/reuse

Depends on: 4.1, 1.2.

1. Add `services/eosda-cropper.ts` with `getOrCreateCropperRef(field)`:
   - If `field.eosda_cropper_ref` is set, return it.
   - Else POST the field polygon to EOSDA's cropper endpoint per current docs, capture the returned reference.
   - `UPDATE fields SET eosda_cropper_ref = $1 WHERE id = $2`.

**Done when:** Calling `getOrCreateCropperRef(field)` from a one-off scratch script for an existing field row populates `eosda_cropper_ref`, and a second call returns the same value without a new EOSDA POST. (End-to-end "create field → cropper appears" verification waits until Module 4.6, when `warmField` is wired into `POST /api/fields`.)

### Module 4.3 — Search wrapper

Depends on: 4.1.

1. Add `services/eosda-search.ts` with `searchScenes({ geometry, from, to })`:
   - POSTs to `/api/lms/search/v2/sentinel2` with `shape: <GeoJSON>`, `shapeRelation: 'CONTAINS'`, `cloudCoverage: { lte: 80 }`, date range.
   - Returns a normalized list `{ viewId, sceneDate, cloudPercent, dataCoveragePercent, tmsTemplate }[]`.

**Done when:** A unit test mocks `fetch` and asserts the mapping.

### Module 4.4 — Scene cache service

Depends on: 4.3, 1.2.

1. Add `services/scene-cache.ts`:
   - `upsertScenes(fieldId, scenes)` — `INSERT ... ON CONFLICT (field_id, view_id) DO UPDATE` for the columns that may change (cloud, data coverage, tms template).
   - `listScenes(fieldId, dateRange?)` — read from `cached_scenes`, ordered by date desc.

**Done when:** Inserts and re-inserts of the same `view_id` are idempotent.

### Module 4.5 — `field-warmup` orchestrator

Depends on: 4.2, 4.3, 4.4.

1. Create `services/field-warmup.ts` exporting `warmField(fieldId)`:
   - Loads the field (by id) — exits silently if missing.
   - `getOrCreateCropperRef(field)`.
   - `searchScenes({ geometry: field.geometry, from: today-6mo, to: today })`.
   - `upsertScenes(field.id, results)`.
   - All errors logged with `{ fieldId, step }` and swallowed.

**Done when:** Calling `warmField(id)` from a scratch script populates `eosda_cropper_ref` and `cached_scenes`.

### Module 4.6 — Wire `warmField` into `POST /api/fields`

Depends on: 1.6, 4.5.

1. After the insert in `POST /api/fields`, call `void warmField(id).catch((err) => req.log.error({ err, fieldId: id }, 'warm failed'))` — **do not** await.
2. Verify the POST still returns within ~100 ms in the local dev environment.

**Done when:** Creating a field returns immediately; logs show warm-up running asynchronously and completing later.

### Phase 4 exit criteria

- `cached_scenes` populates within ~30 s of field creation.
- If EOSDA returns an error, the POST still succeeds and a structured log line records the failure.
- `EOSDA_API_KEY` never appears in client-visible network requests.

---

## Phase 5 — Analysis layout shells + map overlays

**Goal:** `/fields/:id` shows the full-bleed analysis layout matching the reference screenshots: top bar, collapsible right sidebar, collapsible bottom bar, and all map overlay controls — even if most are visual stubs.

**Phase entry:** Phases 1, 2, 3 complete. Phase 4 is **not** required for layout work.

### Module 5.1 — `AnalysisLayout` shell

Depends on: 2.3.

1. Create `layouts/AnalysisLayout.tsx`:
   - Full-bleed `<MapView>` with `<BasemapLayer />` and `<FieldLayer />`.
   - Slots for `<TopBar />`, `<RightSidebar />`, `<BottomBar />` rendered as siblings (absolute positioning).
2. Wire `routes/_auth/fields.$id.tsx` to load the field via `useField(id)` and render `AnalysisLayout`.
3. While loading, show a subtle skeleton; on 404, redirect to `/`.

**Done when:** Visiting `/fields/:id` for an existing field shows the polygon centred and outlined on the satellite basemap.

### Module 5.2 — `TopBar`

Depends on: 5.1.

1. Create `components/shell/TopBar.tsx`: back arrow → `/`, field icon, field name, area in ha, crop type, "Get Overview" CTA (no-op for v2), "All fields ▾" placeholder dropdown.

**Done when:** Visual match to reference screenshot's top bar.

### Module 5.3 — `RightSidebar` (collapsible)

Depends on: 5.1, 0.5 (shadcn `Sheet`/`Tabs`/`Tooltip`).

1. Create `components/shell/sidebar-items.ts` with the array of items from plan.md §4.
2. Create `components/shell/RightSidebar.tsx`:
   - Collapsed (~64 px) icon rail with tooltips.
   - Expanded (~300 px) shows the active item's pane.
   - Active item state in `useUiStore`.
   - Only the **Sample** pane renders a real container (filled in Phase 7); everything else renders a "Coming soon" placeholder.

**Done when:** Click an icon → expands, shows pane title, second click collapses.

### Module 5.4 — `BottomBar`

Depends on: 5.1, 0.5 (shadcn `Tabs`).

1. Create `components/shell/BottomBar.tsx`:
   - Collapsible (~280 px when open).
   - Tabs: **Crop info** (renders crop rotation card with current season + crop, plus growth-stages / risks / sown-area placeholders), **Chart** (placeholder until Phase 7), **Activities** (empty list + disabled "Add" button).

**Done when:** Crop info tab shows real metadata for the current field; the other two render placeholders without errors.

### Module 5.5 — Map overlays (visual only)

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

### Phase 5 exit criteria

- `/fields/:id` renders the full layout with the polygon visible.
- All shells/overlays present even if their data is not wired.
- No console errors; navigation between dashboard ↔ analysis is smooth.

---

## Phase 6 — NDVI tiles (Layer 4) + DateTimeline

**Goal:** `/fields/:id` displays an NDVI heatmap clipped to the field polygon for the latest non-cloudy scene; clicking another date in the DateTimeline switches the heatmap; the IndexSwitcher swaps to EVI / NDWI.

**Phase entry:** Phase 4 complete (so cached scenes exist) and Phase 5 complete (so the timeline shell is on screen).

### Module 6.1 — `POST /api/eosda/scenes`

Depends on: 4.4, 1.6.

1. Add `routes/eosda.scenes.ts` with auth and ownership check (verify `auth.userId` owns `fieldId`).
2. Body: `{ fieldId, dateRange? }` validated with zod from `packages/shared`.
3. Behavior: read `cached_scenes` first; if empty for the requested range, run `searchScenes` and `upsertScenes`, then return.
4. Response: `SceneDto[]` from shared.

**Done when:** Calling the route returns the same scenes that warm-up populated.

### Module 6.2 — `useEosdaScenes` hook

Depends on: 6.1, 0.7.

1. Create `hooks/useEosdaScenes.ts` wrapping `apiFetch('/api/eosda/scenes', ...)` via TanStack Query.
2. `staleTime: 60 * 60 * 1000` (1 h) per plan.md §10.
3. Auto-select the latest scene with cloud < 30% by writing to `useUiStore.selectedViewId` on first successful load (only if `selectedViewId` is unset).

**Done when:** Mounting `/fields/:id` populates the DateTimeline with real scene dates and selects a default.

### Module 6.3 — Render proxy route

Depends on: 1.6, 4.4, 4.2.

1. Add `routes/eosda.render.ts`:
   - `GET /api/eosda/render/:z/:x/:y` with query params `fieldId`, `viewId`, `band`.
   - zod-validate params: `band ∈ {'NDVI','EVI','NDWI'}`, `z/x/y` are integers, `viewId` non-empty string, `fieldId` UUID.
   - Verify `auth.userId` owns `fieldId`.
   - Verify `(fieldId, viewId)` exists in `cached_scenes` (otherwise 404 — prevents enumerating arbitrary scenes through our quota).
   - Build upstream URL: `${EOSDA_BASE}/api/render/${viewId}/${band}/${z}/${x}/${y}` plus query: `cropper_ref` from the field if present, plus `api_key`.
   - Stream the upstream PNG response back to the client.
   - Set `Cache-Control: private, max-age=86400`.
2. Reject any path that contains `..` or unexpected characters in `viewId` (defense in depth even though it's a query param).

**Done when:** A direct browser GET (with the Clerk JWT) returns a PNG tile; without ownership returns 403/404.

### Module 6.4 — `NdviLayer` (Layer 4)

Depends on: 2.3, 2.4 (`isStyleReady`), 6.2, 6.3, 3.1.

1. **Authenticated tile loading (critical).** MapLibre fetches raster tiles itself, not via `apiFetch`, so it does not pick up the Clerk JWT or the `VITE_API_BASE_URL` prefix automatically. Two pieces are required:
   - **Absolute tile URL.** Build the template against `VITE_API_BASE_URL`, e.g. `${env.VITE_API_BASE_URL}/api/eosda/render/{z}/{x}/{y}?fieldId=...&viewId=...&band=...`. Never rely on a relative `/api/...` URL — in dev that resolves to `http://localhost:5173` (Vite), not the Fastify API on port 8080.
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

### Module 6.5 — Wire DateTimeline interactivity

Depends on: 5.5, 6.2, 6.4.

1. Replace the visual stub `DateTimeline` with a data-bound version:
   - Receives scenes from `useEosdaScenes`.
   - Renders one chip per date, with a cloud icon when `cloudPercent > 50`.
   - Hovering a chip calls a tooltip with cloud + data coverage.
   - Clicking writes `viewId` to `useUiStore.selectedViewId`.
2. Hide chips with `cloudPercent > 50` behind a "show cloudy" toggle that defaults to off (matches `CloudHiddenToast` in plan.md §4).

**Done when:** Clicking different dates updates the NDVI raster on the map.

### Module 6.6 — `IndexSwitcher` wired

Depends on: 5.5, 6.4.

1. Replace the stub `IndexSwitcher`'s onChange with a writer to `useUiStore.selectedIndex`.
2. Confirm `NdviLayer` reacts (already handled in 6.4).

**Done when:** Choosing EVI/NDWI swaps the raster.

### Phase 6 exit criteria

- NDVI tiles visible and field-clipped via `cropper_ref`.
- DateTimeline + IndexSwitcher drive the raster.
- Network panel: no direct EOSDA calls from the browser; render proxy returns 200 PNGs.

---

## Phase 7 — Statistics + Sample pane + Chart tab

**Goal:** The Sample sidebar pane shows real NDVI statistics (mean/p10/p90/median + cloud/data-coverage confidence). The Chart tab plots the mean NDVI across cached scenes.

**Phase entry:** Phase 6 complete.

### Module 7.1 — `POST /api/eosda/stats`

Depends on: 1.6, 4.4, 4.1.

1. Add `routes/eosda.stats.ts`:
   - Body: `{ fieldId, indexes?: ('NDVI'|'EVI'|'NDWI')[], dateRange? }` (default indexes `['NDVI']`, max 3 per plan.md gotcha).
   - Auth + ownership check on `fieldId`.
   - Cache-first: read `cached_ndvi_stats` for `(fieldId, viewId, index)` across the listed `view_ids` (the route may use the cached scenes table to know which `view_ids` to consider).
   - On miss: create an EOSDA `mt_stats` task with `bm_type` listing the missing indexes for the polygon + date range, **poll** until completion (with a sane max wait + backoff), then upsert results to `cached_ndvi_stats` and return.
2. Add `services/stats-cache.ts` to encapsulate the cache reads/writes (mirrors `scene-cache.ts`).

**Done when:** First call kicks the task and returns once results land; subsequent calls are instant cache hits.

### Module 7.2 — `useEosdaStats` hook

Depends on: 7.1, 0.7.

1. Create `hooks/useEosdaStats.ts`:
   - `useEosdaStats(fieldId, indexes)` returns the full series for the field.
   - `staleTime: 60 * 60 * 1000`.
   - The Sample pane filters by `selectedViewId` + `selectedIndex` client-side to keep API calls minimal.

**Done when:** Hook returns an array of `NdviStatsDto` for the test field after the API completes.

### Module 7.3 — Sample sidebar pane

Depends on: 5.3, 7.2.

1. Build `components/shell/sample/SamplePane.tsx`:
   - Big number: mean NDVI for the selected `(viewId, index)`. Color-coded: red <0.3, yellow 0.3–0.5, green >0.5.
   - Smaller line: p10 / p90 / median.
   - Cloud + data-coverage line; show "low confidence" tag when cloud > 50% or data coverage low/missing.
   - Mini histogram from the bucketed values returned by EOSDA (skip if not available — render a textual fallback).
2. Wire `RightSidebar` to render `SamplePane` when `activeSidebarItem === 'sample'`.

**Done when:** The pane shows realistic numbers and re-renders on date/index switches.

### Module 7.4 — Chart tab

Depends on: 5.4, 7.2.

1. Install `recharts`.
2. Build `components/shell/chart/NdviChart.tsx`: a `LineChart` with x = scene date, y = mean NDVI, dot color matching the same red/yellow/green thresholds. De-emphasize (lower opacity) points with cloud > 50% or low data coverage.
3. Replace the BottomBar Chart tab placeholder with `NdviChart`.

**Done when:** Switching the BottomBar to the Chart tab shows the line for the field.

### Phase 7 exit criteria

- Sample pane shows live stats with confidence indicators.
- Chart tab shows the NDVI series.
- Cached requests are sub-100 ms; the first request blocks on the EOSDA poll but completes within the documented `mt_stats` window.

---

## Phase 8 — Polish, tests, README

**Goal:** The prototype passes the end-to-end checklist in plan.md §16, has the smoke tests committed, and is reproducible cold from a `pnpm install`.

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

1. Walk through plan.md §16 demo checklist for the five test fields. Capture any timing surprises.
2. Write `README.md`: prerequisites (Node 20+, pnpm 9+, Docker), pre-flight account links, `pnpm install && docker compose up -d && pnpm db:migrate && pnpm dev`, env file expectations, troubleshooting (Clerk redirect mismatch, EOSDA quota messages, MapLibre StrictMode warnings).
3. Add a top-level `pnpm db:migrate` script that delegates to `apps/api`'s drizzle-kit.

**Done when:** A teammate can clone the repo and follow the README from zero to a working app.

### Phase 8 exit criteria — also the project exit criteria

- All checklist items in plan.md §16 pass.
- `pnpm ci` (Biome), `pnpm test`, and `pnpm build` are green.
- README is sufficient for cold-start.

---

## Pending Items

| Module | Item | Blocked until | Notes |
|--------|------|---------------|-------|
| 0.8 | Remove temporary `GET /api/_auth-check` probe route | Module 1.6 | `apps/api/src/routes/auth-check.ts` and its registration in `server.ts`. Added to exercise the auth wall before any business routes exist. Delete once `/api/fields` (Module 1.6) covers the same surface. |

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
