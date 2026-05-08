# viz-crop — Architecture & Tech Stack

> Technical architecture, tech stack, database schema, API surface, and component design for the viz-crop crop monitoring application.

**Document version:** 2.1
**Last updated:** May 2026
**Companion doc:** [plan.md](./plan.md) — Implementation phases, user flows, and project management.

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
| ORM | **Drizzle ORM** | TS inference + PostGIS geometry support; use SQL helpers for polygon insert/read |
| Local DB | **Docker Compose** (`postgis/postgis:17-3.5`) | Portable, version-controlled |
| Auth | **Clerk** | Hosted; React + Fastify SDKs |
| Layer 1+2 | ArcGIS Location Platform | Satellite + labels (free tier) |
| Layer 3 | Your app + GeoJSON | User-drawn field polygon |
| Layer 4 | EOSDA API Connect | Sentinel-2 Search + Render tiles + async statistics |

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [The Four-Layer Map Stack](#2-the-four-layer-map-stack)
3. [Complete Tech Stack](#3-complete-tech-stack)
4. [Project Structure (monorepo)](#4-project-structure-monorepo)
5. [Database Schema](#5-database-schema)
6. [API Surface](#6-api-surface)
7. [Component Architecture](#7-component-architecture)
8. [Data Flow](#8-data-flow)
9. [Security Considerations](#9-security-considerations)
10. [Glossary](#10-glossary)

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
│  • /api/eosda/stats         async task proxy → EOSDA Statistics     │
│  • /api/eosda/render/:z/:x/:y tile proxy (24 h Cache-Control)       │
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
│  • cached_ndvi_stats            │   │  • Statistics API (mt_stats)  │
│  • Docker Compose (local)       │   │  • Trial/quota from dashboard │
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
- **Drizzle + PostGIS** — TypeScript inference for normal columns and native `geometry` support; use explicit SQL helpers for GeoJSON polygon insert/read paths.
- **Async warm-up, not job queue** — at prototype scale BullMQ/Redis is overkill. `void warmField(id).catch(...)` after the insert is enough, as long as failures are logged with `fieldId`.
- **Direct ArcGIS calls from browser** — Esri keys are domain-restricted; designed for browser exposure.

---

## 2. The Four-Layer Map Stack

| # | Layer | Source | Loaded when | Library |
|---|---|---|---|---|
| 1 | Satellite imagery | ArcGIS `arcgis/imagery` (Maxar Vivid) | App start | MapLibre + `@esri/maplibre-arcgis` |
| 2 | Roads + place labels | ArcGIS basemap symbol layers when present; verify with the chosen imagery style | App start | same as Layer 1 |
| 3 | **Field polygon (user-drawn)** | terra-draw → MapLibre `geojson` source | Create flow + Analysis screen | terra-draw + adapter |
| 4 | **EOSDA NDVI overlay** | EOSDA Render API XYZ tiles via Fastify, clipped with `cropper_ref` when available | Analysis screen, *after* polygon exists | MapLibre `raster` source |

Stacking order from bottom to top in MapLibre:

```
satellite → NDVI raster (opacity ~0.75) → roads/labels → field fill (transparent) → field outline (white)
```

NDVI should sit below the first symbol/label layer so labels remain readable, and below the field outline so the polygon edge stays sharp. Use `beforeId` when inserting dynamic layers after the ArcGIS style loads.

---

## 3. Complete Tech Stack

### Frontend dependencies
| Package | Purpose |
|---|---|
| `react`, `react-dom`, `typescript`, `vite`, `@vitejs/plugin-react` | Core |
| `@tanstack/react-router`, `@tanstack/react-router-devtools` | Routing |
| `@tanstack/react-query`, `@tanstack/react-query-devtools` | Server state |
| `zustand` | Client state |
| `maplibre-gl` | Map renderer |
| `@esri/maplibre-arcgis` | Esri basemap plugin |
| `terra-draw`, `terra-draw-maplibre-gl-adapter` | Polygon drawing |
| `@turf/turf` | Geometry helpers |
| `date-fns` | Date utilities |
| `tailwindcss`, `@tailwindcss/vite` | Styling |
| `lucide-react` | Icons (matches the screenshot's icon style) |
| `recharts` | Sparkline + chart tab |
| `zod` | Runtime validation (from `packages/shared`) |
| `react-hook-form`, `@hookform/resolvers` | shadcn Form + zod resolver |
| `sonner` | Toasts |
| `@clerk/react` | Auth UI + JWT in browser (Core 3; replaces deprecated `@clerk/clerk-react`) |
| shadcn primitives | Button, Form, Dialog, Sheet, Tabs, Tooltip, Select, Slider |

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
| ArcGIS Location Platform | Satellite + labels | Free tier: 1K sessions or 2M tiles/mo |
| EOSDA API Connect | NDVI tiles + stats | Trial/quota varies; confirm in dashboard |
| Clerk | Auth | Free: 10K MAU |
| PostgreSQL + PostGIS (local) | Storage | $0 (Docker) |

---

## 4. Project Structure (monorepo)

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
    └── plan.md
```

---

## 5. Database Schema

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
  eosda_cropper_ref TEXT,
  sowing_date     DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fields_geometry_valid CHECK (ST_IsValid(geometry)),
  CONSTRAINT fields_geometry_srid CHECK (ST_SRID(geometry) = 4326)
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
  data_coverage_percent NUMERIC(5,2),
  tms_template    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (field_id, view_id)
);
CREATE INDEX cached_scenes_field_date_idx ON cached_scenes (field_id, scene_date DESC);

CREATE TABLE cached_ndvi_stats (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id        UUID NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  view_id         TEXT NOT NULL,
  index_name      VARCHAR(20) NOT NULL DEFAULT 'NDVI',
  scene_date      DATE NOT NULL,
  cloud_percent   NUMERIC(5,2),
  data_coverage_percent NUMERIC(5,2),
  mean            NUMERIC(6,4),
  min             NUMERIC(6,4),
  max             NUMERIC(6,4),
  p10             NUMERIC(6,4),
  p90             NUMERIC(6,4),
  median          NUMERIC(6,4),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (field_id, view_id, index_name)
);
```

`area_hectares` is a generated PostGIS column — never compute on the client. Insert polygons with `ST_SetSRID(ST_GeomFromGeoJSON(...), 4326)` or an equivalent parameterized SQL helper; do not trust raw client geometry.

### Drizzle representation (sketch)
```ts
import { pgTable, uuid, text, varchar, numeric, timestamp, date, index, geometry } from 'drizzle-orm/pg-core'
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
  eosdaCropperRef: text('eosda_cropper_ref'),
  sowingDate: date('sowing_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('fields_user_idx').on(t.userId),
  index('fields_geom_gix').using('gist', t.geometry),
])
```

Drizzle supports PostGIS `geometry`, but polygon GeoJSON serialization still needs explicit SQL at the API boundary. Keep conversion helpers in `apps/api/src/db/geometry.ts` so routes do not duplicate raw SQL.

---

## 6. API Surface

All `/api/*` routes (except `/api/health`) require Clerk Fastify auth (`clerkPlugin()` + `getAuth(request)`). User-scoped queries filter on `auth.userId`.

| Method | Path | Body / params | Behavior |
|---|---|---|---|
| GET  | `/api/health` | – | Liveness |
| GET  | `/api/fields` | – | List fields for current user |
| POST | `/api/fields` | `CreateFieldDto` | Insert; kick off `void warmField(id)`; return `{id}` |
| GET  | `/api/fields/:id` | – | Single field (404 if not yours) |
| PATCH| `/api/fields/:id` | `UpdateFieldDto` | Rename / edit metadata |
| DELETE| `/api/fields/:id` | – | Hard delete; cascades cache |
| POST | `/api/eosda/scenes` | `{fieldId, dateRange?}` | Cache-first against `cached_scenes`; on miss, EOSDA Search → upsert |
| POST | `/api/eosda/stats` | `{fieldId, indexes?: ['NDVI'|'EVI'|'NDWI'], dateRange?}` | Cache-first against `cached_ndvi_stats`; on miss, create EOSDA `mt_stats` task, poll, upsert |
| GET  | `/api/eosda/render/:z/:x/:y?fieldId=...&viewId=...&band=NDVI` | query params | Tile proxy, validates ownership + band allowlist, adds that field's `cropper_ref`, sets `Cache-Control: private, max-age=86400` |

Do not expose raw EOSDA URLs to the browser. The render proxy must build the upstream URL server-side because `view_id` contains slashes and the EOSDA API key is a paid secret.

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

## 7. Component Architecture

### Models — `packages/shared/src/`
- `Field`, `CreateFieldDto`, `UpdateFieldDto`
- `Scene` (`viewId`, `date`, `cloud`, `dataCoveragePercent`, `tmsTemplate`)
- `NdviStats` (`viewId`, `date`, `index`, `mean`, `min`, `max`, `p10`, `p90`, `median`, `cloud`, `dataCoveragePercent`)
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
- `useEosdaStats(fieldId, indexes)` — fetches/caches the field stats series (cache 1 h); the selected `viewId` filters client-side.

### State management split
| State type | Where | Examples |
|---|---|---|
| Server state | TanStack Query | Fields, scenes, stats, ArcGIS config |
| Client state | Zustand | Draft polygon, selected viewId, selected index, opacity, active sidebar item, bottom bar tab |
| URL state | TanStack Router | `/fields/:id` |
| Persistent | PostgreSQL | Fields + caches |
| Auth state | Clerk | User session, JWT |

---

## 8. Data Flow

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
 │                   │                         │ void warmField(id) ────────────────│ cropper + search│
 │                   │<──── { id } ────────────┤                    │              │                │
 │                   │ navigate /fields/:id    │                    │<── upsert ───┤<── view_ids ───┤
 │                   │ Render AnalysisLayout   │                    │              │                │
 │                   │ POST /api/eosda/scenes  ├────────────────────│              │                │
 │                   │                         │ SELECT cached_scenes              │                │
 │                   │<── scene list ──────────┤                    │              │                │
 │                   │ DateTimeline auto-picks │                    │              │                │
 │                   │ latest non-cloudy scene │                    │              │                │
 │                   │ Add NDVI raster source: │                    │              │                │
 │                   │   /api/eosda/render/z/x/y?fieldId=...&viewId=...&band=NDVI  │                │
 │                   ├────────────────────────>│ proxy tile + cropper_ref → EOSDA   │                │
 │                   │<──── PNG tiles ─────────┤                    │<── PNG ──────┤                │
 │                   │ POST /api/eosda/stats   ├────────────────────│              │                │
 │                   │                         │ cache miss → create/poll mt_stats │                │
 │                   │<── stats series ────────┤                    │<── results ──┤                │
 │                   │ Render Sample sidebar   │                    │              │                │
```

### Caching strategy
| Data | Cache layer | TTL | Why |
|---|---|---|---|
| ArcGIS basemap tiles | Browser HTTP cache | (Esri sets) | Maxar imagery rarely changes |
| EOSDA scene list | Postgres `cached_scenes` + TanStack Query 1 h | per-field | Scenes are stable once published |
| EOSDA cropper refs | `fields.eosda_cropper_ref` | per-field geometry | Required for clipped render tiles |
| EOSDA NDVI tiles | Browser HTTP cache via private Fastify `Cache-Control` | 24 h | Render output is deterministic per `fieldId/viewId/band/z/x/y/cropper_ref` |
| EOSDA Stats | Postgres `cached_ndvi_stats` + TanStack Query 1 h | per-(field, viewId, index) | Stable after async task completes |
| Fields | TanStack Query | 5 min | Refetch on focus |

---

## 9. Security Considerations

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
- Reject polygons > 200 km² as the prototype guardrail unless EOSDA account limits say otherwise.
- All API bodies parsed by zod schemas from `packages/shared`.
- Validate render `band` against an allowlist (`NDVI`, `EVI`, `NDWI`) and verify `(fieldId, viewId)` belongs to a scene cached for a field owned by the current user before adding `cropper_ref`.
- Never log full EOSDA upstream URLs because the official API supports `api_key` query params.

### Rate limiting
- EOSDA account quotas can be low during trial — server-side debounce + cache absorb most calls.
- Add a Fastify rate-limit plugin if scaling beyond demo (out of scope for v2).

### Auth
- Every `/api/*` route (except `/api/health`) requires a verified Clerk JWT.
- `userId` from the JWT is the only source of truth for ownership filters.
- Use `getAuth(request)`; do not accept user IDs from request bodies.

---

## 10. Glossary

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

*End of architecture document. See [plan.md](./plan.md) for implementation phases, user flows, and project management.*
