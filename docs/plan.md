# viz-crop — Complete Implementation Plan

> A crop monitoring web application tailored for India. Single source of truth for architecture, tech stack, and phased build.

**Document version:** 2.0
**Last updated:** May 2026
**Status:** Implementation-ready

---

## Quick Reference

| Decision | Choice | Reasoning |
|---|---|---|
| Monorepo | pnpm workspaces | Two apps + one shared package |
| Frontend | Vite + React + TypeScript | Fast dev, no SSR overhead for a WebGL map |
| Routing | TanStack Router | Type-safe routes, mature 1.x |
| Server state | TanStack Query | Caching + dedupe for EOSDA rate limits |
| Client state | Zustand | Simple, no boilerplate |
| Map | MapLibre GL JS | Open source, WebGL |
| Basemap plugin | `@esri/maplibre-arcgis` | Official Esri MapLibre integration |
| Drawing | terra-draw + maplibre adapter | TypeScript-first |
| Geometry helpers | `@turf/turf` | Bbox, area, simplification |
| Styling | Tailwind CSS + shadcn/ui | Rapid prototyping; shadcn for sidebar/dialog/form primitives |
| Charts | recharts | NDVI sparkline |
| Backend framework | **Fastify (Node 20+)** | Fast TS-native proxy + CRUD |
| Database | **PostgreSQL 17 + PostGIS 3** | Spatial queries on field polygons |
| ORM | **Drizzle ORM** | Best PostGIS support + TS inference |
| Local DB | **Docker Compose** (`postgis/postgis:17-3.5`) | Portable, version-controlled |
| Auth | **Clerk** | Hosted; React + Fastify SDKs |
| Layer 1+2 | ArcGIS Location Platform | Satellite + labels (free tier) |
| Layer 3 | Your app + GeoJSON | User-drawn field polygon |
| Layer 4 | EOSDA API Connect | Sentinel-2 NDVI tiles for the polygon |

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [The Four-Layer Map Stack (corrected order)](#2-the-four-layer-map-stack-corrected-order)
3. [User Flow & Routes](#3-user-flow--routes)
4. [Field Analysis Screen Anatomy](#4-field-analysis-screen-anatomy)
5. [Complete Tech Stack](#5-complete-tech-stack)
6. [Project Structure (monorepo)](#6-project-structure-monorepo)
7. [Database Schema](#7-database-schema)
8. [API Surface](#8-api-surface)
9. [Component Architecture](#9-component-architecture)
10. [Data Flow](#10-data-flow)
11. [External Account Setup](#11-external-account-setup)
12. [Implementation Phases](#12-implementation-phases)
13. [Security Considerations](#13-security-considerations)
14. [Cost Summary](#14-cost-summary)
15. [Risks & Gotchas](#15-risks--gotchas)
16. [Verification & Testing](#16-verification--testing)
17. [Out of Scope](#17-out-of-scope)
18. [References](#18-references)
19. [Appendix A — Decision Log](#appendix-a--decision-log)
20. [Appendix B — Glossary](#appendix-b--glossary)

---

## 1. Architecture Overview

viz-crop is a single-page React web app backed by a Node.js (Fastify) proxy and a PostgreSQL + PostGIS database. The proxy hides the EOSDA API key and persists field polygons; the SPA renders MapLibre with three external map/imagery services.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         BROWSER (React SPA)                         │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    MapLibre GL JS canvas                     │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌──────────┐  │   │
│  │  │ Layer 1  │  │ Layer 2  │  │  Layer 3     │  │ Layer 4  │  │   │
│  │  │ Esri sat │  │ Esri lbl │  │ Field GeoJSON│  │ EOSDA    │  │   │
│  │  │ (raster) │  │ (raster) │  │ (terra-draw) │  │ NDVI XYZ │  │   │
│  │  └──────────┘  └──────────┘  └──────────────┘  └──────────┘  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  TanStack Router • TanStack Query • Zustand • Tailwind • Clerk      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTPS  (no EOSDA key here)
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│                     BACKEND (Fastify on Node 20)                    │
│  • /api/fields              CRUD on Postgres (Drizzle + PostGIS)    │
│  • /api/eosda/scenes        cache-first proxy → EOSDA Search        │
│  • /api/eosda/stats         cache-first proxy → EOSDA Statistics    │
│  • /api/eosda/render/...    tile proxy (24 h Cache-Control)         │
│  • Clerk JWT verification on every /api/* route                     │
│  • field-warmup service: async EOSDA Search on field create         │
└─────────────────────────────────────────────────────────────────────┘
              │                                       │
              ↓                                       ↓
┌─────────────────────────────────┐   ┌───────────────────────────────┐
│  PostgreSQL 17 + PostGIS 3      │   │  EOSDA API Connect            │
│  ─────────────────────────      │   │  ─────────────────────────    │
│  • fields                       │   │  • Search API                 │
│  • cached_scenes                │   │  • Render API (XYZ)           │
│  • cached_ndvi_stats            │   │  • Statistics API             │
│  • Docker Compose (local)       │   │  • Trial: 1K requests         │
└─────────────────────────────────┘   └───────────────────────────────┘
                                                      │
                                                      ↓
                                      ┌───────────────────────────────┐
                                      │  ArcGIS Location Platform     │
                                      │  ─────────────────────────    │
                                      │  • arcgis/imagery basemap     │
                                      │  • Direct from browser        │
                                      │  • Free tier sufficient       │
                                      └───────────────────────────────┘
```

### Why this architecture

- **Thin Fastify proxy + DB** — keeps EOSDA key server-side, persists fields, and centralises caching against the EOSDA rate limit.
- **Drizzle + PostGIS** — first-class TypeScript inference *and* full spatial query support (Prisma's PostGIS support is still weak).
- **Async warm-up, not job queue** — at prototype scale BullMQ/Redis is overkill. `void warmField(id)` after the insert is enough.
- **Direct ArcGIS calls from browser** — Esri keys are domain-restricted; designed for browser exposure.

---

## 2. The Four-Layer Map Stack (corrected order)

| # | Layer | Source | Loaded when | Library |
|---|---|---|---|---|
| 1 | Satellite imagery | ArcGIS `arcgis/imagery` (Maxar Vivid) | App start | MapLibre + `@esri/maplibre-arcgis` |
| 2 | Roads + place labels | Bundled in `arcgis/imagery` | App start | same as Layer 1 |
| 3 | **Field polygon (user-drawn)** | terra-draw → MapLibre `geojson` source | Create flow + Analysis screen | terra-draw + adapter |
| 4 | **EOSDA NDVI overlay** | EOSDA Render API XYZ tiles | Analysis screen, *after* polygon exists | MapLibre `raster` source |

Stacking order from bottom to top in MapLibre:

```
satellite → labels → NDVI raster (opacity ~0.85) → field fill (transparent) → field outline (white)
```

NDVI sits *above* labels but *below* the field outline so the polygon edge stays sharp. Use `beforeId` when inserting dynamic layers.

---

## 3. User Flow & Routes

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
See [Section 4](#4-field-analysis-screen-anatomy) for the full anatomy.

---

## 4. Field Analysis Screen Anatomy

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
- Smaller: p10 / p90 (hidden if pixel_count < 30, with a "low confidence" note)
- Pixel count line
- Mini histogram of NDVI value distribution

---

## 5. Complete Tech Stack

### Frontend dependencies
| Package | Purpose |
|---|---|
| `react`, `react-dom`, `typescript`, `vite`, `@vitejs/plugin-react` | Core |
| `@tanstack/react-router` + `router-devtools` | Routing |
| `@tanstack/react-query` + `query-devtools` | Server state |
| `zustand` | Client state |
| `maplibre-gl` | Map renderer |
| `@esri/maplibre-arcgis` | Esri basemap plugin |
| `terra-draw`, `terra-draw-maplibre-gl-adapter` | Polygon drawing |
| `@turf/turf` | Geometry helpers |
| `date-fns` | Date utilities |
| `tailwindcss`, `@tailwindcss/postcss` | Styling |
| `lucide-react` | Icons (matches the screenshot's icon style) |
| `recharts` | Sparkline + chart tab |
| `zod` | Runtime validation (from `packages/shared`) |
| `@clerk/clerk-react` | Auth UI + JWT in browser |
| shadcn primitives | Button, Form, Dialog, Sheet, Tabs, Tooltip, Toaster, Sonner, Select, Slider |

### Backend dependencies
| Package | Purpose |
|---|---|
| `fastify` | Web framework |
| `@fastify/cors` | CORS |
| `@fastify/sensible` | HTTP errors |
| `@fastify/swagger` + `@fastify/swagger-ui` | OpenAPI for `/docs` (dev only) |
| `@clerk/fastify` | Clerk JWT verification middleware |
| `drizzle-orm`, `drizzle-kit` | ORM + migrations |
| `pg` | Postgres driver |
| `zod` | Validation |
| `pino-pretty` | Dev logger |
| `tsx` | TS runner (dev) |

### Shared
| Package | Purpose |
|---|---|
| `zod` | Schemas re-used by web and api |

### External services
| Service | Role | Cost |
|---|---|---|
| ArcGIS Location Platform | Satellite + labels | Free: 1K sessions or 2M tiles/mo |
| EOSDA API Connect | NDVI tiles + stats | Free trial: 1K requests |
| Clerk | Auth | Free: 10K MAU |
| PostgreSQL + PostGIS (local) | Storage | $0 (Docker) |

---

## 6. Project Structure (monorepo)

```
agri-app/
├── apps/
│   ├── web/                              # Vite + React frontend
│   │   ├── public/
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── routes/
│   │   │   │   ├── __root.tsx            # ClerkProvider + QueryClientProvider
│   │   │   │   ├── sign-in.tsx
│   │   │   │   └── _auth/                # auth-gated layout
│   │   │   │       ├── route.tsx         # redirect to /sign-in if not authed
│   │   │   │       ├── index.tsx         # / — dashboard
│   │   │   │       ├── fields.new.tsx    # /fields/new
│   │   │   │       └── fields.$id.tsx    # /fields/:id
│   │   │   ├── layouts/
│   │   │   │   ├── DashboardLayout.tsx
│   │   │   │   ├── CreateLayout.tsx      # 2-col map + form
│   │   │   │   └── AnalysisLayout.tsx    # full map + sidebar/bottom-bar shells
│   │   │   ├── components/
│   │   │   │   ├── map/
│   │   │   │   │   ├── MapView.tsx
│   │   │   │   │   ├── BasemapLayer.tsx          # Layers 1+2
│   │   │   │   │   ├── FieldLayer.tsx            # Layer 3
│   │   │   │   │   ├── NdviLayer.tsx             # Layer 4
│   │   │   │   │   ├── DrawControl.tsx           # terra-draw integration
│   │   │   │   │   └── overlays/
│   │   │   │   │       ├── IndexSwitcher.tsx
│   │   │   │   │       ├── SourceSwitcher.tsx
│   │   │   │   │       ├── OpacitySlider.tsx
│   │   │   │   │       ├── DownloadButton.tsx
│   │   │   │   │       ├── FullscreenButton.tsx
│   │   │   │   │       ├── DateTimeline.tsx
│   │   │   │   │       ├── CoordsBadge.tsx
│   │   │   │   │       ├── ScaleBar.tsx
│   │   │   │   │       ├── ZoomControls.tsx
│   │   │   │   │       └── CloudHiddenToast.tsx
│   │   │   │   ├── shell/
│   │   │   │   │   ├── TopBar.tsx
│   │   │   │   │   ├── RightSidebar.tsx
│   │   │   │   │   ├── BottomBar.tsx
│   │   │   │   │   └── sidebar-items.ts          # config array
│   │   │   │   ├── forms/
│   │   │   │   │   └── CreateFieldForm.tsx
│   │   │   │   ├── dashboard/
│   │   │   │   │   ├── FieldList.tsx
│   │   │   │   │   ├── FieldCard.tsx
│   │   │   │   │   └── EmptyState.tsx
│   │   │   │   └── ui/                            # shadcn primitives
│   │   │   ├── hooks/
│   │   │   │   ├── useFields.ts                  # CRUD via /api/fields
│   │   │   │   ├── useFieldDrawing.ts            # terra-draw + Zustand
│   │   │   │   ├── useEosdaScenes.ts             # /api/eosda/scenes
│   │   │   │   ├── useEosdaStats.ts              # /api/eosda/stats
│   │   │   │   └── useMapInstance.ts             # MapLibre ref management
│   │   │   ├── lib/
│   │   │   │   ├── api.ts                        # fetch wrapper, attaches Clerk JWT
│   │   │   │   ├── eosda.ts                      # tile URL builder
│   │   │   │   ├── arcgis.ts                     # plugin setup
│   │   │   │   └── geometry.ts                   # Turf wrappers (area, bbox, validate)
│   │   │   ├── stores/
│   │   │   │   ├── useFieldStore.ts              # current field, draft polygon
│   │   │   │   └── useUiStore.ts                 # selected viewId, index, opacity, sidebar item
│   │   │   ├── styles/globals.css
│   │   │   └── env.ts
│   │   ├── .env.example
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   └── tailwind.config.ts
│   │
│   └── api/                              # Fastify backend
│       ├── src/
│       │   ├── server.ts                          # bootstrap
│       │   ├── env.ts                             # zod-validated env
│       │   ├── plugins/
│       │   │   ├── auth.ts                        # Clerk JWT verification
│       │   │   ├── db.ts                          # Drizzle client decoration
│       │   │   ├── cors.ts
│       │   │   └── swagger.ts                     # dev only
│       │   ├── routes/
│       │   │   ├── health.ts
│       │   │   ├── fields.ts
│       │   │   ├── eosda.scenes.ts
│       │   │   ├── eosda.stats.ts
│       │   │   └── eosda.render.ts
│       │   ├── services/
│       │   │   ├── eosda-client.ts                # fetch wrapper, key injection
│       │   │   ├── ndvi-cache.ts                  # cached_scenes & cached_ndvi_stats
│       │   │   └── field-warmup.ts                # async post-create warm
│       │   └── db/
│       │       ├── client.ts
│       │       ├── schema.ts
│       │       └── migrations/
│       ├── drizzle.config.ts
│       ├── .env.example
│       └── package.json
│
├── packages/
│   └── shared/
│       ├── src/
│       │   ├── field.ts                           # CreateFieldDto, FieldDto, etc.
│       │   ├── eosda.ts                           # SceneDto, NdviStatsDto
│       │   └── common.ts                          # Polygon GeoJSON zod
│       └── package.json
│
├── docker-compose.yml                    # postgis/postgis:17-3.5
├── pnpm-workspace.yaml
├── package.json                          # workspace root
├── .env.example
├── README.md
└── docs/
    └── viz-crop-implementation-plan_v2.md
```

---

## 7. Database Schema

```sql
-- initial migration
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE fields (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,                              -- Clerk user id
  name            VARCHAR(120) NOT NULL,
  crop_type       VARCHAR(40)  NOT NULL,
  season          VARCHAR(20)  NOT NULL,                      -- Kharif|Rabi|Zaid|Annual
  farmer_name     VARCHAR(120),
  village         VARCHAR(120),
  district        VARCHAR(120),
  state           VARCHAR(120),
  geometry        GEOMETRY(Polygon, 4326) NOT NULL,
  area_hectares   NUMERIC(10,2) GENERATED ALWAYS AS
                  (ST_Area(geometry::geography) / 10000) STORED,
  sowing_date     DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fields_user_idx ON fields (user_id);
CREATE INDEX fields_geom_gix ON fields USING GIST (geometry);

CREATE TABLE cached_scenes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id        UUID NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  view_id         TEXT NOT NULL,
  source          VARCHAR(20) NOT NULL DEFAULT 'sentinel-2',
  scene_date      DATE NOT NULL,
  cloud_percent   NUMERIC(5,2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (field_id, view_id)
);
CREATE INDEX cached_scenes_field_date_idx ON cached_scenes (field_id, scene_date DESC);

CREATE TABLE cached_ndvi_stats (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id        UUID NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  view_id         TEXT NOT NULL,
  index_name      VARCHAR(20) NOT NULL DEFAULT 'NDVI',
  mean            NUMERIC(6,4),
  p10             NUMERIC(6,4),
  p90             NUMERIC(6,4),
  median          NUMERIC(6,4),
  pixel_count     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (field_id, view_id, index_name)
);
```

`area_hectares` is a generated PostGIS column — never compute on the client.

### Drizzle representation (sketch)
```ts
import { pgTable, uuid, text, varchar, numeric, timestamp, date, integer, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { geometry } from 'drizzle-orm/pg-core/columns/geometry' // via custom type
import { sql } from 'drizzle-orm'

export const fields = pgTable('fields', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  cropType: varchar('crop_type', { length: 40 }).notNull(),
  season: varchar('season', { length: 20 }).notNull(),
  farmerName: varchar('farmer_name', { length: 120 }),
  village: varchar('village', { length: 120 }),
  district: varchar('district', { length: 120 }),
  state: varchar('state', { length: 120 }),
  geometry: geometry('geometry', { type: 'Polygon', srid: 4326 }).notNull(),
  areaHectares: numeric('area_hectares').generatedAlwaysAs(sql`ST_Area(geometry::geography) / 10000`),
  sowingDate: date('sowing_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('fields_user_idx').on(t.userId),
  geomIdx: index('fields_geom_gix').using('gist', t.geometry),
}))
```

---

## 8. API Surface

All `/api/*` routes (except `/api/health`) require Clerk JWT verification (`@clerk/fastify`). User-scoped queries filter on `auth.userId`.

| Method | Path | Body / params | Behavior |
|---|---|---|---|
| GET  | `/api/health` | – | Liveness |
| GET  | `/api/fields` | – | List fields for current user |
| POST | `/api/fields` | `CreateFieldDto` | Insert; kick off `void warmField(id)`; return `{id}` |
| GET  | `/api/fields/:id` | – | Single field (404 if not yours) |
| PATCH| `/api/fields/:id` | `UpdateFieldDto` | Rename / edit metadata |
| DELETE| `/api/fields/:id` | – | Hard delete; cascades cache |
| POST | `/api/eosda/scenes` | `{fieldId, dateRange?}` | Cache-first against `cached_scenes`; on miss, EOSDA Search → upsert |
| POST | `/api/eosda/stats` | `{fieldId, viewId, index}` | Cache-first against `cached_ndvi_stats`; on miss, EOSDA Stats → upsert |
| GET  | `/api/eosda/render/:viewId/:index/:z/:x/:y` | – | Tile proxy, sets `Cache-Control: public, max-age=86400` |

`CreateFieldDto` (zod, in `packages/shared`):
```ts
{
  name: string (min 1, max 120),
  cropType: enum [Rice, Wheat, Cotton, Sugarcane, Maize, Soybean, Pulses, Groundnut, Mustard, Jowar],
  season: enum [Kharif, Rabi, Zaid, Annual],
  farmerName?: string,
  village?: string,
  district?: string,
  state?: string,
  geometry: GeoJSON Polygon (validated: closed ring, area ∈ [0.05 ha, 200 km²], inside India bbox)
}
```

---

## 9. Component Architecture

### Models — `packages/shared/src/`
- `Field`, `CreateFieldDto`, `UpdateFieldDto`
- `Scene` (`viewId`, `date`, `cloud`)
- `NdviStats` (`mean`, `p10`, `p90`, `median`, `pixelCount`)
- `PolygonGeoJson`

### Views — `apps/web/src/components/`
- `MapView` + `BasemapLayer` + `FieldLayer` + `NdviLayer` + `DrawControl` + `overlays/*`
- `TopBar`, `RightSidebar`, `BottomBar`
- `CreateFieldForm`
- `FieldList`, `FieldCard`, `EmptyState`

### Controllers — `apps/web/src/hooks/`
- `useMapInstance` — manages MapLibre ref; StrictMode-safe single-init.
- `useFieldDrawing` — wraps terra-draw lifecycle; writes draft polygon to Zustand.
- `useFields` — TanStack Query hooks for list / get / create / update / delete.
- `useEosdaScenes(fieldId)` — fetches scene list (cache 1 h).
- `useEosdaStats(fieldId, viewId)` — fetches per-scene stats (cache 1 h).

### State management split
| State type | Where | Examples |
|---|---|---|
| Server state | TanStack Query | Fields, scenes, stats, ArcGIS config |
| Client state | Zustand | Draft polygon, selected viewId, selected index, opacity, active sidebar item, bottom bar tab |
| URL state | TanStack Router | `/fields/:id` |
| Persistent | PostgreSQL | Fields + caches |
| Auth state | Clerk | User session, JWT |

---

## 10. Data Flow

### Sequence: User creates a field then views NDVI

```
User                Web                     Fastify API           Postgres        EOSDA           ArcGIS
 │                   │                         │                    │              │                │
 │ Sign in (Clerk)   │                         │                    │              │                │
 ├──────────────────>│                         │                    │              │                │
 │                   │ GET /api/fields         │                    │              │                │
 │                   ├────────────────────────>│ SELECT fields      │              │                │
 │                   │                         ├───────────────────>│              │                │
 │                   │<───── [] (empty) ───────┤<──────────────────-┤              │                │
 │                   │ Show empty dashboard    │                    │              │                │
 │ Click "+"         │                         │                    │              │                │
 ├──────────────────>│ /fields/new             │                    │              │                │
 │                   │ Init MapLibre + ArcGIS  ├────────────────────────────────────────────────────>│
 │                   │<──── basemap tiles ─────────────────────────────────────────────────────────-┤
 │ Draw polygon      │                         │                    │              │                │
 ├──────────────────>│ terra-draw → Zustand    │                    │              │                │
 │ Fill form         │                         │                    │              │                │
 ├──────────────────>│                         │                    │              │                │
 │ Click Create      │                         │                    │              │                │
 ├──────────────────>│ POST /api/fields        │                    │              │                │
 │                   ├────────────────────────>│ INSERT fields      │              │                │
 │                   │                         ├───────────────────>│              │                │
 │                   │                         │<── id ─────────────┤              │                │
 │                   │                         │ void warmField(id) ────────────────│ POST /search   │
 │                   │<──── { id } ────────────┤                    │              │                │
 │                   │ navigate /fields/:id    │                    │<── upsert ───┤<── view_ids ───┤
 │                   │ Render AnalysisLayout   │                    │              │                │
 │                   │ POST /api/eosda/scenes  ├────────────────────│              │                │
 │                   │                         │ SELECT cached_scenes              │                │
 │                   │<── scene list ──────────┤                    │              │                │
 │                   │ DateTimeline auto-picks │                    │              │                │
 │                   │ latest non-cloudy scene │                    │              │                │
 │                   │ Add NDVI raster source: │                    │              │                │
 │                   │   /api/eosda/render/... │                    │              │                │
 │                   ├────────────────────────>│ proxy tile → EOSDA │              │                │
 │                   │<──── PNG tiles ─────────┤                    │<── PNG ──────┤                │
 │                   │ POST /api/eosda/stats   ├────────────────────│              │                │
 │                   │                         │ cache miss → EOSDA Statistics     │                │
 │                   │<── mean/p10/p90 ────────┤                    │<── stats ────┤                │
 │                   │ Render Sample sidebar   │                    │              │                │
```

### Caching strategy
| Data | Cache layer | TTL | Why |
|---|---|---|---|
| ArcGIS basemap tiles | Browser HTTP cache | (Esri sets) | Maxar imagery rarely changes |
| EOSDA scene list | Postgres `cached_scenes` + TanStack Query 1 h | per-field | Scenes are stable once published |
| EOSDA NDVI tiles | Browser HTTP cache via Fastify `Cache-Control` | 24 h | Render output is deterministic per `viewId/index/z/x/y` |
| EOSDA Stats | Postgres `cached_ndvi_stats` + TanStack Query 1 h | per-(field, viewId, index) | Stable |
| Fields | TanStack Query | 5 min | Refetch on focus |

---

## 11. External Account Setup

Do all of these **before Phase 0 starts** — two require manual approval that can take a business day.

### 1. ArcGIS Location Platform (~10 min)
- Sign up at [developers.arcgis.com](https://developers.arcgis.com), no card required.
- Create an API key scoped to **Basemaps**.
- **Restrict to your domains** (`localhost`, your prod domain).
- Save as `VITE_ESRI_API_KEY`.

### 2. EOSDA API Connect (~1 business day)
- Register at [api-connect.eos.com/user-dashboard/](https://api-connect.eos.com/user-dashboard/).
- **Email api.support@eosda.com** to activate the trial.
- Save the key as `EOSDA_API_KEY` — backend only, never the browser.

### 3. Clerk (~5 min)
- Sign up at [clerk.com](https://clerk.com).
- Create an application, copy the publishable key + secret.
- Save `VITE_CLERK_PUBLISHABLE_KEY` (web) and `CLERK_SECRET_KEY` (api).
- In the Clerk dashboard, set the redirect URL to `http://localhost:5173`.

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
CLERK_JWKS_URL=
ALLOWED_ORIGINS=http://localhost:5173
```

---

## 12. Implementation Phases

Each phase has a clear goal, tasks, and a green-or-red verification checklist. Time estimates are focused-work estimates.

### Phase 0 — Monorepo scaffold + auth shell (~1.5 h)
- Init pnpm workspaces; root `package.json` with `dev`, `build`, `lint`, `format` scripts.
- Scaffold `apps/web` (Vite + React + TS + Tailwind + shadcn init).
- Scaffold `apps/api` (Fastify + TS + tsx).
- Scaffold `packages/shared` (zod schemas).
- `docker-compose.yml` with `postgis/postgis:17-3.5`, healthcheck, named volume.
- Wire Clerk both sides; `_auth/route.tsx` redirects to `/sign-in` if unauthed.
- TanStack Router file-based routing; TanStack Query provider + devtools.

**Verify:** `docker compose up -d` brings Postgres up; `pnpm dev` runs web + api in parallel; visiting `/` while signed out redirects to `/sign-in`; signing in lands on an empty `/`.

### Phase 1 — DB + Field CRUD (~2 h)
- Add Drizzle, write `db/schema.ts`, generate initial migration enabling PostGIS.
- Implement `GET / POST / GET-one / PATCH / DELETE /api/fields` with zod validation, user-scoped queries.
- Build `useFields()` hook, dashboard `FieldList` + `FieldCard` + `EmptyState`.

**Verify:** Create a field via curl with the Clerk JWT; appears on dashboard with correct area; deleting removes it; another Clerk user sees an empty list.

### Phase 2 — Map foundation + Layers 1+2 + Karnataka default (~1 h)
- Install `maplibre-gl` + `@esri/maplibre-arcgis`.
- Build `MapView` + `useMapInstance` (StrictMode-safe).
- Apply `arcgis/imagery` style with session billing.
- Default `[75.7139, 15.3173]` zoom 8 in `CreateLayout`.

**Verify:** `/fields/new` shows Karnataka satellite + road/village labels; ESRI attribution visible.

### Phase 3 — Drawing + Layer 3 + Create form (~2 h)
- Install terra-draw + adapter; `DrawControl` lives top-right of map.
- `useFieldDrawing` hook; polygon stored in Zustand.
- MapLibre GeoJSON source: white fill at 15 %, white 2 px outline.
- Validate: closed ring, area ∈ [0.05 ha, 200 km²], inside India bbox.
- `CreateFieldForm` with shadcn `<Form>` + zod resolver. 10 Indian crops; Season as 4-option segmented control.
- "Create Field" disabled until polygon AND form valid.
- On submit: `POST /api/fields` → on 201, navigate to `/fields/:id`.

**Verify:** Draw a polygon over a Karnataka field, fill the form, submit; record appears on dashboard with correct area; invalid polygons show inline error.

### Phase 4 — Background EOSDA warm-up (~1 h)
- `services/eosda-client.ts` — fetch wrapper, `EOSDA_API_KEY` injection, error mapping.
- `services/field-warmup.ts` — `void warmField(id)` called from `POST /api/fields` after the insert (no `await`). Calls EOSDA Search for the polygon over the last 6 months and upserts to `cached_scenes`. Errors are logged, never propagated.

**Verify:** Create a field; `cached_scenes` populates within ~3 s; the POST itself returns in <300 ms; if EOSDA fails the create still succeeds.

### Phase 5 — Analysis layout shells + map overlays (~2.5 h)
- `AnalysisLayout`: full-bleed map + `TopBar` + `RightSidebar` (collapsible icon rail) + `BottomBar` (collapsible tabs).
- `RightSidebar` items rendered from `sidebar-items.ts`; only `Sample` renders a real pane in v2; others render a "Coming soon" placeholder.
- `BottomBar` tabs: Crop info (real metadata + sowing date placeholder), Chart (placeholder until Phase 7), Activities (empty list).
- Map overlays as absolute-positioned children of `MapView` per the position table in [Section 4](#4-field-analysis-screen-anatomy).

**Verify:** Visual regression vs the two reference screenshots — sidebar, bottom bar, all overlay positions land correctly. NDVI not yet wired.

### Phase 6 — Layer 4 (NDVI) + DateTimeline interactivity (~2 h)
- `POST /api/eosda/scenes` reads cache first; on miss, EOSDA Search then upsert.
- `useEosdaScenes(fieldId)` feeds `DateTimeline`.
- Default to most recent scene with cloud < 30 %.
- `GET /api/eosda/render/...` proxy with 24 h Cache-Control.
- `NdviLayer` adds MapLibre `raster` source via the proxied URL; opacity from Zustand (default 0.85).
- Date click → updates Zustand selected `viewId` → `NdviLayer` swaps source.
- `IndexSwitcher` toggles NDVI / EVI / NDWI.

**Verify:** Open a Karnataka field — NDVI appears within ~2 s; clicking different dates changes the heatmap; cloudy dates marked with a cloud icon; opacity slider works.

### Phase 7 — Stats + Chart tab (~1.5 h)
- `POST /api/eosda/stats` cache-first against `cached_ndvi_stats`.
- `useEosdaStats(fieldId, viewId)`.
- Render mean / p10 / p90 / pixel-count in `Sample` pane with color coding.
- Chart tab in BottomBar: recharts line of mean NDVI across cached scenes.

**Verify:** Realistic numbers (Rabi wheat in Feb ≈ 0.65); chart shows variation; small fields hide percentiles.

### Phase 8 — Polish + verification (~1.5 h)
- Loading skeletons + error toasts (`<Sonner>`) for every API call.
- "Polygon too large" / "outside India" inline form errors.
- Field rename + delete from dashboard with confirm dialog.
- Test on three EOSDA-friendly demo fields (see [Section 16](#16-verification--testing)).
- README with `pnpm install && docker compose up -d && pnpm dev`.

**Verify:** End-to-end checklist below passes.

**Total prototype budget:** ~13 hours of focused work.

---

## 13. Security Considerations

### API key management
| Key | Where | Risk |
|---|---|---|
| ArcGIS API key | Browser (`.env`) | Low — domain-restricted |
| Clerk publishable key | Browser | Low — designed for browser |
| Clerk secret key | API only | High if leaked |
| EOSDA API key | API only | High — exposes paid quota |
| Postgres password | API only / `docker-compose` | Medium |

### Domain restrictions
- ArcGIS: restrict to `localhost`, prod domain.
- Clerk: configure allowed redirect URLs.
- EOSDA: cannot be domain-restricted; must be proxied.

### CORS
Fastify CORS allows only `ALLOWED_ORIGINS` (comma-separated env). For local dev: `http://localhost:5173`.

### Input validation
- Validate polygon GeoJSON server-side (closed ring, area, India bbox).
- Reject polygons > 200 km² (EOSDA limit).
- All API bodies parsed by zod schemas from `packages/shared`.

### Rate limiting
- EOSDA default 10 req/min — server-side debounce + cache absorb most calls.
- Add a Fastify rate-limit plugin if scaling beyond demo (out of scope for v2).

### Auth
- Every `/api/*` route (except `/api/health`) requires a verified Clerk JWT.
- `userId` from the JWT is the only source of truth for ownership filters.

---

## 14. Cost Summary

| Component | Provider | Prototype | MVP scale (100 users) |
|---|---|---|---|
| Layers 1+2 | ArcGIS | $0 free tier | $0 likely |
| Layer 4 | EOSDA | $0 (1K trial) | Contact EOSDA |
| Auth | Clerk | $0 free tier | $0 (≤10K MAU) |
| DB | Postgres+PostGIS local | $0 | $20–50/mo (Neon/Supabase) |
| Backend hosting | local | $0 | $5–20/mo (Fly.io / Render) |
| **Total** | | **$0** | **$25–70/mo + EOSDA** |

---

## 15. Risks & Gotchas

### EOSDA-specific
1. **Trial activation is manual.** Email at the start of Phase 0.
2. **10 req/min default.** Cache aggressively in Postgres + TanStack Query.
3. **`view_id` is required for tiles.** Always Search → Render.
4. **Polygon size limit 200 km².** Validate frontend + backend.

### MapLibre-specific
1. **Layer order is critical.** Use `beforeId` when inserting dynamic layers.
2. **Don't init twice.** StrictMode in dev double-runs `useEffect` — guard with `mapRef.current`.
3. **`map.isStyleLoaded()` check.** Wait for style before adding sources.

### Postgres + PostGIS
1. **Don't forget the `pgcrypto` extension.** Required for `gen_random_uuid()`.
2. **Generated `area_hectares` column requires Postgres 12+.** Postgres 17 in Docker is fine.
3. **GiST index on `geometry`** is essential if you later add nearby-field queries.

### Auth
1. **Clerk JWT verification needs the JWKS URL** in `CLERK_JWKS_URL`.
2. **Local dev redirect URL** must exactly match what's in the Clerk dashboard.

### Production-readiness
1. Don't expose the EOSDA key. The proxy is non-negotiable.
2. Restrict the ArcGIS key to your domains.
3. Use `wrangler secret`-style secret management in prod, not `.env` files.

---

## 16. Verification & Testing

### Per-phase verification
Each phase has its own block (see [Section 12](#12-implementation-phases)). Don't skip.

### End-to-end demo checklist
After Phase 8, this must pass cold from `pnpm install && docker compose up -d && pnpm dev`:

- [ ] Visit `http://localhost:5173` → redirected to `/sign-in` → Clerk login.
- [ ] Land on dashboard with empty state → click "+" → `/fields/new`.
- [ ] Map loads Karnataka satellite + labels at zoom 8.
- [ ] Draw a polygon over a Mandya rice field (4+ points, double-click closes).
- [ ] Fill form: name "Mandya plot 1", crop Rice, season Kharif, village/district/state.
- [ ] "Create Field" enables; click → POST returns in <300 ms → redirect to `/fields/:id`.
- [ ] Analysis screen shows top bar, sidebar shell, bottom-bar shell, full-screen map with the field outlined.
- [ ] Within ~2 s, NDVI heatmap appears; date timeline shows ~10 dates; latest non-cloudy is selected.
- [ ] Clicking a different date updates NDVI; switching the index dropdown switches to EVI; opacity slider works.
- [ ] Sample sidebar pane shows mean / p10 / p90 with realistic values; Chart tab shows the NDVI line.
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

## 17. Out of Scope

| Feature | When |
|---|---|
| Functional sidebar items beyond Sample (Weather, VRA maps, Scout tasks, AI assistant, Marketplace) | Future MVP phases |
| Sentinel-1 dpRVI / radar layers | After NDVI works |
| BullMQ + Redis background queue | Only if rate limits force it |
| Per-pixel NDVI clipping to polygon | Polish |
| Push notifications | Future |
| Multi-language (Hindi etc.) | Future |
| Mobile responsive layout | Future |
| Tests (unit, integration, e2e) | Should start after Phase 8 |
| CI/CD deployment pipeline | Productisation |
| Crop yield estimation, pest/disease alerts | Advanced |

---

## 18. References

### Official documentation
| Resource | URL |
|---|---|
| ArcGIS Location Platform pricing | https://location.arcgis.com/pricing/ |
| ArcGIS basemap styles reference | https://developers.arcgis.com/rest/basemap-styles/ |
| EOSDA API Connect docs | https://doc.eos.com/ |
| EOSDA Quickstart | https://doc.eos.com/docs/quickstart/ |
| EOSDA Render API | https://doc.eos.com/docs/render/ |
| EOSDA Statistics API | https://doc.eos.com/docs/statistics/vegetation-indices-analytics/ |
| MapLibre GL JS | https://maplibre.org/maplibre-gl-js/docs |
| @esri/maplibre-arcgis | https://github.com/Esri/maplibre-arcgis |
| TanStack Router | https://tanstack.com/router |
| TanStack Query | https://tanstack.com/query |
| terra-draw | https://terradraw.io/docs |
| Fastify | https://fastify.dev |
| Drizzle ORM | https://orm.drizzle.team |
| PostGIS | https://postgis.net/documentation/ |
| Clerk | https://clerk.com/docs |
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
| ORM: Drizzle | May 2026 | Best PostGIS support + TS inference |
| Local DB: Docker Compose | May 2026 | Portable, version-controlled, matches prod |
| Auth: Clerk | May 2026 | Fastest hosted-auth path; user picked "add basic auth now" |
| Default region: Karnataka | May 2026 | User-specified focus; Punjab moves to demo-fields list |
| Sidebar/bottom-bar are shells; controls are map overlays | May 2026 | Date timeline goes on the map per user instruction |
| Async warm on Create, no job queue | May 2026 | Snappy UX without BullMQ overhead at prototype scale |
| Frontend: Vite + TanStack Router | May 2026 | No SSR benefit for WebGL maps; Router is mature 1.x |
| Layers 1+2: ArcGIS via @esri/maplibre-arcgis | May 2026 | Bundles satellite + labels; better India imagery than MapTiler |
| State: TanStack Query + Zustand | May 2026 | Server vs client state separation; rate-limit caching critical |

---

## Appendix B — Glossary

- **NDVI** — Normalized Difference Vegetation Index. Vegetation health from red + NIR bands. Range −1 to +1. Healthy crops: 0.5–0.9.
- **EVI** — Enhanced Vegetation Index. Better in dense canopies than NDVI.
- **NDWI** — Normalized Difference Water Index. Water content / soil moisture proxy.
- **dpRVI** — Dual-Pol Radar Vegetation Index. Sentinel-1 radar; works through monsoon clouds. Future.
- **WMS** — Web Map Service. OGC standard.
- **XYZ tiles** — Slippy-map tiles using `{z}/{x}/{y}` URLs. Native to MapLibre.
- **L2A** — Sentinel-2 atmospherically corrected imagery.
- **`view_id`** — EOSDA's unique scene identifier (e.g., `S2/43/P/GK/2026/3/23/0`).
- **PostGIS** — Spatial extension to PostgreSQL.
- **GiST** — Generalized Search Tree index used by PostGIS for spatial queries.

---

*End of v2 plan. Update this document as decisions evolve.*
