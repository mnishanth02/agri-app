# viz-crop — Verification & Correction Reference

> **Purpose.** This document is the single authoritative reference derived from primary sources (vendor docs, GitHub repos, npm registry) for every external library and API used in viz-crop. Use it to (a) update `plan.md`, `architecture.md`, and `implementation.md` going forward, and (b) replace the misleading sections of `review-findings.md`.
>
> **Verification date:** 10 May 2026 (corrected 10 May 2026 — see correction note in §3.3 about `@esri/maplibre-arcgis` version).
> **Method:** Each claim below is cross-referenced against the official vendor documentation URL listed in §6. No project-internal context was treated as authoritative during verification.
> **Status of the project:** Phases 0–3 shipped and audited against this document; Phase 4 (EOSDA warm-up) starts next. Phase 0–3 audit results are recorded inline in §4.A1 / A2 / A5.

---

## Table of contents

1. [Document trust hierarchy](#1-document-trust-hierarchy)
2. [Errors in `review-findings.md`](#2-errors-in-review-findingsmd)
3. [Verified specs by phase](#3-verified-specs-by-phase)
   - [3.1 Phase 0/1 — Drizzle + PostGIS for polygons](#31-phase-01--drizzle--postgis-for-polygons)
   - [3.2 Phase 0 — Clerk + Fastify](#32-phase-0--clerk--fastify)
   - [3.3 Phase 2 — MapLibre + ArcGIS basemap](#33-phase-2--maplibre--arcgis-basemap)
   - [3.4 Phase 3 — terra-draw](#34-phase-3--terra-draw)
   - [3.5 Phase 4 — EOSDA hosts, auth, Cropper, Search](#35-phase-4--eosda-hosts-auth-cropper-search)
   - [3.6 Phase 6 — EOSDA Render API](#36-phase-6--eosda-render-api)
   - [3.7 Phase 7 — EOSDA Statistics API](#37-phase-7--eosda-statistics-api)
4. [Action items (prioritized)](#4-action-items-prioritized)
5. [Genuinely unresolved items](#5-genuinely-unresolved-items)
6. [Source citations](#6-source-citations)
7. [Appendix A — Drop-in code snippets](#appendix-a--drop-in-code-snippets)

---

## 1. Document trust hierarchy

When two project docs disagree, use this order:

| Source | Trust | Notes |
|---|---|---|
| This document | ✅ Highest | Verified against primary sources on 10 May 2026; self-correction note in §3.3 about `@esri/maplibre-arcgis` version |
| Vendor docs linked in §6 | ✅ Highest | Re-verify before relying on details older than ~6 months |
| `plan.md`, `architecture.md` | ✅ Aligned (10 May 2026) | A8/A9 deltas applied |
| `implementation.md` Phases 4–8 | ✅ Aligned (10 May 2026) | A3/A4/A7 deltas applied |
| `implementation.md` Phases 0–3 | ✅ Audited (10 May 2026) | Code matches verified specs (see §4 A1/A2/A5) |
| Older drafts of `review-findings.md` | ❌ Untrusted | This document supersedes them; corrections noted in §2 |

---

## 2. Errors in `review-findings.md`

`review-findings.md` was supposed to ground-truth the plan. Independent verification finds that several of its corrections are factually wrong and would introduce bugs if applied. The errors below should be removed or corrected before the document is used as input again.

### 2.1 ❌ "EOSDA does not accept index names as bands" — wrong

- **Cited locations in review-findings.md:** §3.3, §5.1, §8.6 (marked as a "Blocker — do first").
- **The wrong claim:** the Render proxy must translate `band=NDVI` to the formula `(B08-B04)/(B08+B04)` because EOSDA only accepts bands or formulas, not aliases.
- **Ground truth:** EOSDA's own [Quickstart page](https://doc.eos.com/docs/quickstart/) shows this exact example:

  ```
  GET https://api-connect.eos.com/api/render/S2/36/U/XU/2016/5/2/0/NDVI/10/611/354?api_key=<your_api_key>
  ```

  Aliases `NDVI`, `EVI`, `NDWI`, etc. are valid path-segment values. Formulas are an additional capability, not a replacement. The [Image Bands docs](https://doc.eos.com/docs/render/) confirm both forms.
- **Impact if followed:** an unnecessary `INDEX_TO_BAND` translation layer adds maintenance surface, makes the code harder to read, and risks formula-encoding bugs (e.g., `/` characters inside the formula being misinterpreted as path separators by intermediate proxies).
- **What to do:** keep the alias-based approach in `implementation.md` Module 6.3. Treat formulas as an explicitly-documented advanced fallback only.

### 2.2 ❌ "Cropper API endpoint/request format needs EOSDA support email" — wrong

- **Cited locations:** §3.4, §5.2, §8.3, §8.7 Q3.
- **The wrong claim:** the Cropper API creation flow is undocumented and requires a clarification email before it can be implemented.
- **Ground truth:** the endpoint is [documented in full](https://developers.eos.com/cropper.html). The doc lives on EOSDA's older docs site (`developers.eos.com`), while the current `doc.eos.com` Render/Cloud-mask and Colorization pages reference `cropper_ref` as the AOI clipping handle. EOSDA confirms that [`gate.eos.com` and `api-connect.eos.com` are the same backend](https://doc.eos.com/docs/quickstart/what-did-we-change/).
- **Impact if followed:** unnecessary "Path B" fallback paths in Modules 4.2 and 6.3 ship as live code, NDVI tiles never get clipped to the field polygon, and the team waits for support instead of implementing.
- **What to do:** implement Path A directly. See §3.5.3 below for the exact spec.

### 2.3 ❌ "`arcgis/imagery/standard` is the hybrid with labels" — wrong

- **Cited location:** §4.5.
- **The wrong claim:** the `arcgis/imagery/standard` style is the hybrid satellite-plus-labels variant.
- **Ground truth:** per Esri's [own basemap-styles docs](https://developers.arcgis.com/rest/basemap-styles/arcgis-imagery-standard-style-get/) and the [Flutter API enum](https://developers.arcgis.com/flutter/beta/api-reference/api/arcgis_maps/BasemapStyle.html), the three imagery styles are:

  | Style string | What it contains |
  |---|---|
  | `arcgis/imagery` | **Composite:** raster satellite imagery + vector labels |
  | `arcgis/imagery/standard` | Raster satellite imagery only — **no labels** |
  | `arcgis/imagery/labels` | Labels only, no raster |

- **Impact if followed:** if Phase 2 actually shipped using `/standard` (per the review-findings claim that "the actual lib/arcgis.ts uses arcgis/imagery/standard"), the production map has no road or place labels — a visible bug.
- **What to do:** audit `apps/web/src/lib/arcgis.ts` and confirm it passes `'arcgis/imagery'` (not `/standard`). If wrong, two-character fix.

### 2.4 ⚠️ Field Management `id` migration footnote — misleading

- **Cited location:** §3.5.
- **The misleading claim:** "consider migrating `eosda_cropper_ref` to `INTEGER`/`BIGINT` after EOSDA confirms the Cropper response type."
- **Ground truth:** the Cropper API response is a 32-character hex string (e.g., `3eb51ea04776e6ae6bb665504e3c5ffb`). Field Management `id` is a separate numeric ID for a different system. Storing one in the other is wrong by design, and `TEXT` is permanently correct for `eosda_cropper_ref`.
- **What to do:** delete the footnote.

### 2.5 ⚠️ Open-questions table is largely stale

- **Cited location:** §8.7.
- Q1 (formula encoding): not the right question; aliases are the primary path, see §2.1.
- Q3 (Cropper endpoint): resolved by docs, see §2.2.
- Q4 (`sentinel2` vs `sentinel-2`): resolved by docs — `sentinel2` is the correct dataset id; `sentinel2l2a` is a separate dataset, not a synonym.
- Q5 (no-results behavior): partially answered — the [Search docs](https://doc.eos.com/docs/search/simple-search/) show responses include `meta.found` and `results`. With zero results, expect `meta.found: 0` and `results: []`. Worth a 30-second live test, but not blocking.

The only remaining genuinely useful EOSDA support question is the trial rate limit (RPM) and quota.

### 2.6 ✅ Sections of `review-findings.md` that are actually correct

These should be retained:

- §3.6 Statistics API request/response shape
- §5.4 Clerk token-refresh pattern via `tokenRef` and `transformRequest`
- §5.5 Layer ordering rules for MapLibre stack
- §5.6 `warmField` error-handler dedup
- §8.4 Search request body field names
- §8.5 NdviLayer tile URL construction (`encodeURIComponent` on `viewId`)

When rewriting `review-findings.md`, keep these sections, delete the rest.

---

## 3. Verified specs by phase

### 3.1 Phase 0/1 — Drizzle + PostGIS for polygons

#### Reality check

Drizzle's built-in `geometry()` column type **only supports `Point` natively**. The Drizzle docs say verbatim:

> "The current release has a predefined type: `point`, which is the `geometry(Point)` type in the PostgreSQL PostGIS extension. **You can specify any string there if you want to use some other type**."
>
> — [Drizzle PostgreSQL extensions docs](https://orm.drizzle.team/docs/extensions/pg)

What this means concretely:

- The `mode: 'xy'` and `mode: 'tuple'` ergonomic helpers only work for `Point`.
- For `Polygon`, you write raw SQL fragments for ser/des, OR define a custom column type using `customType()` with a `wkx`-based fromDriver.
- There is an [open issue](https://github.com/drizzle-team/drizzle-orm/issues/3040) where `drizzle-kit generate` emits `geometry(point)` instead of the configured `geometry(Polygon, 4326)` for polygon columns. Hand-edit the first migration after generation.

#### The pattern to use

In `db/schema.ts`:

```ts
import { pgTable, uuid, text, timestamp, geometry } from 'drizzle-orm/pg-core';

export const fields = pgTable('fields', {
  id: uuid('id').primaryKey().defaultRandom(),
  // ... other columns
  // Drizzle accepts the `polygon` type string but does NOT auto-serialize.
  // Treat `geometry` as opaque on insert/select; use SQL helpers in service code.
  geometry: geometry('geometry', { type: 'polygon', srid: 4326 }).notNull(),
});
```

In `apps/api/src/services/geom.ts`:

```ts
import { sql, type SQL } from 'drizzle-orm';
import type { Polygon } from 'geojson';

/** Use in `.values({ geometry: polygonToSql(polygon) })` */
export function polygonToSql(polygon: Polygon): SQL {
  return sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(polygon)}), 4326)`;
}

/** Use in `.select({ geometry: sqlToPolygon(fields.geometry), ... })` */
export function sqlToPolygon(column: typeof fields.geometry): SQL<Polygon> {
  return sql<Polygon>`ST_AsGeoJSON(${column})::json`;
}
```

#### First migration must enable PostGIS

Drizzle does not auto-create the extension. The first migration file must contain:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

#### After `drizzle-kit generate`

Inspect the generated SQL for the polygon column. If it says `geometry(point)`, hand-edit it to `geometry(Polygon, 4326)`. Track this in CI: `drizzle-kit generate` should be reviewed before commit, not auto-applied.

---

### 3.2 Phase 0 — Clerk + Fastify

Confirmed against [official Fastify quickstart](https://clerk.com/docs/quickstarts/fastify) and [`clerkPlugin()` reference](https://clerk.com/docs/reference/fastify/clerk-plugin).

#### Verified usage

```ts
import 'dotenv/config';                    // MUST run before any @clerk/fastify import
import Fastify from 'fastify';
import { clerkPlugin, getAuth } from '@clerk/fastify';

const fastify = Fastify({ logger: true });

await fastify.register(clerkPlugin, {
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  secretKey: process.env.CLERK_SECRET_KEY,
});

// In a route handler:
const { isAuthenticated, userId } = getAuth(request);
if (!isAuthenticated) return reply.code(401).send({ error: 'Unauthorized' });
```

#### Notes

- `isAuthenticated` is the current canonical check; `userId` truthy still works as a legacy check.
- `dotenv` must be imported **before** `@clerk/fastify` because the plugin reads env at module-init time. The plan correctly documents this.
- For machine-to-machine tokens, pass `acceptsToken: 'any'` to `getAuth()`. Not needed for v2 of viz-crop.

---

### 3.3 Phase 2 — MapLibre + ArcGIS basemap

#### MapLibre version

- **Latest stable:** `maplibre-gl@5.24.0` (April 2026).
- **Next major:** `maplibre-gl@6.0.0` (in `next` channel; ESM-only, drops UMD bundles, requires WebGL2). Do not adopt for v2.
- **Plan decision (pin to v5):** correct. Keep `^5.24.0` or pin exact.

#### `@esri/maplibre-arcgis` version

- **Latest published (npm `latest` dist-tag):** `1.2.0` (verified against the npm registry on 10 May 2026 — `https://registry.npmjs.org/@esri/maplibre-arcgis` returns `"dist-tags":{"beta":"1.0.0-beta.3","latest":"1.2.0"}`).
- **Plan currently cites `^1.2.0`:** ✅ correct. The shipped Phase 2 install resolves to `1.2.0` and is functional.
- **Correction note (10 May 2026):** an earlier draft of this document claimed `1.2.0` did not exist on npm and recommended pinning to `^1.1.0`. That claim was based on a stale read of the developers.arcgis.com API reference page. The npm registry is authoritative for published versions. **No package change is required.** Action item A2 in §4 has been retired — do not downgrade.

#### Basemap style — definitive truth table

Source: [Esri Basemap Styles types reference](https://developers.arcgis.com/rest/basemap-styles/arcgis-imagery-standard-style-get/), [Flutter API enum](https://developers.arcgis.com/flutter/beta/api-reference/api/arcgis_maps/BasemapStyle.html), [Game Engine API reference](https://developers.arcgis.com/unity/api-reference/gameengine/map/arcgisbasemapstyle/).

| String | Composition | Use for v2? |
|---|---|---|
| `arcgis/imagery` | Composite: raster satellite + vector labels | ✅ **Yes** — this is "satellite + roads/places" |
| `arcgis/imagery/standard` | Raster satellite imagery only, no labels | ❌ No |
| `arcgis/imagery/labels` | Labels only, no raster | ❌ No |

#### Verified API

```ts
import maplibregl from 'maplibre-gl';
import maplibreArcGIS from '@esri/maplibre-arcgis';

const map = new maplibregl.Map({ container: 'map', center: [75.7139, 15.3173], zoom: 8 });

const basemapStyle = maplibreArcGIS.BasemapStyle.applyStyle(map, {
  style: 'arcgis/imagery',          // composite — includes labels
  token: process.env.VITE_ESRI_API_KEY,
});
```

After `applyStyle` resolves (style.load fired), the map style will contain raster `imagery` layers plus vector `symbol` layers for labels. Use `findFirstSymbolLayerId(map)` to discover the first label layer at runtime; never hard-code Esri layer IDs.

---

### 3.4 Phase 3 — terra-draw

Confirmed against the [official getting-started guide](https://github.com/JamesLMilner/terra-draw/blob/main/guides/1.GETTING_STARTED.md) and [adapters guide](https://github.com/JamesLMilner/terra-draw/blob/main/guides/3.ADAPTERS.md).

| Package | Verified version (May 2026) | MapLibre peer support |
|---|---|---|
| `terra-draw` | `1.29.0` | n/a |
| `terra-draw-maplibre-gl-adapter` | latest (kept in lockstep) | MapLibre v4 / v5 |

#### Verified API

```ts
import maplibregl from 'maplibre-gl';
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';

// Style must be loaded before creating Terra Draw
map.on('style.load', () => {
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),  // no `lib` param needed
    modes: [new TerraDrawPolygonMode(), new TerraDrawSelectMode({ /* ... */ })],
  });

  draw.start();
  draw.setMode('polygon');
});
```

Plan and shipped Phase 3 code already match this. No corrections.

---

### 3.5 Phase 4 — EOSDA hosts, auth, Cropper, Search

#### 3.5.1 Hosts — both work, prefer `api-connect.eos.com`

Direct quote from [EOSDA migration page](https://doc.eos.com/docs/quickstart/what-did-we-change/):

> "The URL name has been changed from `https://gate.eos.com` to `https://api-connect.eos.com`. While the old gate URL will continue to be supported, we encourage users to transition to the new api-connect URL."

**Implication:** they are the same backend. No host fallback logic needed. Use `https://api-connect.eos.com` everywhere.

#### 3.5.2 Authentication

- **Preferred:** `x-api-key: <key>` HTTP header on every request.
- **Fallback only:** `?api_key=<key>` query parameter — only if a specific endpoint rejects the header (none observed in v2 surface).
- **Logging rule:** never log the full URL when it carries the key. Log path + status only.

#### 3.5.3 Cropper API — full spec

**Endpoint:**

```
POST https://api-connect.eos.com/api/render/cropper/
```

**Headers:**

```
Content-Type: application/json
x-api-key: <EOSDA_API_KEY>
```

**Body:** GeoJSON Feature with a `Polygon` geometry. Properties may be empty.

```json
{
  "type": "Feature",
  "properties": {},
  "geometry": {
    "type": "Polygon",
    "coordinates": [
      [[lon, lat], [lon, lat], ... , [lon, lat]]
    ]
  }
}
```

**Response (200 OK):**

```json
{ "cropper_ref": "3eb51ea04776e6ae6bb665504e3c5ffb" }
```

The returned value is a 32-character hex string. Persist it verbatim in `fields.eosda_cropper_ref` (`TEXT` column).

**Re-use:** the same `cropper_ref` is reusable for the polygon's lifetime. There's no documented expiration; treat the `(field_id, cropper_ref)` mapping as durable. If the field polygon is later edited, create a new cropper and update the column.

**Use with Render tiles (preview):**

```
GET https://api-connect.eos.com/api/render/<view_id>/<band>/<z>/<x>/<y>?cropper_ref=<hash>
```

— see §3.6 for full Render spec.

**Source:** [Cropper API docs](https://developers.eos.com/cropper.html); cross-references at [Cloud-mask tile API](https://doc.eos.com/docs/render/cloud-mask/), [Colorization API](https://doc.eos.com/docs/colorization/colorization-api/).

#### 3.5.4 Search API — full spec

**Endpoint (single dataset, recommended):**

```
POST https://api-connect.eos.com/api/lms/search/v2/sentinel2
```

**Headers:**

```
Content-Type: application/json
x-api-key: <EOSDA_API_KEY>
```

(The docs show `Content-Type: text/plain` in some examples even though the body is JSON. Start with `application/json`; if the Module 4.1 live Search smoke rejects it, fall back to `text/plain` for Search only.)

**Body:**

```json
{
  "intersection_validation": true,
  "fields": [
    "sceneID",
    "view_id",
    "date",
    "cloudCoverage",
    "dataCoveragePercentage",
    "tms"
  ],
  "limit": 10,
  "page": 1,
  "search": {
    "date": { "from": "2026-02-09", "to": "2026-05-10" },
    "cloudCoverage": { "from": 0, "to": 80 },
    "shape": { "type": "Polygon", "coordinates": [ [ [lon, lat], ... ] ] },
    "shapeRelation": "CONTAINS"
  },
  "sort": { "date": "desc" }
}
```

**Response shape:**

```json
{
  "meta": { "found": 17, "page": 1, "limit": 10, "name": "satellite-meta-service" },
  "results": [
    {
      "sceneID": "S2B_tile_20230731_16TEL_0",
      "view_id": "S2/16/T/EL/2023/7/31/0",
      "date": "2023-07-31",
      "cloudCoverage": 2.0,
      "dataCoveragePercentage": 100.0,
      "sunElevation": 62.71,
      "tms": "https://render.eosda.com/S2/16/T/EL/2023/7/31/0/{band}/{z}/{x}/{y}"
    }
    // ...
  ]
}
```

**Field name normalization (response → app):**

| EOSDA response | App-side `SceneDto` | Notes |
|---|---|---|
| `sceneID` | `sceneId` | EOSDA uses capital ID; app uses camelCase |
| `view_id` | `viewId` | EOSDA snake_case → app camelCase |
| `date` (string `YYYY-MM-DD`) | `sceneDate` | Disambiguate from arbitrary "date" |
| `cloudCoverage` (0–100) | `cloudPercent` | Same scale |
| `dataCoveragePercentage` | `dataCoveragePercent` | Same scale |
| `tms` | `tmsTemplate` | URL with `{band}/{z}/{x}/{y}` placeholders; docs may return `render.eosda.com`, so store it as metadata only and build app tiles from `view_id` through our proxy |

**Empty-results behavior:** expected to return `200 OK` with `meta.found: 0` and `results: []`. Worth a 30-second live test to confirm but should not block Phase 4.

**Multi-dataset variant:** `POST /api/lms/search/v2` (no dataset in path) accepts `search.satellites: ["sentinel2", "landsat8", ...]`. v2 of viz-crop only needs `sentinel2`.

**Sources:** [Single dataset search](https://doc.eos.com/docs/search/simple-search/), [Multi-dataset search](https://doc.eos.com/docs/search/multi-dataset-search/).

---

### 3.6 Phase 6 — EOSDA Render API

#### Endpoint

```
GET https://api-connect.eos.com/api/render/<view_id>/<band>/<z>/<x>/<y>
```

#### Path parameters

| Param | Example | Notes |
|---|---|---|
| `<view_id>` | `S2/16/T/EL/2023/7/31/0` | **Contains slashes**; receive as URL-encoded query param from the browser, decode before building the upstream URL. |
| `<band>` | `NDVI` | Allowed for v2: `NDVI`, `EVI`, `NDWI`. Aliases work directly — no formula translation needed (see §2.1). |
| `<z>/<x>/<y>` | `10/611/354` | Slippy-map tile coordinates, integers. |

#### Query parameters

| Param | Required | Value (v2) | Purpose |
|---|---|---|---|
| `cropper_ref` | Optional | Hash from §3.5.3 | Polygon-clipped tile (transparent outside AOI) |
| `CALIBRATE` | Optional | `1` | Convert to surface reflectance |
| `COLORMAP` | Optional; set by v2 proxy | `RdYlGn` (NDVI/EVI), `Blues` (NDWI) | Apply stable app-side visualization. EOSDA documents default range colorization for some aliases, but explicit values keep output predictable. |
| `MIN_MAX` | Optional; set by v2 proxy | `-1,1` | Contrast stretch over normalized index range |
| `mimetype` | Optional | `image/png` | Output format |

**Auth:** `x-api-key` header (preferred), `?api_key=` query (fallback only).

#### Verified example

```
GET https://api-connect.eos.com/api/render/S2/36/U/XU/2016/5/2/0/NDVI/10/611/354?api_key=<key>
```

— confirmed in [EOSDA Quickstart docs](https://doc.eos.com/docs/quickstart/) as a working example.

#### Render proxy behavior (v2)

```ts
// apps/api/src/routes/eosda.render.ts (sketch)

const ALLOWED_BANDS = new Set(['NDVI', 'EVI', 'NDWI']);
const COLOR_DEFAULTS: Record<string, { COLORMAP: string; MIN_MAX: string }> = {
  NDVI: { COLORMAP: 'RdYlGn', MIN_MAX: '-1,1' },
  EVI:  { COLORMAP: 'RdYlGn', MIN_MAX: '-1,1' },
  NDWI: { COLORMAP: 'Blues',  MIN_MAX: '-1,1' },
};

// In handler:
const viewId = decodeURIComponent(req.query.viewId as string);  // contains '/'
const band = req.query.band as string;
if (!ALLOWED_BANDS.has(band)) return reply.code(400).send({ error: 'BAD_BAND' });

// Ownership check + cached_scenes existence check elided

const params = new URLSearchParams({
  CALIBRATE: '1',
  mimetype: 'image/png',
  ...COLOR_DEFAULTS[band],                 // safe to set unconditionally
});
if (field.eosda_cropper_ref) params.set('cropper_ref', field.eosda_cropper_ref);

const upstream = `https://api-connect.eos.com/api/render/${viewId}/${band}/${z}/${x}/${y}?${params}`;
const r = await fetch(upstream, { headers: { 'x-api-key': process.env.EOSDA_API_KEY! } });
// ... stream r.body to reply, set Cache-Control: private, max-age=86400
```

**Key gotcha:** `view_id` contains literal `/` characters. The browser sends it as a URL-encoded query param (`?viewId=S2%2F16%2FT%2FEL%2F2023%2F7%2F31%2F0`); the proxy must `decodeURIComponent` before embedding it back into the upstream path. The MapLibre tile URL template uses `encodeURIComponent` on viewId once (the `{z}/{x}/{y}` placeholders themselves must remain unencoded so MapLibre can substitute).

**Sources:** [Image Bands / Render docs](https://doc.eos.com/docs/render/), [Quickstart NDVI example](https://doc.eos.com/docs/quickstart/), [Cropper API docs](https://developers.eos.com/cropper.html).

---

### 3.7 Phase 7 — EOSDA Statistics API

#### Endpoints

```
POST   https://api-connect.eos.com/api/gdw/api      # create task
GET    https://api-connect.eos.com/api/gdw/api/<task_id>   # poll task
```

#### Create-task body

```json
{
  "type": "mt_stats",
  "params": {
    "bm_type": ["NDVI", "EVI", "NDWI"],
    "date_start": "2026-01-01",
    "date_end":   "2026-05-09",
    "geometry": {
      "type": "Polygon",
      "coordinates": [ [ [lon, lat], ... ] ]
    },
    "reference": "<unique-request-id>",
    "sensors": ["sentinel2"],
    "limit": 100,
    "max_cloud_cover_in_aoi": 80,
    "cloud_masking_level": 1,
    "exclude_cover_pixels": true
  }
}
```

**Standalone verification correction (10 May 2026):** keep `mt_stats` geometry-based. Current EOSDA Statistics docs list `params.geometry` as the AOI input for `mt_stats`; `cropper_ref` is documented for Render/imagery contexts, but not as a supported replacement for Statistics `geometry`. Do not send `cropper_ref` to `mt_stats` unless a future live/vendor test explicitly confirms it.

**Index limit:** up to **3** indices per request via `bm_type`. Date range up to **365 days** is the recommended max.

#### Create-task response

```json
{
  "status": "created",
  "task_id": "00dd1775-4fe4-420f-9ab8-19e967233154",
  "req_id": "4554a79d-7b7c-4515-a94f-7ceeab2417c2",
  "task_timeout": 172800
}
```

`task_timeout` is in **seconds** and is the upper bound the server may take. For interactive sync polling in the route handler, cap at `min(task_timeout, 60)` and return 504 to the client past that, with a retry hint.

#### Poll response (when complete)

```json
{
  "errors": [],
  "result": [
    {
      "scene_id": "S2B_tile_20200609_16TEL_0",
      "view_id": "S2/16/T/EL/2020/6/9/0",
      "date": "2020-06-09",
      "cloud": 0.0,
      "indexes": {
        "NDVI": {
          "average": 0.106,
          "median":  0.108,
          "min": -0.112, "max":  0.282,
          "std":  0.063, "variance": 0.004,
          "q1":   0.062, "q3":   0.156,
          "p10":  0.026, "p90":  0.185
        },
        "EVI":  { /* ... */ },
        "NDWI": { /* ... */ }
      }
    }
    // ... one entry per scene in the date range
  ]
}
```

**Field-name notes:** statistics responses use `scene_id` (snake_case) while Search uses `sceneID` (camelCase with capital ID). Normalize both to the app's `sceneId`. Map `average` → display label "Mean".

**Polling pattern:**

- Interval: 2 seconds
- Max wait: `min(task_timeout, 60)` seconds
- On timeout: HTTP 504 with `{ error: 'STATS_TIMEOUT', taskId }`; client retries after 10 s
- On EOSDA server error: HTTP 502 with structured body
- On success: upsert to `cached_ndvi_stats`, return DTO

**Rate limits:** Statistics task-creation and polling endpoints are each capped at 10 requests/minute per API key. Client-side debounce + cache absorbs most calls.

**Sources:** [Statistics API overview](https://doc.eos.com/docs/statistics/), [Vegetation indices analytics](https://doc.eos.com/docs/statistics/vegetation-indices-analytics/), [FAQ — rate limits](https://doc.eos.com/docs/faq/), [Download multi-temporal statistics (older docs, more detail)](https://developers.eos.com/download_mt_stats.html).

---

## 4. Action items (prioritized)

Apply in order. Each item lists files to edit and a precise change.

### A1. Audit the shipped Phase 2 basemap style — ✅ done (10 May 2026)

Result: `apps/web/src/lib/arcgis.ts` passes `'arcgis/imagery'` (the composite hybrid with labels). No change required. The file also includes a `findFirstSymbolLayerId` runtime sanity check that warns if Esri ever ships a label-free payload.

### A2. Pin `@esri/maplibre-arcgis` — ✅ retired (10 May 2026)

This action item was based on a self-error in this document (an earlier draft claimed `1.2.0` did not exist on npm). Verified against the npm registry: `1.2.0` is the current `latest` dist-tag. `apps/web/package.json` already declares `^1.2.0`, the lockfile resolves to `1.2.0`, and the app is functional. Do not downgrade.

### A3. Update `implementation.md` Phase 4 — collapse Path A/B hedging — ✅ applied (10 May 2026)

Applied to `docs/implementation.md`:

- Module 4.2 renamed (drops the "(conditional)" suffix); body references this doc §3.5.3 verbatim. `getOrCreateCropperRef(field)` always attempts the POST; on 2xx persists; on non-2xx logs `{ fieldId, status, body }` and returns `null` so warm-up continues.
- Module 4.5 (`warmField`) runs Cropper + Search in parallel via `Promise.allSettled`. Cropper persistence stays inside `getOrCreateCropperRef`; the single `.catch(...)` in Module 4.6 is the one true error handler.
- Phase 4 exit criteria now reads: "`eosda_cropper_ref` is populated from a successful Cropper API POST; if the POST fails, the column stays NULL and a structured log line records the failure."
- Pending Items table: row 4.2 removed; row 4.3 reframed as a 30-second live test of the empty-results response shape.
- Phase 4 goal paragraph updated to drop the "only after the Cropper API creation flow is confirmed" hedge.

### A4. Update `implementation.md` Phase 6 Module 6.3 — remove formula translation — ✅ applied (10 May 2026)

Applied to `docs/implementation.md` Module 6.3:

- Module 6.3 now references this doc §2.1 to make clear that aliases `NDVI`/`EVI`/`NDWI` are passed through directly to EOSDA — no `INDEX_TO_BAND` formula map.
- `COLORMAP`/`MIN_MAX` defaults are baked in **unconditionally** per §3.6: `NDVI`/`EVI` → `RdYlGn`/`-1,1`; `NDWI` → `Blues`/`-1,1`. Harmless if EOSDA's default already matches; required if it falls back to grayscale.

### A5. Add Phase 1 Module 1.3 polygon ser/des contract — ✅ applied to docs (10 May 2026)

The contract is now documented inline in `docs/implementation.md` Module 1.3 as a blockquote referencing this document's §3.1. The shipped helpers in [`apps/api/src/db/geometry.ts`](../apps/api/src/db/geometry.ts) (`geometryFromGeoJson` / `geometryToGeoJson`) already match the contract; no code change required. The CHECK constraints `fields_geometry_valid` and `fields_geometry_srid` in `0000_green_swarm.sql` enforce SRID 4326 and `ST_IsValid` at the DB.

### A6. Rewrite `review-findings.md` — superseded (10 May 2026)

This file IS the rewritten reference. Self-correction headers in §3.3, A1, A2, A5, and the trust-hierarchy table mark every change applied. There is no separate "prior" review-findings.md to discard — this document is the single source of EOSDA / vendor-spec truth and should be re-verified before its next consumer.

### A7. EOSDA support email — reduce scope — ✅ applied (10 May 2026)

Applied to `docs/plan.md` (Pre-flight §2) and `docs/implementation.md` (Pre-flight P.2). The email now asks only:

1. Trial rate-limit (RPM) per endpoint group.
2. Total monthly request quota for trial.

The Cropper-endpoint and formula-encoding questions have been removed; both are answered by docs.

### A8. Update `architecture.md` §6 (API surface) — ✅ applied (10 May 2026)

Applied to `docs/architecture.md`:

- API surface row for `GET /api/eosda/render/...` now reads "adds that field's `cropper_ref` (populated unconditionally during warm-up via `POST /api/render/cropper/`)".
- Caching strategy row for cropper refs no longer says "required only for clipped render tiles once EOSDA confirms the Cropper creation flow"; it now describes the documented populate/reuse/fallback flow.
- Async-warm bullet in §4 also dropped the "when EOSDA's Cropper creation flow is confirmed" hedge.

### A9. Update `plan.md` review-corrections preamble — ✅ applied (10 May 2026)

Applied to `docs/plan.md`:

- Review-corrections bullet now reads: "`cropper_ref` is created during warm-up via `POST /api/render/cropper/`; the returned 32-character hex hash is persisted in `fields.eosda_cropper_ref` (TEXT) and added as a query param to every Render tile request. If the POST fails, the column stays NULL and Render falls back to scene-wide tiles under the field outline."
- Risk §6 #7 rewritten to drop the "not yet confirmed" framing and document the populate/reuse/fallback flow.
- Decision-log row "EOSDA Cropper fallback" renamed to "EOSDA Cropper integration" with the full flow described.

---

## 5. Genuinely unresolved items

These remain as live-test or vendor-confirm tasks. None are blocking for Phase 4 startup.

| # | Item | Resolution path | Blocks |
|---|---|---|---|
| U1 | Confirm Cropper POST host: does `api-connect.eos.com/api/render/cropper/` return `cropper_ref` against a trial key, or is `gate.eos.com` required for that one endpoint? | One live POST, ~5 min | Module 4.2 |
| U2 | Search empty-results response shape (`results: []` vs error?) | One live Search with a polygon outside Sentinel-2 coverage | Module 4.5 fallback logic |
| U3 | Live smoke for Render header auth and final alias visualization | One live tile fetch, view in browser | Module 6.3 closeout; v2 sets explicit `COLORMAP`/`MIN_MAX` regardless of EOSDA defaults |
| U4 | Trial rate limits (RPM, monthly quota) for Render, Search, Statistics | EOSDA support email | Capacity planning |

---

## 6. Source citations

Current `doc.eos.com` URLs were re-verified on 10 May 2026. Legacy `developers.eos.com` URLs are retained as older reference citations, but this standalone pass could not extract them from the local shell/fetch tools; prefer the current `doc.eos.com` surface when both exist.

### Drizzle ORM + PostGIS
- [Drizzle PostgreSQL extensions](https://orm.drizzle.team/docs/extensions/pg)
- [Drizzle PostGIS geometry point guide](https://orm.drizzle.team/docs/guides/postgis-geometry-point)
- [GitHub issue #3040 — polygon SRID generation bug](https://github.com/drizzle-team/drizzle-orm/issues/3040)
- [GitHub discussion #2383 — geometry types](https://github.com/drizzle-team/drizzle-orm/discussions/2383)

### Clerk Fastify
- [Clerk Fastify quickstart](https://clerk.com/docs/quickstarts/fastify)
- [`clerkPlugin()` reference](https://clerk.com/docs/reference/fastify/clerk-plugin)
- [`getAuth()` reference](https://clerk.com/docs/reference/fastify/get-auth)

### MapLibre + ArcGIS plugin
- [MapLibre GL JS introduction](https://maplibre.org/maplibre-gl-js/docs/) (current: 5.24.0)
- [`@esri/maplibre-arcgis` GitHub repo](https://github.com/Esri/maplibre-arcgis)
- [`@esri/maplibre-arcgis` API reference](https://developers.arcgis.com/maplibre-gl-js/api-reference/) (current: 1.1.0)
- [BasemapStyle class reference](https://developers.arcgis.com/maplibre-gl-js/api-reference/BasemapStyle/)
- [ArcGIS Imagery Standard style endpoint](https://developers.arcgis.com/rest/basemap-styles/arcgis-imagery-standard-style-get/)
- [ArcGIS Basemap Styles overview](https://developers.arcgis.com/documentation/mapping-and-location-services/mapping/basemaps/arcgis-styles)
- [Flutter BasemapStyle enum (clearest description of imagery vs imagery/standard)](https://developers.arcgis.com/flutter/beta/api-reference/api/arcgis_maps/BasemapStyle.html)

### terra-draw
- [terra-draw GitHub](https://github.com/JamesLMilner/terra-draw)
- [Getting started guide](https://github.com/JamesLMilner/terra-draw/blob/main/guides/1.GETTING_STARTED.md)
- [Adapters guide](https://github.com/JamesLMilner/terra-draw/blob/main/guides/3.ADAPTERS.md)

### EOSDA — overview & migration
- [API Connect main docs (`doc.eos.com`)](https://doc.eos.com/)
- [Quickstart](https://doc.eos.com/docs/quickstart/) — confirms `NDVI` alias example URL
- [What did we change (host migration notice)](https://doc.eos.com/docs/quickstart/what-did-we-change/)
- [FAQ](https://doc.eos.com/docs/faq/)

### EOSDA — Cropper
- [Cropper API (older docs, full spec)](https://developers.eos.com/cropper.html)

### EOSDA — Search
- [Single dataset search](https://doc.eos.com/docs/search/simple-search/)
- [Multi-dataset search](https://doc.eos.com/docs/search/multi-dataset-search/)
- [Search requests (older docs, complete field list)](https://developers.eos.com/search_request.html)

### EOSDA — Render
- [Render / Image Bands API](https://doc.eos.com/docs/render/)
- [Cloud-mask tile API (cropper_ref usage on api-connect host)](https://doc.eos.com/docs/render/cloud-mask/)
- [Image tile API (older docs, full param table)](https://developers.eos.com/image_tile.html)
- [Colorization API (cropper_ref + colormap)](https://doc.eos.com/docs/colorization/colorization-api/)

### EOSDA — Statistics
- [Statistics API](https://doc.eos.com/docs/statistics/)
- [Vegetation indices analytics](https://doc.eos.com/docs/statistics/vegetation-indices-analytics/)
- [Download multi-temporal statistics (older docs, complete poll-response example)](https://developers.eos.com/download_mt_stats.html)

### EOSDA — Field Management (referenced but not used for cropper)
- [Field Management API](https://doc.eos.com/docs/field-management-api/field-management/)

---

## Appendix A — Drop-in code snippets

### A.1 `apps/api/src/services/eosda-client.ts`

```ts
const EOSDA_BASE = 'https://api-connect.eos.com';

export class EosdaError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: unknown,
  ) {
    super(`EOSDA ${status} on ${path}`);
  }
}

export async function eosdaRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const r = await fetch(`${EOSDA_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.EOSDA_API_KEY!,
      ...init.headers,
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    // Log path only — never the full URL with query params (may carry api_key)
    throw new EosdaError(r.status, path, body);
  }
  return (await r.json()) as T;
}
```

### A.2 `apps/api/src/services/eosda-cropper.ts`

```ts
import type { Polygon } from 'geojson';
import { eosdaRequest } from './eosda-client';
import { db } from '../db';
import { fields } from '../db/schema';
import { eq } from 'drizzle-orm';

interface CropperResponse { cropper_ref: string }

export async function getOrCreateCropperRef(field: {
  id: string;
  geometry: Polygon;
  eosda_cropper_ref: string | null;
}): Promise<string | null> {
  if (field.eosda_cropper_ref) return field.eosda_cropper_ref;

  try {
    const { cropper_ref } = await eosdaRequest<CropperResponse>(
      '/api/render/cropper/',
      {
        method: 'POST',
        body: JSON.stringify({
          type: 'Feature',
          properties: {},
          geometry: field.geometry,
        }),
      },
    );
    await db
      .update(fields)
      .set({ eosda_cropper_ref: cropper_ref })
      .where(eq(fields.id, field.id));
    return cropper_ref;
  } catch (err) {
    // Log but do not throw — warm-up continues, render falls back to scene-wide tiles
    console.error({ err, fieldId: field.id }, 'cropper creation failed');
    return null;
  }
}
```

### A.3 `apps/api/src/services/eosda-search.ts`

```ts
import type { Polygon } from 'geojson';
import { eosdaRequest } from './eosda-client';

export interface SceneDto {
  sceneId: string;
  viewId: string;
  sceneDate: string;          // YYYY-MM-DD
  cloudPercent: number;
  dataCoveragePercent: number;
  tmsTemplate: string;
}

interface RawSearchResult {
  sceneID: string;
  view_id: string;
  date: string;
  cloudCoverage: number;
  dataCoveragePercentage: number;
  tms: string;
}

export async function searchScenes(opts: {
  geometry: Polygon;
  from: string;               // YYYY-MM-DD
  to: string;                 // YYYY-MM-DD
  limit?: number;
}): Promise<SceneDto[]> {
  const r = await eosdaRequest<{ results: RawSearchResult[]; meta: { found: number } }>(
    '/api/lms/search/v2/sentinel2',
    {
      method: 'POST',
      body: JSON.stringify({
        fields: ['sceneID', 'view_id', 'date', 'cloudCoverage', 'dataCoveragePercentage', 'tms'],
        limit: opts.limit ?? 10,
        page: 1,
        search: {
          date: { from: opts.from, to: opts.to },
          cloudCoverage: { from: 0, to: 80 },
          shape: opts.geometry,
          shapeRelation: 'CONTAINS',
        },
        sort: { date: 'desc' },
      }),
    },
  );

  return r.results.map((raw) => ({
    sceneId: raw.sceneID,
    viewId: raw.view_id,
    sceneDate: raw.date,
    cloudPercent: raw.cloudCoverage,
    dataCoveragePercent: raw.dataCoveragePercentage,
    tmsTemplate: raw.tms,
  }));
}
```

### A.4 `apps/api/src/services/field-warmup.ts`

```ts
import { db } from '../db';
import { fields } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getOrCreateCropperRef } from './eosda-cropper';
import { searchScenes } from './eosda-search';
import { upsertScenes } from './scene-cache';

export async function warmField(fieldId: string): Promise<void> {
  const [field] = await db.select().from(fields).where(eq(fields.id, fieldId));
  if (!field) return;

  // Compute a recent date window for "latest scene"
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Cropper creation and Search are independent — run in parallel.
  const [cropperResult, scenesResult] = await Promise.allSettled([
    getOrCreateCropperRef(field),
    searchScenes({ geometry: field.geometry, from, to, limit: 1 }),
  ]);

  if (cropperResult.status === 'rejected') {
    // already logged inside the helper; nothing to do here
  }

  if (scenesResult.status === 'fulfilled' && scenesResult.value.length > 0) {
    await upsertScenes(fieldId, scenesResult.value);
  }
  // On no scenes in 90 days, caller can extend the window via /api/eosda/scenes
}
```

### A.5 `apps/api/src/routes/eosda.render.ts` (sketch)

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db';
import { fields, cachedScenes } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { getAuth } from '@clerk/fastify';

const ALLOWED = new Set(['NDVI', 'EVI', 'NDWI'] as const);
const COLOR: Record<string, { COLORMAP: string; MIN_MAX: string }> = {
  NDVI: { COLORMAP: 'RdYlGn', MIN_MAX: '-1,1' },
  EVI:  { COLORMAP: 'RdYlGn', MIN_MAX: '-1,1' },
  NDWI: { COLORMAP: 'Blues',  MIN_MAX: '-1,1' },
};

const params = z.object({
  z: z.coerce.number().int(),
  x: z.coerce.number().int(),
  y: z.coerce.number().int(),
});
const query = z.object({
  fieldId: z.string().uuid(),
  viewId: z.string().min(1),
  band: z.enum(['NDVI', 'EVI', 'NDWI']),
});

export async function renderRoute(app: FastifyInstance) {
  app.get('/api/eosda/render/:z/:x/:y', async (req, reply) => {
    const { userId, isAuthenticated } = getAuth(req);
    if (!isAuthenticated) return reply.code(401).send();

    const p = params.parse(req.params);
    const q = query.parse(req.query);

    const viewId = decodeURIComponent(q.viewId);
    if (viewId.includes('..')) return reply.code(400).send();

    const [field] = await db
      .select()
      .from(fields)
      .where(and(eq(fields.id, q.fieldId), eq(fields.userId, userId!)));
    if (!field) return reply.code(403).send();

    const [scene] = await db
      .select()
      .from(cachedScenes)
      .where(and(eq(cachedScenes.fieldId, q.fieldId), eq(cachedScenes.viewId, viewId)));
    if (!scene) return reply.code(404).send();

    const u = new URLSearchParams({
      CALIBRATE: '1',
      mimetype: 'image/png',
      ...COLOR[q.band],
    });
    if (field.eosda_cropper_ref) u.set('cropper_ref', field.eosda_cropper_ref);

    const upstreamPath = `/api/render/${viewId}/${q.band}/${p.z}/${p.x}/${p.y}`;
    const r = await fetch(`https://api-connect.eos.com${upstreamPath}?${u}`, {
      headers: { 'x-api-key': process.env.EOSDA_API_KEY! },
    });

    if (!r.ok) {
      req.log.error({ status: r.status, path: upstreamPath }, 'EOSDA render failed');
      return reply.code(r.status).send();
    }

    reply
      .header('Content-Type', 'image/png')
      .header('Cache-Control', 'private, max-age=86400');
    return reply.send(Buffer.from(await r.arrayBuffer()));
  });
}
```

---

*End of document. Update this file (and bump the verification date at the top) any time a vendor doc is checked again.*