# viz-crop Prototype — Implementation Plan

> **Goal:** Prove that all four map layers — Esri satellite, Esri labels + roads, Copernicus NDVI heatmap, and a user-drawn field polygon — render together correctly inside the existing **TanStack Start** application using **MapLibre GL JS**.
>
> **This is a pure integration spike.** No new backend services, no database, no auth. We add one new client-only route to the app already scaffolded in this repo.

---

## Quick Reference

| Item | Value |
|---|---|
| Estimated effort | ~5 hours focused |
| Total cost | $0 (with referrer-restricted keys — see "Quota & Key Protection") |
| External accounts needed | 2 (both free) |
| Base framework | **TanStack Start (SSR via Nitro) + TanStack Router (file-based) + React 19 + Tailwind v4** — already scaffolded in this repo |
| Map renderer | MapLibre GL JS (direct, no wrapper) — **client-only** |
| Drawing | terra-draw (v1) |
| Package manager | **pnpm** (lockfile present) |
| Lint/format | **Biome** (`pnpm check`) |

---

## The Four Layers

These are the four layers that compose into the final map view, stacked bottom to top:

| # | Layer | Provider | What it provides | Cost |
|---|---|---|---|---|
| 1 | Satellite background | Esri World Imagery | High-res satellite photo of India (30–50 cm Maxar Vivid) | Free (2 M tiles/month) |
| 2 | Roads + labels | Esri Reference services (Transportation + Boundaries & Places) | Road lines, village/district/state labels | Free (same quota) |
| 3 | NDVI heatmap | Copernicus Sentinel Hub (CDSE) | Vegetation health overlay from Sentinel-2 (NDVI) | Free (10 000 PU/month) |
| 4 | Field polygon | Your app (GeoJSON) | The boundary the agronomist draws around their field | Your code |

---

## Tech Stack — what's already in the repo

The existing scaffold already provides everything for the application shell. **Do not run `npm create vite`** — we build on top of what's here:

| Concern | Already provided | Where |
|---|---|---|
| Build / dev server | Vite 8 + Nitro SSR | `vite.config.ts`, `package.json` |
| Routing | TanStack Router (file-based) + auto-generated `routeTree.gen.ts` | `src/routes/`, `src/router.tsx` |
| Server runtime | Nitro (TanStack Start) — gives us a real server we can proxy through if needed | `vite.config.ts` (`nitro` plugin) |
| Data fetching | TanStack Query (with SSR-Query integration) | `src/integrations/tanstack-query/`, `src/router.tsx` |
| Styling | Tailwind v4 (`@tailwindcss/vite`) + shadcn/ui ready (`components.json`) | `src/styles.css`, `components.json` |
| Env validation | `@t3-oss/env-core` + Zod, `clientPrefix: 'VITE_'` | `src/env.ts` |
| Lint/format | Biome (tab indent, double quotes) | `biome.json` |
| Path aliases | `#/*` and `@/*` → `./src/*` | `tsconfig.json`, `package.json#imports` |
| App chrome | Header, Footer, ThemeToggle | `src/components/Header.tsx`, `Footer.tsx`, `__root.tsx` |
| React | React 19 + React Compiler (`babel-plugin-react-compiler`) | `vite.config.ts` |

### What we add on top

```
maplibre-gl                       → Map renderer (browser-only)
terra-draw                        → Polygon drawing (browser-only)
terra-draw-maplibre-gl-adapter    → MapLibre adapter for terra-draw
@turf/turf                        → Geometry helpers (bbox, area)
date-fns                          → Date formatting for WMS TIME param
@types/geojson                    → Explicit Feature/Polygon types (devDep)
```

> **Why direct MapLibre, not `react-map-gl`?** For this spike, direct MapLibre via `useRef` + `useEffect` is simpler. We add raster sources programmatically and terra-draw integrates more naturally with a direct map instance.

---

## ⚠️ Critical SSR Constraint (read this before coding anything)

This project runs **server-side rendering** through Nitro. `maplibre-gl`, `terra-draw`, and `terra-draw-maplibre-gl-adapter` reference `window`, `document`, and WebGL **at module-evaluation time**. A plain `import maplibregl from "maplibre-gl"` at the top of a route component will throw `ReferenceError: window is not defined` during SSR — the page will 500 before any `useEffect` runs.

**The plan handles this with two complementary techniques:**

1. **Mark the route as client-only.** The map route uses `ssr: false`, which TanStack Start documents as the supported way to opt a route out of server rendering entirely (both the loader and the component run only in the browser).
2. **Dynamic-import map libraries inside `useEffect`.** Even with `ssr: false`, the route module is still evaluated for routing metadata. We never put `import maplibregl …` at the top level of a server-evaluated module — we `await import("maplibre-gl")` inside the effect that initializes the map.

`<ClientOnly>` alone is **not** sufficient — it only skips JSX render, not module evaluation. We still use `ssr: false` to be safe.

---

## Prerequisites — Complete Before Writing Code

### Account 1: ArcGIS Location Platform (Esri tiles) — ~10 minutes

1. Sign up free at [developers.arcgis.com](https://developers.arcgis.com) — no credit card required.
2. Create a new **API key**, scoped to the **Basemaps** service.
3. **Restrict the key by HTTP referrer** — add `http://localhost:3000/*` for dev plus any preview/prod domain. This is the only thing standing between your free tier and a public abuser. Keys without referrer restriction can be drained in hours.
4. Free tier: **2 000 000 tiles/month** — shared across all three Esri layers.

**Tile URL pattern (legacy raster service — what we use):**
```
https://ibasemaps-api.arcgis.com/arcgis/rest/services/{LAYER_PATH}/MapServer/tile/{z}/{y}/{x}?token=YOUR_KEY
```

> ⚠️ Use `ibasemaps-api` (raster tiles), not `basemaps-api` (vector tiles, different setup). Wrong domain = silent 401.

> ℹ️ Esri's modern recommendation is the vector-tile **Basemap Styles service** (`basemapstyles-api.arcgis.com/.../styles/v2`). For this spike we stick with the raster layers because they're a 1:1 match for "satellite + roads + labels as separate stackable rasters." Note this is a deliberate choice, not an oversight.

### Account 2: Copernicus Data Space Ecosystem (NDVI) — ~20 minutes

1. Sign up free at [dataspace.copernicus.eu](https://dataspace.copernicus.eu) — no credit card required.
2. Open the **Sentinel Hub Dashboard** from the portal.
3. Create a new **Configuration** — note the **Instance ID**.
4. Add a **Layer** to that configuration:
   - Data source: **Sentinel-2 L2A**
   - Layer ID (this is the value you'll use in the URL — case-sensitive): `NDVI`
   - Paste the evalscript below into the layer's evalscript field
5. **Restrict configuration domains** — add `localhost:3000` and any preview domain in the configuration's "Allowed domains" field. Same reasoning as Esri.
6. **Confirm the configuration permits unauthenticated OGC access** (this is the default for free CDSE configurations). If your configuration requires OAuth bearer tokens, you must proxy through a Nitro server function — see the "Quota & Key Protection" section below.
7. Save — your WMS endpoint will be:

```
https://sh.dataspace.copernicus.eu/ogc/wms/{YOUR_INSTANCE_ID}
```

**Free tier: 10 000 Processing Units/month** — covers thousands of field scans.

#### NDVI Evalscript (paste into the Sentinel Hub layer config)

```javascript
//VERSION=3
function setup() {
  return {
    input: ["B04", "B08", "dataMask"],
    output: { bands: 4 }
  };
}

function evaluatePixel(sample) {
  let ndvi = (sample.B08 - sample.B04) / (sample.B08 + sample.B04);
  let color = colorBlend(ndvi,
    [-0.2, 0.0, 0.2, 0.4, 0.6, 0.8],
    [
      [0.6, 0.3, 0.1],   // bare soil / very low
      [0.86, 0.86, 0.6], // sparse vegetation
      [0.6, 0.8, 0.3],   // moderate
      [0.3, 0.6, 0.2],   // good
      [0.1, 0.4, 0.1],   // dense
      [0.0, 0.25, 0.0]   // very dense
    ]
  );
  return [...color, sample.dataMask];
}
```

#### One-time verification (do this before writing any code)

Hit each URL in the browser with your real keys to catch service-path or auth issues early:

```
https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/14/7350/11550?token=YOUR_ESRI_KEY
https://ibasemaps-api.arcgis.com/arcgis/rest/services/Reference/World_Transportation/MapServer/tile/14/7350/11550?token=YOUR_ESRI_KEY
https://ibasemaps-api.arcgis.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/14/7350/11550?token=YOUR_ESRI_KEY

https://sh.dataspace.copernicus.eu/ogc/wms/YOUR_INSTANCE_ID?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=NDVI&SRS=EPSG:4326&BBOX=75.84,30.89,75.86,30.91&WIDTH=256&HEIGHT=256&FORMAT=image/png&TIME=2024-02-05/2024-02-15&MAXCC=20
```

Each must return a real PNG (or be visible in the browser as an image). If any fails, fix that before proceeding — the rest of the plan assumes they all work.

---

## Quota & Key Protection (security checklist)

`VITE_*`-prefixed variables in Vite are **statically inlined into the client JS bundle**. Anyone with DevTools can read them. Treat the Esri token and Sentinel Hub instance ID as quota-bearing public IDs, not secrets.

For this prototype we accept exposing them, but only with the following safeguards:

- ✅ **Esri key**: HTTP-referrer restricted in the ArcGIS dashboard.
- ✅ **Sentinel Hub instance ID**: domain-restricted in the configuration.
- ✅ **Date input is debounced (300 ms)** so a user dragging the picker can't fire 30 WMS requests in a second.
- ✅ **NDVI bbox area capped** (reject requests over ~500 km² to keep PU usage bounded).
- ✅ **No automatic NDVI request on every state change** — only re-fetch when `field` or debounced `date` changes.

**Upgrade path (NOT in this spike):** Move Sentinel Hub requests behind a TanStack Start server function (`createServerFn`) or a Nitro route handler. The browser calls `/api/ndvi?bbox=…&date=…`; the server holds `SH_INSTANCE_ID` (no `VITE_` prefix), attaches the OAuth bearer if required, optionally caches the response, and returns the PNG. That eliminates client-side credential exposure entirely. Document this as the production path; do not implement it here.

---

## Project Setup

### Install dependencies

```bash
pnpm add maplibre-gl terra-draw terra-draw-maplibre-gl-adapter @turf/turf date-fns
pnpm add -D @types/geojson
```

> Use `pnpm`, not `npm`. The repo has `pnpm-lock.yaml`. Mixing package managers will produce phantom dependency issues.

### Environment variables — register in `src/env.ts`

The project validates env vars at startup with `@t3-oss/env-core`. Bypassing this with raw `import.meta.env.VITE_*` is the project's #1 footgun: missing keys silently become `undefined`, producing `?token=undefined` URLs that come back as 401s.

**Edit `src/env.ts`** to register the two new client keys:

```ts
client: {
  VITE_APP_TITLE: z.string().min(1).optional(),
  VITE_ESRI_API_KEY: z.string().min(1),
  VITE_SH_INSTANCE_ID: z.string().min(1),
},
```

Create `.env` (project root, **never commit**):

```env
VITE_ESRI_API_KEY=your_arcgis_api_key_here
VITE_SH_INSTANCE_ID=your_sentinel_hub_instance_id_here
```

Confirm `.env` is already in `.gitignore` (it should be from the scaffold — check before committing anything).

Create `.env.example` (commit this, with placeholders) so other devs know what to set.

### MapLibre CSS

There is no `src/main.tsx` in this scaffold. Add the MapLibre stylesheet to the existing global stylesheet `src/styles.css` (near the top, after the Tailwind import):

```css
@import "tailwindcss";
@import "maplibre-gl/dist/maplibre-gl.css";
```

> If `dist/maplibre-gl.css` resolves but Biome flags it, the alternative subpath `maplibre-gl/maplibre-gl.css` also works depending on the package's `exports` field.

---

## Project Structure (deltas)

We **add** the following files. We **do not** create `App.tsx` or `main.tsx` — those don't fit this scaffold.

```
agri-app/
├── src/
│   ├── env.ts                              # EDIT — add VITE_ESRI_API_KEY, VITE_SH_INSTANCE_ID
│   ├── styles.css                          # EDIT — add @import "maplibre-gl/dist/maplibre-gl.css"
│   ├── routes/
│   │   ├── __root.tsx                      # EDIT — add nav link to /map
│   │   └── map.tsx                         # NEW — file route, ssr: false, owns field/date state
│   ├── components/
│   │   └── map/
│   │       ├── MapView.tsx                 # NEW — MapLibre init + layer management (dynamic-imported)
│   │       └── MapSidebar.tsx              # NEW — Draw button + date picker + layer info
│   └── lib/
│       ├── esri.ts                         # NEW — Esri tile URL builders
│       └── sentinel-hub.ts                 # NEW — Sentinel Hub WMS URL builder + bbox helpers
└── docs/
    └── plan.md                             # this file
```

---

## Esri Tile URL Reference (`src/lib/esri.ts`)

```ts
import { env } from "#/env"

const KEY = env.VITE_ESRI_API_KEY
const BASE = "https://ibasemaps-api.arcgis.com/arcgis/rest/services"

export const ESRI_URLS = {
  satellite:      `${BASE}/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${KEY}`,
  // Note the `Reference/` prefix on both overlay layers — without it the service
  // returns 404 silently and labels render but roads do not.
  transportation: `${BASE}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}?token=${KEY}`,
  labels:         `${BASE}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}?token=${KEY}`,
} as const

export const ESRI_ATTRIBUTION =
  "Esri, Maxar, GeoEye, USDA FSA, HERE, Garmin, © OpenStreetMap contributors"
```

---

## Sentinel Hub WMS URL Builder (`src/lib/sentinel-hub.ts`)

> **WMS axis-order trap:** WMS 1.3.0 with `EPSG:4326` expects BBOX as **(minLat, minLon, maxLat, maxLon)** — latitude first. WMS 1.1.1 with `SRS=EPSG:4326` uses (minLon, minLat, maxLon, maxLat) — longitude first. Turf's `bbox()` returns lon-first, matching the 1.1.1 convention.
>
> **We pin `VERSION=1.1.1`** so the BBOX from `turf.bbox()` flows through unchanged. Do not omit the version — Sentinel Hub's WMS default is 1.3.0, which would silently mis-order the box and return blank/transparent imagery (which the "must be clouds" gotcha would then mask indefinitely).

```ts
import { env } from "#/env"
import { format, subDays } from "date-fns"

const INSTANCE_ID = env.VITE_SH_INSTANCE_ID
const BASE = `https://sh.dataspace.copernicus.eu/ogc/wms/${INSTANCE_ID}`

export interface NdviRequest {
  bbox: [number, number, number, number] // [minLon, minLat, maxLon, maxLat] from turf.bbox
  date: string                            // 'YYYY-MM-DD' (local date from <input type="date">)
  width?: number
  height?: number
}

export function buildNdviUrl({
  bbox,
  date,
  width = 512,
  height = 512,
}: NdviRequest): string {
  // 10-day window ending on the selected date (use date-fns to avoid TZ surprises)
  const end = date
  const start = format(subDays(new Date(`${date}T00:00:00`), 10), "yyyy-MM-dd")

  const p = new URLSearchParams({
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: "1.1.1",                  // ← pinned, see axis-order note above
    LAYERS:  "NDVI",                   // ← must match layer ID in Sentinel Hub dashboard (case-sensitive)
    SRS:     "EPSG:4326",              // ← 1.1.1 uses SRS, not CRS
    BBOX:    bbox.join(","),           // ← lon,lat,lon,lat — matches turf.bbox output
    WIDTH:   String(width),
    HEIGHT:  String(height),
    FORMAT:  "image/png",
    TIME:    `${start}/${end}`,
    MAXCC:   "20",                     // ≤ 20% cloud coverage
    TRANSPARENT: "true",
  })

  return `${BASE}?${p.toString()}`
}

/** Compute width/height keeping the bbox aspect ratio, capped at maxPx on the long side. */
export function imageDimsForBbox(
  bbox: [number, number, number, number],
  maxPx = 512,
): { width: number; height: number } {
  const w = bbox[2] - bbox[0]
  const h = bbox[3] - bbox[1]
  const ratio = w / h
  return ratio >= 1
    ? { width: maxPx, height: Math.max(64, Math.round(maxPx / ratio)) }
    : { width: Math.max(64, Math.round(maxPx * ratio)), height: maxPx }
}

/** Rough km² of a small bbox using equirectangular approximation (fine for sanity-checking). */
export function bboxAreaKm2(bbox: [number, number, number, number]): number {
  const meanLat = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180)
  const widthKm = (bbox[2] - bbox[0]) * 111.32 * Math.cos(meanLat)
  const heightKm = (bbox[3] - bbox[1]) * 110.57
  return Math.abs(widthKm * heightKm)
}
```

---

## Implementation Phases

> Run `pnpm dev` (port 3000) throughout. The first time the router plugin runs, it generates `src/routeTree.gen.ts`. The pre-existing TS errors about that file resolve as soon as `pnpm dev` has run once.

### Phase 0 — Wiring · ~30 min

**What you build:** Env vars registered, deps installed, MapLibre CSS imported, an empty `/map` route reachable from the existing nav.

**Steps:**
1. `pnpm add` the runtime deps and `pnpm add -D @types/geojson`.
2. Edit `src/env.ts` to register `VITE_ESRI_API_KEY` and `VITE_SH_INSTANCE_ID`.
3. Create `.env` and `.env.example`.
4. Add `@import "maplibre-gl/dist/maplibre-gl.css";` to `src/styles.css`.
5. Add a nav link to `/map` inside `src/components/Header.tsx` (or wherever the nav lives).
6. Create `src/routes/map.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router"
import { ClientOnly } from "@tanstack/react-router"
import { lazy, Suspense, useState } from "react"
import type { Feature, Polygon } from "geojson"

// Lazy + ClientOnly + ssr:false — three layers of defense against SSR module evaluation
// of MapLibre/terra-draw, which touch window/document/WebGL at import time.
const MapView = lazy(() => import("#/components/map/MapView"))

export const Route = createFileRoute("/map")({
  ssr: false,
  component: MapPage,
})

function MapPage() {
  const [field, setField] = useState<Feature<Polygon> | null>(null)
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0])

  return (
    <ClientOnly fallback={<div className="p-8 text-sm text-[var(--sea-ink-soft)]">Loading map…</div>}>
      <Suspense fallback={null}>
        <MapView field={field} date={date} onFieldChange={setField} onDateChange={setDate} />
      </Suspense>
    </ClientOnly>
  )
}
```

7. Decide layout: the existing `__root.tsx` renders Header + Footer around `{children}`. For the prototype, the simplest fix is to size the map container with `min-h-[calc(100dvh-9rem)]` (subtract approximate header+footer height) inside the route. If the chrome distracts from the demo, an alternative is to introduce a route group that renders without the layout — out of scope for this spike. Document the chosen sizing in a CSS variable.

8. Create empty `src/components/map/MapView.tsx` and `MapSidebar.tsx` shells (just `export default function ... { return <div /> }`) so the lazy import resolves.

**✅ Done when:** Visiting `http://localhost:3000/map` shows an empty page with the existing Header/Footer, no SSR errors in the Nitro logs, no console errors, and the route hard-reloads cleanly.

---

### Phase 1 — Esri Satellite Layer · ~30 min

**What you build:** High-res India satellite imagery loads as the map background.

**Steps:**
1. Inside `MapView.tsx`, set up a `useRef` for the container div and a `useRef<maplibregl.Map | null>` for the map instance.
2. In a `useEffect`, dynamic-import `maplibre-gl` and initialize the map. Use `style: { version: 8, sources: {}, layers: [], glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf" }` so any future text layers don't crash for missing glyphs.
3. Centre on Ludhiana, Punjab: `[75.85, 30.90]` at zoom 14.
4. Add the satellite raster source/layer inside `map.on("style.load", ...)` (NOT `"load"`) — terra-draw's docs require `style.load`, and the same handler works for Esri sources.
5. Track style readiness in component state (`useState(false)`) so other effects can wait on it instead of polling `map.isStyleLoaded()`.
6. On `useEffect` cleanup, call `map.remove()` and null out the ref.

**Sketch:**
```tsx
import { useEffect, useRef, useState } from "react"
import type { Map as MlMap } from "maplibre-gl"
import { ESRI_URLS, ESRI_ATTRIBUTION } from "#/lib/esri"

useEffect(() => {
  if (!containerRef.current) return
  let cancelled = false
  let map: MlMap | undefined

  ;(async () => {
    const { Map } = await import("maplibre-gl")
    if (cancelled || !containerRef.current) return

    map = new Map({
      container: containerRef.current,
      style: { version: 8, sources: {}, layers: [],
               glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf" },
      center: [75.85, 30.90],
      zoom: 14,
    })
    mapRef.current = map

    map.on("style.load", () => {
      if (!map) return
      map.addSource("esri-sat", {
        type: "raster",
        tiles: [ESRI_URLS.satellite],
        tileSize: 256,
        attribution: ESRI_ATTRIBUTION,
      })
      map.addLayer({ id: "esri-sat", type: "raster", source: "esri-sat" })
      setStyleReady(true)
    })

    map.on("error", (e) => {
      // Surface tile/auth errors instead of silently rendering blank
      console.error("[maplibre]", e?.error ?? e)
    })
  })()

  return () => {
    cancelled = true
    map?.remove()
    mapRef.current = null
  }
}, [])
```

**✅ Done when:** Sharp satellite imagery of Punjab farmland is visible — distinct field boundaries, irrigation channels, tree lines.

---

### Phase 2 — Esri Labels + Roads Overlay · ~15 min

**What you build:** Village names, road lines, and district labels appear on top of the satellite photo.

**Steps:**
1. Inside the same `style.load` handler (after the satellite layer), add the transportation and labels raster sources/layers.
2. Order matters: satellite → transportation → labels (last added = on top).

```ts
map.addSource("esri-transport", {
  type: "raster",
  tiles: [ESRI_URLS.transportation],
  tileSize: 256,
  attribution: ESRI_ATTRIBUTION,
})
map.addLayer({ id: "esri-transport", type: "raster", source: "esri-transport" })

map.addSource("esri-labels", {
  type: "raster",
  tiles: [ESRI_URLS.labels],
  tileSize: 256,
  attribution: ESRI_ATTRIBUTION,
})
map.addLayer({ id: "esri-labels", type: "raster", source: "esri-labels" })
```

**✅ Done when:** Road lines and city/village/district names render clearly on top of satellite imagery.

---

### Phase 3 — Field Polygon Drawing · ~60 min

**What you build:** Agronomist clicks "Draw field" in the sidebar, draws a polygon, completes with double-click. Polygon persists in state and renders with a visible white outline. Drawing again replaces the previous polygon.

**Critical points:**
- terra-draw must be initialized inside `map.on("style.load", ...)` — not in `"load"`.
- After `draw.start()`, call `draw.setMode("polygon")` only when the user clicks the Draw button — not on init.
- The `finish` event signature is `(id: string, context: { action: string; mode: string })`. Filter on `context.action === "draw"`.
- Do **not** call `draw.stop()` after a polygon is finished — that bricks redrawing. Switch to a passive mode (`"static"` if registered, otherwise `"select"`) so the next "Draw field" click can re-enter polygon mode.
- The `draw` instance lives in MapView. The Sidebar button needs to trigger drawing — pass a `onDrawRequest` callback up (or down via a parent-owned ref).

**Initialization (inside `style.load`, after Esri layers, BEFORE setStyleReady):**
```ts
const [{ TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode }, { TerraDrawMapLibreGLAdapter }] =
  await Promise.all([
    import("terra-draw"),
    import("terra-draw-maplibre-gl-adapter"),
  ])

const draw = new TerraDraw({
  adapter: new TerraDrawMapLibreGLAdapter({ map }),
  modes: [new TerraDrawPolygonMode(), new TerraDrawSelectMode({ flags: {} })],
})
draw.start()                       // start the instance — does NOT activate any mode
draw.setMode("select")             // passive default; "Draw field" button switches to "polygon"
drawRef.current = draw

draw.on("finish", (id, context) => {
  if (context.action !== "draw" || context.mode !== "polygon") return
  const feature = draw.getSnapshot().find((f) => f.id === id)
  if (!feature || feature.geometry.type !== "Polygon") return

  // Single-field demo: clear any prior features so we don't accumulate
  draw.clear()
  draw.setMode("select")

  onFieldChangeRef.current(feature as Feature<Polygon>)
})
```

> **React 19 + callback freshness:** the effect that builds the map runs once. Store `onFieldChange`/`onDateChange` in refs that are kept in sync via a small `useEffect`, then read `onFieldChangeRef.current(...)` inside the map's event listeners. Otherwise the closure captures the stale first-render callback. (React Compiler's memoization does NOT fix this.)

**Sidebar wiring:**
```tsx
// MapSidebar.tsx
<button
  type="button"
  onClick={() => onDrawRequest()}      // parent forwards to drawRef.current?.setMode("polygon")
  className="..."
>
  {field ? "Redraw field" : "Draw field"}
</button>
```

**Field render layers (added once on `style.load`, after Esri but before NDVI insertion point):**
```ts
map.addSource("field", {
  type: "geojson",
  data: { type: "FeatureCollection", features: [] },
})
map.addLayer({
  id: "field-fill",
  type: "fill",
  source: "field",
  paint: { "fill-color": "#ffffff", "fill-opacity": 0.12 },
})
map.addLayer({
  id: "field-outline",
  type: "line",
  source: "field",
  paint: { "line-color": "#ffffff", "line-width": 2 },
})
```

**Sync `field` prop → `field` source (effect that depends on `styleReady` and `field`):**
```ts
useEffect(() => {
  const map = mapRef.current
  if (!map || !styleReady) return
  const src = map.getSource("field") as maplibregl.GeoJSONSource | undefined
  if (!src) return
  src.setData(field ?? { type: "FeatureCollection", features: [] })
}, [field, styleReady])
```

**Cleanup:** in the map's unmount cleanup, call `drawRef.current?.stop()` and null the ref before `map.remove()` to avoid noisy adapter warnings during HMR / React 19 strict-mode double-invoke.

**✅ Done when:** Click "Draw field", click points, double-click to finish — polygon stays visible with a white outline. Click "Redraw field" — polygon is replaced cleanly.

---

### Phase 4 — Copernicus NDVI Overlay · ~60 min

**What you build:** A coloured vegetation heatmap appears over the drawn field's bounding box.

**Steps:**
1. When a polygon is finished or the date changes, compute its bbox with Turf.
2. Reject excessively large bboxes (`bboxAreaKm2 > 500`) — guard against accidental quota burn.
3. Build the WMS URL via `buildNdviUrl()` (with `imageDimsForBbox()` for non-square fields).
4. **First time** an NDVI request fires, add the source + layer. **Subsequent times**, call `source.updateImage({ url, coordinates })`. This avoids flicker and the layer-reorder pitfall.
5. Insert the NDVI layer above `esri-labels` but below `field-fill` so the polygon outline stays on top.
6. Set `paint: { "raster-opacity": 0.85, "raster-fade-duration": 0 }` to suppress the cross-fade flash on update.
7. Wire `map.on("error", ...)` to log any WMS load failure (otherwise an XML error response from Sentinel Hub silently fails to render with no console signal).

**Effect (depends on `field`, debounced `date`, `styleReady`):**
```ts
useEffect(() => {
  const map = mapRef.current
  if (!map || !styleReady || !field) return

  const bbox = turf.bbox(field) as [number, number, number, number]
  if (bboxAreaKm2(bbox) > 500) {
    console.warn("[ndvi] bbox too large, skipping")
    return
  }

  const dims = imageDimsForBbox(bbox)
  const url = buildNdviUrl({ bbox, date: debouncedDate, ...dims })
  const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
    [bbox[0], bbox[3]], // top-left     [minLon, maxLat]
    [bbox[2], bbox[3]], // top-right    [maxLon, maxLat]
    [bbox[2], bbox[1]], // bottom-right [maxLon, minLat]
    [bbox[0], bbox[1]], // bottom-left  [minLon, minLat]
  ]

  const existing = map.getSource("ndvi") as maplibregl.ImageSource | undefined
  if (existing) {
    existing.updateImage({ url, coordinates })
    return
  }

  map.addSource("ndvi", { type: "image", url, coordinates })
  map.addLayer(
    {
      id: "ndvi",
      type: "raster",
      source: "ndvi",
      paint: { "raster-opacity": 0.85, "raster-fade-duration": 0 },
    },
    "field-fill", // insert before field layers so the white outline stays on top
  )
}, [field, debouncedDate, styleReady])
```

**Debounce the date input** in `MapPage` (or in MapSidebar) — a 300 ms debounce is enough to stop date-input drag-scrubbing from issuing dozens of WMS requests:

```ts
import { useDeferredValue, useEffect, useState } from "react"

// Simple debounce hook — replace with a util if you prefer
function useDebouncedValue<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}
```

> **Acknowledged limitation:** the NDVI image is the polygon's axis-aligned bbox, so for non-rectangular polygons the heatmap visibly overflows the field outline. Per-pixel polygon clipping is out of scope (would require Sentinel Hub's `GEOMETRY` parameter or a server-side clip). The white field outline at higher z-order makes it obvious which area is "the field." Document this in the demo script.

**✅ Done when:** Drawing a field over a known crop area (Ludhiana in Nov–Mar) shows a green-yellow-orange heatmap rectangle. Green = healthy vegetation, orange/red = stressed or bare soil. Try `2024-02-15` for Punjab — clear sky in winter.

> **Tip:** If you get a transparent image, candidate causes in priority order: (1) wrong WMS axis order — verify your URL has `VERSION=1.1.1` and `SRS=EPSG:4326`; (2) cloud cover — bump `MAXCC` or pick a clearer date; (3) layer name mismatch (the LAYERS param must equal the layer ID in the SH dashboard exactly).

---

### Phase 5 — Date Selector · ~20 min

**What you build:** Switching dates updates the NDVI overlay (debounced).

**Steps:**
1. Add `<input type="date" />` to `MapSidebar.tsx`, plus a "Load NDVI" button as a manual override if you want to skip the debounce.
2. Wire `onChange` to `onDateChange` (which updates the route's `date` state).
3. The Phase 4 effect already watches the debounced date — it will fetch and call `updateImage`.
4. Set `max={today}` on the input so users can't pick future dates.

**Style with Tailwind / shadcn:** the existing app uses Tailwind v4 with shadcn/ui. Prefer `pnpm dlx shadcn@latest add button input` and use those instead of unstyled HTML elements — keeps the demo visually consistent with the rest of the app.

**✅ Done when:** Picking a date in a dry winter month (February) vs monsoon month (July) produces visibly different NDVI values for the same field. This confirms the time dimension is working.

---

### Phase 6 — Manual Verification · ~30 min

**What you build:** Nothing new — confirm everything works on real Indian fields.

**Three test fields to verify:**

| Location | Coordinates (centre) | Season to test | Expected NDVI |
|---|---|---|---|
| Ludhiana, Punjab | `[75.85, 30.90]` | Nov–Feb (rabi wheat) | Moderate-high green |
| Akola, Maharashtra | `[77.00, 20.70]` | Oct–Dec (post-kharif) | Mixed brown/green |
| Tirunelveli, Tamil Nadu | `[77.17, 8.50]` | Jan–Mar (dry season) | Variable |

**Verification checklist for each field:**

- [ ] Satellite imagery renders sharp at zoom 14–16
- [ ] Village/road labels are readable
- [ ] Polygon draws cleanly, double-click finishes
- [ ] "Redraw field" replaces the previous polygon (does not accumulate)
- [ ] NDVI loads within a few seconds of polygon finish
- [ ] NDVI shows colour variation (not all one colour)
- [ ] Switching dates visibly changes the NDVI
- [ ] Date scrubbing does NOT fire one request per keystroke (network tab shows ≤ 2/sec)
- [ ] No console errors during any of the above
- [ ] Hard-reloading `/map` directly works (SSR doesn't crash)

---

### Phase 7 — Production Build Verification · ~15 min

SSR/browser-only import bugs frequently pass under `pnpm dev` but fail in production server startup or first SSR request. Always run the production gate before declaring done.

```bash
pnpm check         # Biome lint + format
pnpm build         # Vite + Nitro production build (this is where module-eval-time SSR crashes surface)
pnpm start         # Run the Nitro production server
```

Then in a browser:
- Visit `/`, `/about`, `/map` in turn — no SSR errors in the Nitro console.
- Hard-refresh `/map` (Ctrl+Shift+R) — confirm it doesn't 500.
- Disable JS in DevTools, reload `/map` — should render the `ClientOnly` fallback, not crash.

If the build fails with `ReferenceError: window is not defined`, the `ssr: false` + `lazy import` defense was bypassed somewhere. Find it and fix before merging.

---

## MapLibre Layer Ordering Reference

Layer order in MapLibre is controlled by the order you call `addLayer()`. Last added = on top. Final order from bottom to top:

```
1. esri-sat          (Esri satellite raster — background)
2. esri-transport    (Esri roads raster)
3. esri-labels       (Esri labels raster)
4. ndvi              (Copernicus NDVI raster — above labels, inserted with beforeId='field-fill')
5. field-fill        (polygon semi-transparent fill)
6. field-outline     (polygon solid white outline — topmost)
```

When inserting layers dynamically, always use the `beforeId` parameter:
```ts
map.addLayer({ id: "ndvi", ... }, "field-fill") // inserts NDVI just below the field fill
```

---

## Common Gotchas

### 1. SSR crash on module load
`maplibre-gl` and `terra-draw` reference `window`/`document`/WebGL at import time. Plain top-level imports in route components crash SSR before any effect runs. Always combine `ssr: false` (route option) + `lazy()` + dynamic `import()` inside `useEffect`.

### 2. WMS axis order — pin VERSION=1.1.1
WMS 1.3.0 + EPSG:4326 expects (lat, lon, lat, lon). Turf gives you (lon, lat, lon, lat). If you don't pin a VERSION, Sentinel Hub defaults to 1.3.0 and you get blank/transparent imagery that looks like cloud cover but isn't. Pin `VERSION=1.1.1` and use `SRS=EPSG:4326` (NOT `CRS`).

### 3. Esri service paths — `Reference/` prefix matters
`World_Transportation/MapServer` returns 404; the correct path is `Reference/World_Transportation/MapServer`. Same for `Reference/World_Boundaries_and_Places`. Verify each URL with your real key in a browser before wiring.

### 4. Esri token — use `ibasemaps-api`, not `basemaps-api`
`ibasemaps-api` serves raster tiles (what we use). `basemaps-api` serves vector tiles. Wrong domain = silent 401.

### 5. Sentinel Hub layer name must match exactly
The `LAYERS=NDVI` parameter must exactly match the layer ID set in the Sentinel Hub dashboard. Case-sensitive. `LAYERS=ndvi` will silently fail.

### 6. NDVI returns transparent when clouds are present
Sentinel-2 is optical. India's monsoon (June–September) frequently produces transparent tiles. Test with February for north India. `MAXCC=20` rejects images with > 20 % cloud cover.

### 7. terra-draw vs `@mapbox/mapbox-gl-draw`
`@mapbox/mapbox-gl-draw` only works with Mapbox GL JS (proprietary); the MapLibre community fork is unmaintained. Use `terra-draw` with its MapLibre adapter.

### 8. terra-draw initialization order
Init inside `map.on("style.load", ...)` (NOT `"load"`). Call `draw.start()` THEN `draw.setMode(name)` — `start()` alone activates no mode and clicks do nothing.

### 9. terra-draw `draw.stop()` bricks redrawing
After `draw.stop()`, the instance is dead — no more drawing without recreating it. To support multiple draws, switch to `select`/`static` mode after each finish instead.

### 10. Image source coordinates order
MapLibre's `image` source expects `[top-left, top-right, bottom-right, bottom-left]` (clockwise from top-left). Turf's `bbox` is `[minLon, minLat, maxLon, maxLat]`. Conversion:
```ts
[
  [bbox[0], bbox[3]], // top-left     = [minLon, maxLat]
  [bbox[2], bbox[3]], // top-right    = [maxLon, maxLat]
  [bbox[2], bbox[1]], // bottom-right = [maxLon, minLat]
  [bbox[0], bbox[1]], // bottom-left  = [minLon, minLat]
]
```

### 11. Style-load race
Don't bail with `if (!map.isStyleLoaded()) return` and forget about it — the effect won't re-run on style load. Track style readiness in `useState` set inside `map.on("style.load", () => setStyleReady(true))`, and include `styleReady` in your effect deps.

### 12. Stale callbacks in long-lived map listeners
The map-init effect runs once. If you reference `onFieldChange` (a prop) inside `draw.on("finish", ...)`, you capture the first-render callback forever. Mirror props into refs and read `ref.current(...)` inside the listener. React Compiler does not fix this.

### 13. Update the NDVI source, don't recreate it
Use `(map.getSource("ndvi") as ImageSource).updateImage({ url, coordinates })` after the first add. `removeLayer + removeSource + addSource + addLayer` flickers and is harder to error-handle.

### 14. `100vh` + Header/Footer = vertical overflow
The root shell renders Header + children + Footer. A child sized `100vh` overflows. Use `min-h-[calc(100dvh-9rem)]` (or whatever your chrome adds up to) for the map container, and `width: 100%` not `100vw`.

### 15. Listen for map errors
`map.on("error", e => console.error("[maplibre]", e))` surfaces tile auth failures and WMS XML error responses that would otherwise render as blank squares with no console signal.

---

## Out of Scope for This Prototype

The following are deliberately **not** built. They belong in the MVP, not the integration spike.

| Feature | When to add |
|---|---|
| User authentication | Phase 2 (productisation) |
| Database / persisting fields | Phase 2 |
| Server-side proxy for Sentinel Hub (Nitro server function) | Before any public deploy |
| Multiple fields per user | Phase 2 |
| Field dashboard / list view | Phase 2 |
| Per-pixel NDVI clipping to polygon (`GEOMETRY` param or server clip) | Phase 1 polish |
| dpRVI radar layer (Sentinel-1) | After NDVI is working |
| Timeline scrubber / date range | After basic date picker works |
| Stats panel (mean, p10/p90) | Phase 1 MVP |
| Cloud-cover indicator | Phase 1 MVP |
| Mobile responsive layout | Phase 2 |
| Vitest tests for MapView (browser-only — needs jsdom + manual maplibre stub) | Phase 2 |
| CI/CD | Phase 2 |

---

## Cost Summary

| Layer | Provider | Prototype cost | MVP scale (500 fields) |
|---|---|---|---|
| Esri satellite | ArcGIS Location Platform | $0 (2 M tiles/month free) | $0 (within free tier) |
| Esri labels + roads | ArcGIS Location Platform | $0 (same quota) | $0 |
| NDVI (on-demand, ~4 scans/yr) | Copernicus Sentinel Hub | $0 (10 K PU/month free) | $0 (≈3 PU/month total) |
| NDVI (auto-refresh, 73/yr) | Copernicus Sentinel Hub | $0 | ~$0 (still free tier) |
| **Total** | | **$0** | **~$0–25/month** |

> **Caveat:** the $0 number assumes the safeguards in "Quota & Key Protection" are in place. Without referrer/domain restrictions, any visitor (or bot, or anyone who screenshot-shares the URL) can drain both free tiers in hours. The numbers above are not a free pass — they're the cost *given* the safeguards.
>
> At production scale with thousands of fields and automatic daily refresh, Sentinel Hub commercial plans start from approximately $100–200/month. Google Earth Engine commercial minimum is $500/month and is not architecturally suited for live tile serving.

---

## Useful URLs

| Resource | URL |
|---|---|
| ArcGIS developer signup | https://developers.arcgis.com |
| Copernicus Data Space signup | https://dataspace.copernicus.eu |
| Sentinel Hub dashboard | https://shapps.dataspace.copernicus.eu/dashboard |
| Sentinel Hub PU calculator | https://eu-cdse.github.io/CDSE-SH-PU-Calculator |
| MapLibre GL JS docs | https://maplibre.org/maplibre-gl-js/docs |
| terra-draw docs | https://terradraw.io/docs |
| Turf.js docs | https://turfjs.org |
| Esri raster tile service catalog | https://services.arcgisonline.com/arcgis/rest/services |
| TanStack Start — Server / Client routing model | https://tanstack.com/start/latest/docs/framework/react/guide/server-components |

---

*Generated from viz-crop product planning session — May 2026. Updated to reflect TanStack Start scaffold and incorporate findings from adversarial review (Claude Opus 4.7 + GPT-5.5).*
