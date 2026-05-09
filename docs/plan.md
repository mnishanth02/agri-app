# viz-crop — Implementation Plan

> Product plan, user flows, implementation phases, and project management for the viz-crop crop monitoring application.

**Document version:** 2.1
**Last updated:** May 2026
**Status:** Reviewed and implementation-ready after account setup
**Companion doc:** [architecture.md](./architecture.md) — Tech stack, system architecture, database schema, API surface, and component design.

---

### Review corrections before implementation

- Keep the overall architecture, but wire EOSDA exactly around the official flow: **Search** returns `view_id`/`tms`, **Render** serves `GET /api/render/<view_id>/<bands>/<z>/<x>/<y>`, and **Statistics** is an async `mt_stats` task that must be created and polled before caching results.
- Do **not** put EOSDA `view_id` directly in a path segment. It contains `/` (for example `S2/43/P/GK/2026/3/23/0`), so the app proxy uses query params for render tiles: `/api/eosda/render/:z/:x/:y?fieldId=...&viewId=...&band=NDVI`.
- Use EOSDA `cropper_ref` for field-clipped render tiles. Without it, NDVI tiles render the whole scene under the field outline.
- Clerk Fastify should be described around `clerkPlugin()` + `getAuth()` and `CLERK_SECRET_KEY`; `CLERK_JWKS_URL` is only needed for a manual JWT-verification implementation.
- Use the real TanStack devtools package names: `@tanstack/react-router-devtools` and `@tanstack/react-query-devtools`.
- Minimal tests are in scope from the start: shared zod/geometry validation plus API smoke tests. Full E2E/CI can wait.

---

## Table of Contents

1. [User Flow & Routes](#1-user-flow--routes)
2. [Field Analysis Screen Anatomy](#2-field-analysis-screen-anatomy)
3. [External Account Setup](#3-external-account-setup)
4. [Implementation Phases](#4-implementation-phases)
5. [Cost Summary](#5-cost-summary)
6. [Risks & Gotchas](#6-risks--gotchas)
7. [Verification & Testing](#7-verification--testing)
8. [Out of Scope](#8-out-of-scope)
9. [References](#9-references)
10. [Appendix A — Decision Log](#appendix-a--decision-log)

---

## 1. User Flow & Routes

| Route | Purpose | Auth | Layout |
|---|---|---|---|
| `/sign-in` | Clerk sign-in | public | centered card |
| `/` | Dashboard — list fields + "Add Plot" CTA | gated | DashboardLayout |
| `/fields/new` | Map (left) + Field Details Form (right) | gated | CreateLayout (2-col) |
| `/fields/:id` | Full-screen analysis: map + overlays + sidebar shell + bottom-bar shell | gated | AnalysisLayout |

### Dashboard `/`
- Lists fields owned by the signed-in user (cards with thumbnail, name, area in ha, crop, last update).
- Empty state: large "Add your first plot" panel with a `+` button → `/fields/new`.
- Each card has a kebab menu: Open / Rename / Delete (with confirm).

### Create `/fields/new`
- 2-column responsive layout: Map left (~70 %), Form right (~30 %).
- Map: Layers 1+2 only, default centre Karnataka `[75.7139, 15.3173]` zoom 8.
- Top-right of map: polygon Draw control (terra-draw).
- Form fields:
  - Field Name *(required)*
  - Crop Type *(required)* — dropdown seeded with: Rice, Wheat, Cotton, Sugarcane, Maize, Soybean, Pulses, Groundnut, Mustard, Jowar
  - Season *(required)* — segmented control: Kharif / Rabi / Zaid / Annual
  - Farmer Name *(optional)*
  - Village
  - District
  - State
- "Create Field" button **disabled** until polygon is closed AND required fields are valid.
- On submit:
  1. `POST /api/fields` with `{ ...form, geometry }`
  2. Server validates, inserts, kicks off `void warmField(id)` (no await), returns `{ id }`
  3. Router `navigate({ to: '/fields/$id', params: { id } })`

### Analysis `/fields/:id`
See [Section 2](#2-field-analysis-screen-anatomy) for the full anatomy.

---

## 2. Field Analysis Screen Anatomy

The analysis screen is a full-bleed map with three layout shells (top, right, bottom) and a cluster of map-overlay controls. Functional controls live on the **map**, not in the shells. This matches the reference screenshots.

### Shells (chrome)

- **Top bar** (`TopBar.tsx`): back arrow → `/`, field icon, field name, area in ha, crop type, "Get Overview" CTA, "All fields ▾".
- **Right sidebar** (`RightSidebar.tsx`): collapsible icon rail. Collapsed = ~64 px (icons only); expanded = ~300 px (icon + label + active pane). Items rendered from a config array:
  - Sample (active in v2 — shows NDVI stats for the selected scene)
  - Monitoring (stub — "Coming soon")
  - Weather (stub)
  - Field activity log (stub)
  - VRA maps (stub)
  - Scout tasks (stub)
  - Data manager (stub)
  - Field manager (stub)
  - AI assistant (stub)
  - Notifications (stub)
  - Help Center (stub)
  - Marketplace (stub)
- **Bottom bar** (`BottomBar.tsx`): collapsible (~280 px when open). Three tab shells:
  - **Crop info** — Crop rotation card (current season + crop), Growth stages placeholder, Current risks placeholder, Sown area detected placeholder.
  - **Chart** — recharts NDVI line over all cached scenes.
  - **Activities** — empty list + "Add" button stub.

### Map overlays (functional controls — absolutely positioned over the map canvas)

| Position | Control | Purpose |
|---|---|---|
| Top-left | `CoordsBadge` | "8.5027° N · 77.1738° E" live readout |
| Top-right | `ScaleBar` | "300 m" scale |
| Left | `ZoomControls`, ruler, locate-me | standard MapLibre controls |
| Bottom (above BottomBar) | **`DateTimeline`** | Horizontal date strip with cloud icons; click to switch scene |
| Bottom-left | `CloudHiddenToast` | "Images with cloudiness over 50% have been hidden ✕" |
| Bottom-right cluster | `SourceSwitcher` (Sentinel-2 ▾), `IndexSwitcher` (NDVI ▾), opacity icon, download icon, palette icon, **fullscreen** icon, sidebar-collapse toggle | All visualization controls |

### Sample sidebar pane (the only fully wired sidebar item in v2)
- Big number: **mean NDVI** for selected scene (color-coded: red <0.3, yellow 0.3–0.5, green >0.5)
- Smaller: p10 / p90 / median from EOSDA Statistics
- Cloud + data-coverage line; show "low confidence" when cloud >50 % or data coverage is low/missing
- Mini histogram of NDVI value distribution

---

## 3. External Account Setup

Start these before implementation. ArcGIS and Clerk are quick; EOSDA access/quota can require manual activation.

### 1. ArcGIS Location Platform (~10 min)
- Sign up at [developers.arcgis.com](https://developers.arcgis.com), no card required.
- Create an API key scoped to **Basemaps**.
- **Restrict to your domains** (`localhost`, your prod domain).
- Save as `VITE_ESRI_API_KEY`; required before Phase 2 starts.

### 2. EOSDA API Connect (~1 business day)
- Register at [api-connect.eos.com/user-dashboard/](https://api-connect.eos.com/user-dashboard/).
- **Email api.support@eosda.com** to activate the trial.
- Save the key as `EOSDA_API_KEY` — backend only, never the browser.

### 3. Clerk (~5 min)
- Sign up at [clerk.com](https://clerk.com).
- Create an application, copy the publishable key + secret.
- Save `VITE_CLERK_PUBLISHABLE_KEY` (web) and `CLERK_SECRET_KEY` (api).
- In the Clerk dashboard, set the redirect URL to `http://localhost:5173`.
- Backend routes use `@clerk/fastify` with `clerkPlugin()` and `getAuth(request)`.

### Environment files
`apps/web/.env.example`:
```
VITE_ESRI_API_KEY=
VITE_CLERK_PUBLISHABLE_KEY=
VITE_API_BASE_URL=http://localhost:8080
```
`apps/api/.env.example`:
```
PORT=8080
DATABASE_URL=postgres://viz:viz@localhost:5432/viz_crop
EOSDA_API_KEY=
CLERK_SECRET_KEY=
ALLOWED_ORIGINS=http://localhost:5173
```

---

## 4. Implementation Phases

Each phase has a clear goal, tasks, and a green-or-red verification checklist. Time estimates are rough focused-work estimates, not commitments.

### Phase 0 — Monorepo scaffold + auth shell (~1.5 h)
- Init pnpm workspaces; root `package.json` with `dev`, `build`, `lint`, `format`, `test` scripts.
- Scaffold `apps/web` (Vite + React + TS + Tailwind + shadcn init).
- Scaffold `apps/api` (Fastify + TS + tsx).
- Scaffold `packages/shared` (zod schemas).
- `docker-compose.yml` with `postgis/postgis:17-3.5`, healthcheck, named volume.
- Wire Clerk both sides; `_auth/route.tsx` redirects to `/sign-in` if unauthed.
- TanStack Router file-based routing; TanStack Query provider + devtools.

**Verify:** `docker compose up -d` brings Postgres up; `pnpm dev` runs web + api in parallel; `pnpm build` succeeds; visiting `/` while signed out redirects to `/sign-in`; signing in lands on an empty `/`.

### Phase 1 — DB + Field CRUD (~2 h)
- Add Drizzle, write `db/schema.ts`, generate initial migration enabling PostGIS.
- Add API geometry helpers for `ST_SetSRID(ST_GeomFromGeoJSON(...), 4326)` inserts and GeoJSON reads.
- Implement `GET / POST / GET-one / PATCH / DELETE /api/fields` with zod validation, user-scoped queries.
- Build `useFields()` hook, dashboard `FieldList` + `FieldCard` + `EmptyState`.
- Add shared geometry validation tests for closed ring, min/max area, and India bbox guardrail.

**Verify:** `pnpm test` passes; create a field via curl with the Clerk JWT; appears on dashboard with correct generated area; deleting removes it; another Clerk user sees an empty list.

### Phase 2 — Map foundation + Layers 1+2 + Karnataka default (~1 h)
- Install pinned-compatible map packages: MapLibre v5 + `@esri/maplibre-arcgis` v1.x.
- Require `VITE_ESRI_API_KEY` once the basemap ships; Esri basemap styles require an access token.
- Build `MapView` + `useMapInstance` with StrictMode-safe cleanup: dev StrictMode may construct during the extra setup/cleanup pass, but must settle with one live map/canvas/listener set.
- Track `isReady`, `isStyleReady`, and `styleEpoch`; dynamic layers and Terra Draw must wait for `isStyleReady` and re-add when `styleEpoch` changes because ArcGIS style application replaces MapLibre sources/layers.
- Apply satellite imagery through `maplibreArcGIS.BasemapStyle.applyStyle(...)` and verify the chosen style includes road/place label `symbol` layers. If `arcgis/imagery` is imagery-only for the current API/account, switch to the documented imagery-with-labels/hybrid style or merge label layers before completing Phase 2.
- Insert future NDVI layers below the first discovered symbol/label layer (`findFirstSymbolLayerId`), never a hard-coded Esri layer ID.
- Default `[75.7139, 15.3173]` zoom 8 in `CreateLayout`, sized to the authenticated layout viewport (`calc(100vh - header)`).

**Verify:** `/fields/new` shows Karnataka satellite + road/village labels; Esri attribution visible; navigation and dev StrictMode do not leave duplicate live maps.

### Phase 3 — Drawing + Layer 3 + Create form (~2 h)
- Install terra-draw + MapLibre adapter; `DrawControl` lives top-right of map.
- `useFieldDrawing` initializes only after `isStyleReady`; polygon + validation state stored in Zustand using selectors/`useShallow` so form state does not re-render the map.
- Reject self-intersections during drawing with Terra Draw `ValidateNotSelfIntersecting` or an equivalent shared guard.
- MapLibre GeoJSON source: white fill at 15 %, white 2 px outline; update with `GeoJSONSource#setData`, remove layers before source, and re-add/reorder on `styleEpoch`.
- Validate full submit contract: closed ring, area ∈ [0.05 ha, 200 km²], inside India bbox. Area/bbox issues remain visible inline and keep submit disabled instead of silently discarding the draft.
- `CreateFieldForm` with shadcn `<Form>` + zod resolver, explicit default values, and `mode: 'onChange'`. 10 Indian crops; Season as 4-option segmented control.
- "Create Field" disabled until polygon AND form valid and mutation is not pending.
- On submit: final `createFieldDto.safeParse` → `POST /api/fields` → on 201, navigate to `/fields/:id`, then clear the draft.

**Verify:** Draw a polygon over a Karnataka field, fill the form, submit; record appears on dashboard with correct area; self-intersections toast/discard; area/bbox errors show inline and block submit.

### Phase 4 — Background EOSDA warm-up (~1 h)
- `services/eosda-client.ts` — fetch wrapper, `EOSDA_API_KEY` injection, error mapping, and no logging of full upstream URLs containing `api_key`.
- `services/field-warmup.ts` — `void warmField(id).catch(...)` called from `POST /api/fields` after the insert (no `await`). Creates/reuses EOSDA Render `cropper_ref`, performs a latest-first Sentinel-2 Search for the polygon (`sentinel2`, `shapeRelation: CONTAINS`, cloud 0-80, `sort: { date: 'desc' }`, small `limit`), and upserts the newest available scene metadata to `cached_scenes`. Errors are logged with `fieldId`, never propagated to field creation.
- Do not fetch six months of imagery, statistics, or tiles during field creation. EOSDA Search metadata is cheap enough to warm; Render tiles and `mt_stats` stay on-demand.

**Verify:** Create a field; `eosda_cropper_ref` and the newest available `cached_scenes` row populate when EOSDA has data for that polygon; the POST itself returns quickly; if EOSDA fails the create still succeeds and a useful log line is emitted.

### Phase 5 — Analysis layout shells + map overlays (~2.5 h)
- `AnalysisLayout`: full-bleed map + `TopBar` + `RightSidebar` (collapsible icon rail) + `BottomBar` (collapsible tabs).
- `RightSidebar` items rendered from `sidebar-items.ts`; only `Sample` renders a real pane in v2; others render a "Coming soon" placeholder.
- `BottomBar` tabs: Crop info (real metadata + sowing date placeholder), Chart (placeholder until Phase 7), Activities (empty list).
- Map overlays as absolute-positioned children of `MapView` per the position table in [Section 2](#2-field-analysis-screen-anatomy).

**Verify:** Visual regression vs the two reference screenshots — sidebar, bottom bar, all overlay positions land correctly. NDVI not yet wired.

### Phase 6 — Layer 4 (NDVI) + DateTimeline interactivity (~2 h)
- `POST /api/eosda/scenes` reads cache first; on miss/stale/force-refresh, EOSDA Search then upsert. This route is the source of available Sentinel-2 timeline dates.
- `useEosdaScenes(fieldId)` feeds `DateTimeline`.
- Default to the newest scene with cloud < 30 % when one exists; otherwise select the newest scene and mark it cloudy in the timeline.
- `GET /api/eosda/render/:z/:x/:y?fieldId=...&viewId=...&band=NDVI` proxy with private 24 h Cache-Control; upstream URL is EOSDA `/api/render/<view_id>/<band>/<z>/<x>/<y>` plus that field's `cropper_ref` when present.
- `NdviLayer` adds MapLibre `raster` source via the proxied URL; opacity from Zustand (default 0.75).
- Date click → updates Zustand selected `viewId` → `NdviLayer` swaps source.
- `IndexSwitcher` toggles NDVI / EVI / NDWI.

**Verify:** Open a Karnataka field — NDVI appears after scenes and tiles load; clicking different dates changes the heatmap; cloudy dates marked with a cloud icon; opacity slider works.

### Phase 7 — Stats + Chart tab (~1.5 h)
- `POST /api/eosda/stats` cache-first against `cached_ndvi_stats`; on miss, create EOSDA `mt_stats` task for up to three indices, poll for completion, then upsert all returned scenes.
- `useEosdaStats(fieldId, ['NDVI', 'EVI', 'NDWI'])`.
- Render mean / p10 / p90 / median plus cloud/data-coverage confidence in `Sample` pane with color coding.
- Chart tab in BottomBar: recharts line of mean NDVI across cached scenes.

**Verify:** Realistic numbers (Rabi wheat in Feb ≈ 0.65); chart shows variation; high-cloud or low-coverage scenes are visibly de-emphasized.

### Phase 8 — Polish + verification (~1.5 h)
- Loading skeletons + error toasts (`<Sonner>`) for every API call.
- "Polygon too large" / "outside India" inline form errors.
- Field rename + delete from dashboard with confirm dialog.
- API smoke tests for health, auth rejection, and field ownership filtering.
- Test on three EOSDA-friendly demo fields (see [Section 7](#7-verification--testing)).
- README with `pnpm install && docker compose up -d && pnpm dev`.

**Verify:** End-to-end checklist below passes.

**Total prototype budget:** ~13 hours of focused work, excluding EOSDA account activation delays.

---

## 5. Cost Summary

| Component | Provider | Prototype | MVP scale (100 users) |
|---|---|---|---|
| Layers 1+2 | ArcGIS | $0 free tier | $0 likely |
| Layer 4 | EOSDA | $0 if trial/quota approved | Contact EOSDA |
| Auth | Clerk | $0 free tier | $0 (≤10K MAU) |
| DB | Postgres+PostGIS local | $0 | $20–50/mo (Neon/Supabase) |
| Backend hosting | local | $0 | $5–20/mo (Fly.io / Render) |
| **Total** | | **$0** | **$25–70/mo + EOSDA** |

---

## 6. Risks & Gotchas

### EOSDA-specific
1. **Trial activation is manual.** Email at the start of Phase 0.
2. **Account quotas vary.** Cache aggressively in Postgres + TanStack Query and confirm limits in the EOSDA dashboard.
3. **Search is the timeline source.** EOSDA Search returns the available Sentinel-2 `date` + `view_id` pairs for a polygon. It still requires a date range, so use a configurable recent window for the timeline instead of generating fixed dates in the UI.
4. **`view_id` is required for tiles and contains slashes.** Always Search → Render, and pass `viewId` through the app proxy as a query param.
5. **Clipped render tiles need `cropper_ref`.** Store one Render Cropper `cropper_ref` per field geometry; otherwise the NDVI raster is scene-wide. Do not confuse this with EOSDA Field Management `field_id`, which is a separate reusable-AOI workflow.
6. **Statistics are async.** `mt_stats` creates a task, then the API must poll for results. Recommended date ranges are <=365 days, and only up to 3 indices should be requested at once.
7. **Polygon size limit 200 km² is an app guardrail.** Validate frontend + backend and confirm any account-specific EOSDA limits before widening it.

### MapLibre-specific
1. **Layer order is critical.** Use `beforeId` when inserting dynamic layers.
2. **Don't init twice.** StrictMode in dev double-runs `useEffect` — guard with `mapRef.current`.
3. **`map.isStyleLoaded()` check.** Wait for style before adding sources.

### Postgres + PostGIS
1. **Don't forget the `pgcrypto` extension.** Required for `gen_random_uuid()`.
2. **Generated `area_hectares` column requires Postgres 12+.** Postgres 17 in Docker is fine.
3. **GiST index on `geometry`** is essential if you later add nearby-field queries.

### Auth
1. **Clerk Fastify uses `clerkPlugin()` + `getAuth()`.** `CLERK_SECRET_KEY` is the required backend secret for this plan.
2. **Local dev redirect URL** must exactly match what's in the Clerk dashboard.

### Production-readiness
1. Don't expose the EOSDA key. The proxy is non-negotiable.
2. Restrict the ArcGIS key to your domains.
3. Use `wrangler secret`-style secret management in prod, not `.env` files.

---

## 7. Verification & Testing

### Per-phase verification
Each phase has its own block (see [Section 4](#4-implementation-phases)). Don't skip.

### End-to-end demo checklist
After Phase 8, this must pass cold from `pnpm install && docker compose up -d && pnpm dev`. Also run `pnpm lint`, `pnpm test`, and `pnpm build` before calling the prototype done.

- [ ] Visit `http://localhost:5173` → redirected to `/sign-in` → Clerk login.
- [ ] Land on dashboard with empty state → click "+" → `/fields/new`.
- [ ] Map loads Karnataka satellite + labels at zoom 8.
- [ ] Draw a polygon over a Mandya rice field (4+ points, double-click closes).
- [ ] Fill form: name "Mandya plot 1", crop Rice, season Kharif, village/district/state.
- [ ] "Create Field" enables; click → POST returns in <300 ms → redirect to `/fields/:id`.
- [ ] Analysis screen shows top bar, sidebar shell, bottom-bar shell, full-screen map with the field outlined.
- [ ] NDVI heatmap appears after scenes load; date timeline shows available dates; latest non-cloudy is selected.
- [ ] Clicking a different date updates NDVI; switching the index dropdown switches to EVI; opacity slider works.
- [ ] Sample sidebar pane shows mean / p10 / p90 / median with realistic values after stats complete; Chart tab shows the NDVI line.
- [ ] Back to dashboard → field appears with correct area in hectares.
- [ ] Delete the field → cascade removes cached scenes/stats.
- [ ] Network tab shows zero direct EOSDA calls — every request hits `/api/...`.

### Test fields for demo (Karnataka-first)
| Region | Coords (lon, lat) | Why test it | Best date |
|---|---|---|---|
| Mandya, Karnataka | `76.90, 12.52` | Cauvery basin rice paddy | Aug–Oct |
| Belagavi, Karnataka | `74.50, 15.85` | Sugarcane belt | Year-round |
| Hassan, Karnataka | `75.70, 13.20` | Coffee belt — Western Ghats | Nov–Feb |
| Ludhiana, Punjab | `75.85, 30.90` | Clean rabi wheat signal | Feb–Mar |
| Tirunelveli, Tamil Nadu | `77.17, 8.50` | Tropical rice | Jan–Mar |

---

## 8. Out of Scope

| Feature | When |
|---|---|
| Functional sidebar items beyond Sample (Weather, VRA maps, Scout tasks, AI assistant, Marketplace) | Future MVP phases |
| Sentinel-1 dpRVI / radar layers | After NDVI works |
| BullMQ + Redis background queue | Only if rate limits force it |
| Advanced per-pixel analytics beyond EOSDA `cropper_ref` clipping | Polish |
| Push notifications | Future |
| Multi-language (Hindi etc.) | Future |
| Mobile responsive layout | Future |
| Full browser E2E suite and CI matrix | Productisation |
| CI/CD deployment pipeline | Productisation |
| Crop yield estimation, pest/disease alerts | Advanced |

---

## 9. References

### Official documentation
| Resource | URL |
|---|---|
| ArcGIS Location Platform pricing | https://location.arcgis.com/pricing/ |
| ArcGIS basemap styles reference | https://developers.arcgis.com/rest/basemap-styles/ |
| ArcGIS MapLibre quickstart | https://developers.arcgis.com/maplibre-gl-js/get-started/ |
| EOSDA API Connect docs | https://doc.eos.com/ |
| EOSDA Quickstart | https://doc.eos.com/docs/quickstart/ |
| EOSDA Search API | https://doc.eos.com/docs/search/simple-search/ |
| EOSDA Render API | https://doc.eos.com/docs/render/ |
| EOSDA Statistics API | https://doc.eos.com/docs/statistics/vegetation-indices-analytics/ |
| MapLibre GL JS | https://maplibre.org/maplibre-gl-js/docs |
| MapLibre `addLayer` API | https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#addlayer |
| @esri/maplibre-arcgis | https://github.com/Esri/maplibre-arcgis |
| TanStack Router | https://tanstack.com/router |
| TanStack Query | https://tanstack.com/query |
| terra-draw adapter guide | https://github.com/JamesLMilner/terra-draw/blob/main/guides/3.ADAPTERS.md |
| Fastify | https://fastify.dev |
| Drizzle ORM | https://orm.drizzle.team |
| Drizzle PostGIS extension docs | https://orm.drizzle.team/docs/extensions/pg |
| PostGIS | https://postgis.net/documentation/ |
| Clerk Fastify SDK | https://clerk.com/docs/references/fastify/overview |
| shadcn/ui | https://ui.shadcn.com |

### Reference UI (visual benchmark)
- EOS Crop Monitoring: https://eos.com/products/crop-monitoring/
- The two screenshots in `input.md` are the canonical layout for `/fields/:id`.

### Test data
- Geofabrik India OSM extract: https://download.geofabrik.de/asia/india.html
- EOS LandViewer: https://eos.com/landviewer

---

## Appendix A — Decision Log

| Decision | Date | Rationale |
|---|---|---|
| Layer 3 ↔ Layer 4 swap | May 2026 | EOSDA is per-polygon, not a global background |
| Backend: Fastify on Node | May 2026 | User wants Node; Fastify is fastest TS-native option |
| Database: Postgres+PostGIS from day 1 | May 2026 | Polygons + metadata persist properly; localStorage rejected |
| ORM: Drizzle | May 2026 | TS inference plus PostGIS geometry support; raw SQL helpers handle polygon GeoJSON boundaries |
| Local DB: Docker Compose | May 2026 | Portable, version-controlled, matches prod |
| Auth: Clerk | May 2026 | Fastest hosted-auth path; user picked "add basic auth now" |
| Default region: Karnataka | May 2026 | User-specified focus; Punjab moves to demo-fields list |
| Sidebar/bottom-bar are shells; controls are map overlays | May 2026 | Date timeline goes on the map per user instruction |
| Async warm on Create, no job queue | May 2026 | Snappy UX without BullMQ overhead at prototype scale |
| Frontend: Vite + TanStack Router | May 2026 | No SSR benefit for WebGL maps; Router is mature 1.x |
| Layers 1+2: ArcGIS via @esri/maplibre-arcgis | May 2026 | Official MapLibre plugin; require basemap token, verify imagery label layers, and account for full style replacement during Phase 2 |
| State: TanStack Query + Zustand | May 2026 | Server vs client state separation; rate-limit caching critical; use selectors to avoid map re-renders from form/UI state |
| EOSDA proxy contract corrected | May 2026 | Official docs require Search → Render by `view_id`; Statistics is async `mt_stats`; render route uses query params because `view_id` contains slashes |

---

*End of implementation plan. See [architecture.md](./architecture.md) for technical architecture details. Update this document as decisions evolve.*
