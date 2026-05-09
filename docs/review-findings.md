# Plan & Implementation Review Findings

> Generated: 2026-05-09  
> Scope: `plan.md`, `implementation.md` — cross-checked against official docs for terra-draw, EOSDA API, Clerk, MapLibre, and @esri/maplibre-arcgis.  
> Purpose: Identify corrections, gaps, and open questions before continuing Phase 2/3 implementation.

---

## Table of Contents

1. [Package Validation — What's Confirmed](#1-package-validation--whats-confirmed)
2. [Terra Draw — Corrections & Confirmations](#2-terra-draw--corrections--confirmations)
3. [EOSDA API — Detailed Corrections](#3-eosda-api--detailed-corrections)
4. [Cross-Document Issues](#4-cross-document-issues)
5. [Architecture Gaps](#5-architecture-gaps)
6. [Action Items](#6-action-items)

---

## 1. Package Validation — What's Confirmed

| Package | Plan Says | Actual | Status |
|---|---|---|---|
| `@esri/maplibre-arcgis` | `^1.2.0`, `BasemapStyle.applyStyle()` | ✅ Installed at `^1.2.0`, API confirmed | ✅ Correct |
| ArcGIS style name | `'arcgis/imagery'` then switch if no labels | Code already uses `'arcgis/imagery/standard'` | ⚠️ Plan outdated — update plan to specify `/standard` directly |
| `@clerk/react` | Clerk Core 3, replaces `@clerk/clerk-react` | ✅ Installed at `6.6.1`, correct package | ✅ Correct |
| `@clerk/fastify` | `clerkPlugin()` + `getAuth()` + `CLERK_SECRET_KEY` | ✅ Installed at `3.1.24`, all APIs confirmed | ✅ Correct |
| `maplibre-gl` | `^5.24.0`, `transformRequest` at construction | ✅ Confirmed, pinned v5 correct | ✅ Correct |
| `terra-draw` | Main package | ✅ Separate npm package, correct name | ✅ Correct |
| `terra-draw-maplibre-gl-adapter` | Separate adapter package | ✅ Correct — adapters are intentionally separate packages | ✅ Correct |

---

## 2. Terra Draw — Corrections & Confirmations

**Source:** https://github.com/JamesLMilner/terra-draw

### 2.1 Package structure — Confirmed

Both packages are separate npm installs, which is intentional:
```
terra-draw                        # core + modes + validators
terra-draw-maplibre-gl-adapter    # MapLibre-specific adapter
```

### 2.2 Class names — All confirmed correct

| Plan references | Actual export | Status |
|---|---|---|
| `TerraDrawMapLibreGLAdapter` | From `terra-draw-maplibre-gl-adapter` | ✅ Correct |
| `TerraDrawPolygonMode` | From `terra-draw` | ✅ Correct |
| `ValidateNotSelfIntersecting` | From `terra-draw` | ✅ Correct |
| `ValidateMinAreaSquareMeters` | From `terra-draw` | ✅ Available (plan doesn't use but good to know) |
| `ValidateMaxAreaSquareMeters` | From `terra-draw` | ✅ Available (plan doesn't use but good to know) |

### 2.3 Snapshot methods — Confirmed

| Method | Behavior | Status |
|---|---|---|
| `draw.getSnapshot()` | Returns ALL features as deep-copy array | ✅ Exists |
| `draw.getSnapshotFeature(id)` | Returns ONE feature by ID as deep-copy | ✅ Exists |

**Implementation note for Module 3.2:** Use `draw.getSnapshot().filter(f => f.properties.mode === 'polygon')` to get just the polygon feature after a `finish` event.

### 2.4 Events — Confirmed

| Event | Payload | When fired |
|---|---|---|
| `change` | `(ids[], type, context)` — type is `"create" \| "update" \| "delete" \| "styling"` | On any store mutation |
| `finish` | `{ action, mode }` — action is `"draw" \| "dragFeature" \| ...` | When drawing completes |
| `select` / `deselect` | feature id | Selection changes |

**Implementation note:** The `finish` event with `action === 'draw'` is the right trigger to read the completed polygon via `getSnapshot()`.

### 2.5 Validation placement — Confirmed

Validators like `ValidateNotSelfIntersecting` are passed to the mode config:
```ts
new TerraDrawPolygonMode({
  validation: (feature, { updateType }) => {
    if (updateType === 'finish' || updateType === 'commit') {
      return ValidateNotSelfIntersecting(feature);
    }
    return { valid: true };
  }
})
```
Triggers on `"finish"`, `"commit"`, `"provisional"` — aligns with plan.

**Summary: Terra Draw section of the plan is accurate. No corrections needed.**

---

## 3. EOSDA API — Detailed Corrections

**Source:** https://doc.eos.com

### 3.1 API Key — Clarification needed

The plan says "injects `EOSDA_API_KEY` via header where supported, query fallback otherwise."

From EOSDA docs:
- Quickstart shows header: `-H 'x-api-key: <your_api_key>'`
- All endpoint example URLs show query param: `?api_key=<your_api_key>`

**Decision needed:** Pick one approach for the client. Recommendation: use **header `x-api-key`** for all calls (more secure, key never appears in server logs as a URL component). The query param approach logs the key in access logs.

**Action:** Update Module 4.1 (`eosda-client.ts`) to inject `x-api-key` header, not query param.

---

### 3.2 Search endpoint — Confirmed correct + request body verified

```
POST https://api-connect.eos.com/api/lms/search/v2/<dataset_id>
```

For Sentinel-2: `dataset_id = sentinel2`  
Full URL: `POST https://api-connect.eos.com/api/lms/search/v2/sentinel2`

**Confirmed minimal request body:**
```json
{
  "search": {
    "date": { "from": "2023-06-01", "to": "2023-07-31" },
    "cloudCoverage": { "from": 0, "to": 90 },
    "shape": {
      "type": "Polygon",
      "coordinates": [[[lon, lat], ...]]
    },
    "shapeRelation": "CONTAINS"
  },
  "limit": 10,
  "page": 1,
  "sort": { "date": "desc" }
}
```

Field names confirmed: `search.shape`, `search.shapeRelation`, `search.cloudCoverage`, `search.date` are all correct.

**Response fields (exact names as returned by EOSDA) — CORRECTIONS from original findings:**
```json
{
  "results": [
    {
      "sceneID": "...",
      "view_id": "S2/36/U/XU/2016/5/2/0",
      "date": "2016-05-02",
      "cloudCoverage": 15.3,
      "tms": "https://...",
      "dataCoveragePercentage": 98.1,
      "sunElevation": 42.1
    }
  ],
  "meta": { "found": 42, "page": 1, "limit": 10 }
}
```

**Corrections vs earlier assumptions in this doc:**
- `sceneID` (camelCase), NOT `scene_id`
- `date` (not `timestamp`)
- `cloudCoverage` (not `cloud`)
- `dataCoveragePercentage` (not `data_coverage_percentage`)
- Response is `results[]` with a `meta` pagination wrapper

**Module 4.3 normalization map (confirmed):**
```typescript
sceneID                → sceneId
view_id                → viewId
date                   → sceneDate
cloudCoverage          → cloudPercent
dataCoveragePercentage → dataCoveragePercent
tms                    → tmsTemplate
```

**Plan is correct** on the Search endpoint URL and request field names.

---

### 3.3 Render endpoint — MAJOR CORRECTION REQUIRED

**What the plan says (Module 6.3):**
> Upstream URL is EOSDA `/api/render/<view_id>/<bands>/<z>/<x>/<y>` and `band=NDVI` passed from the proxy.

**Actual EOSDA Render API:**
```
GET https://api-connect.eos.com/api/render/<view_id>/<bands>/<z>/<x>/<y>?api_key=...
```

Example:
```
https://api-connect.eos.com/api/render/S2/36/U/XU/2016/5/2/0/B04,B03,B02/10/611/354?api_key=...
```

**Critical gap: EOSDA does NOT accept index names as bands.**

The `<bands>` parameter accepts:
- Single band: `B04`
- RGB composite: `B04,B03,B02`
- **Virtual band formula:** `(B08-B04)/(B08+B04)` ← this is NDVI

**The proxy must translate `band=NDVI` → the actual formula.** Required translations:

| Index | EOSDA band formula | Colormap for visualization |
|---|---|---|
| NDVI | `(B08-B04)/(B08+B04)` | `RdYlGn` (red-yellow-green) |
| EVI | `2.5*((B08-B04)/(B08+6*B04-7.5*B02+1))` | `RdYlGn` |
| NDWI | `(B03-B08)/(B03+B08)` | `Blues` |

**Additional required query params for correct visualization:**
```
MIN_MAX=0,1          # contrast stretch for normalized indices (-1 to 1 range, display 0-1)
COLORMAP=RdYlGn      # colormap name (matplotlib-compatible)
CALIBRATE=1          # convert to surface reflectance
```

**Without `COLORMAP`, the render endpoint returns a grayscale image — the NDVI heatmap will be grey, not the expected red-green color scale.**

**Corrected proxy route behavior (Module 6.3):**
```ts
const BAND_MAP = {
  NDVI: { formula: '(B08-B04)/(B08+B04)', colormap: 'RdYlGn', minMax: '-1,1' },
  EVI:  { formula: '2.5*((B08-B04)/(B08+6*B04-7.5*B02+1))', colormap: 'RdYlGn', minMax: '-1,1' },
  NDWI: { formula: '(B03-B08)/(B03+B08)', colormap: 'Blues', minMax: '-1,1' },
};
// Build upstream URL:
// https://api-connect.eos.com/api/render/{viewId}/{formula}/{z}/{x}/{y}?MIN_MAX=...&COLORMAP=...&CALIBRATE=1
```

**Note on `view_id` slashes:** The `view_id` contains literal slashes (e.g., `S2/43/P/GK/2026/3/23/0`). When building the upstream `fetch()` URL server-side, this is fine — the slashes become part of the path as EOSDA expects. When receiving `viewId` from the browser via query param (`?viewId=S2/43/P/GK/...`), the value must be URL-decoded before embedding in the upstream path.

---

### 3.4 `cropper_ref` for clipped tiles — UNCONFIRMED, NEEDS VERIFICATION

**What the plan says:**
> Use EOSDA `cropper_ref` for field-clipped render tiles. Upstream URL includes `cropper_ref` from the field as a query param.

**What the official Render API docs show:**
The documented render endpoint parameters are: `view_id`, `bands`, `z`, `x`, `y`, `api_key`, `MIN_MAX`, `CALIBRATE`, `COLORMAP`, `PANSHARPENING`, `CLUSTERING`, `CLUSTERS_NO`, `MIN_AREA`.

**There is no `cropper_ref` parameter in the documented Render API.**

**Options:**
1. `cropper_ref` may be an undocumented EOSDA feature available to API Connect accounts — confirm with EOSDA support.
2. The Field Management `id` (returned when you create a field via `/field-management`) may be used differently than described — possibly with a different endpoint for field-scoped tiles.
3. The app may need to clip NDVI tiles client-side (using the field polygon as a MapLibre clip mask) rather than relying on server-side clipping.

**Action:** Add to the EOSDA activation email: *"Does the Render API support a `cropper_ref` or field ID parameter for polygon-clipped tiles? If so, what is the parameter name and accepted value format?"*

**Until confirmed, the implementation should render unclipped NDVI tiles and apply the field polygon as a visual overlay (which we already do via `FieldLayer`). The user sees the NDVI heatmap under the white field outline — acceptable for v2.**

---

### 3.5 Field Management (cropper_ref creation) — Confirmed with corrections

**Endpoint:**
```
POST https://api-connect.eos.com/field-management
Header: x-api-key: <key>
Content-Type: application/json
```

**Request body:**
```json
{
  "type": "Feature",
  "properties": {
    "name": "field name",
    "group": "optional group"
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[lon, lat], ...]]
  }
}
```

**Response:**
```json
{ "id": 12345, "area": 2.3 }
```

**Critical correction:** The response `id` is a **number** (integer), not a string/UUID. The `fields` table's `eosda_cropper_ref` column should store this as `INTEGER` or `BIGINT`, not `TEXT`. Check `db/schema.ts` and correct if it's declared as text.

**Other field management endpoints:**
```
GET    /field-management/<field_id>     # get field details
PATCH  /field-management/<field_id>     # update field metadata
DELETE /field-management/<field_id>     # delete field
GET    /field-management/fields         # list all fields
```

---

### 3.6 Statistics endpoint — Confirmed with corrections

**Task creation:**
```
POST https://api-connect.eos.com/api/gdw/api
Header: x-api-key: <key>
```

**Request body:**
```json
{
  "type": "mt_stats",
  "params": {
    "bm_type": ["NDVI", "EVI", "NDWI"],
    "date_start": "2026-01-01",
    "date_end": "2026-05-09",
    "geometry": {
      "type": "Polygon",
      "coordinates": [[[lon, lat], ...]]
    },
    "reference": "unique-request-id",
    "sensors": ["sentinel2"],
    "limit": 100,
    "max_cloud_cover_in_aoi": 80,
    "cloud_masking_level": 1
  }
}
```

**Task creation response:**
```json
{
  "status": "created",
  "task_id": "abc123",
  "req_id": "...",
  "task_timeout": 120
}
```

**Polling:**
```
GET https://api-connect.eos.com/api/gdw/api/<task_id>
Header: x-api-key: <key>
```

**Poll response (when complete):**
```json
{
  "result": [
    {
      "scene_id": "...",
      "view_id": "S2/43/P/GK/2026/3/23/0",
      "date": "2026-03-23",
      "cloud": 12.5,
      "average": 0.62,
      "median": 0.64,
      "std": 0.08,
      "min": 0.1,
      "max": 0.89,
      "p10": 0.45,
      "p90": 0.75,
      "q1": 0.55,
      "q3": 0.70
    }
  ]
}
```

**Corrections needed in plan:**

1. **`bm_type` accepts index names directly** (e.g., `"NDVI"`, `"EVI"`, `"NDWI"`) — unlike the Render API which needs formulas. No translation needed here.
2. **Response field is `average`, not `mean`.** The plan's Sample pane says "mean NDVI" but the API returns `average`. Map `average` → display as "Mean" in the UI.
3. **`task_timeout` is returned in creation response.** Use this value (in seconds) as the max wait for polling — don't hardcode a timeout.
4. **Statistics uses `geometry` directly** — not the `cropper_ref`/field management ID. The stats are already polygon-clipped because the geometry is sent in the request body.
5. **`cloud_masking_level: 1`** should be included for better cloud filtering on Sentinel-2 L2A data.
6. **Sync polling strategy (confirmed for v2):** Poll `GET /api/gdw/api/<task_id>` on a loop with ~2s interval, up to `task_timeout` seconds. On timeout, return a 504 from the proxy route. On completion, upsert to `cached_ndvi_stats` and return.

**Supported vegetation indices for `bm_type`:**
`NDVI, NDSI, NDWI, RECI, NDMI, SAVI, ARVI, EVI, GCI, SIPI, NBR, MSI, ISTACK, FIDET, NDRE, CCCI, MSAVI`

---

### 3.7 Account limits — Know before activating

From the EOSDA quickstart:
- Trial: **1000 requests per API key** total
- Statistics API: **one field per request**, max **365 days** per request, max **3 indices** per request
- Imagery (render): ~3 requests per scene retrieval workflow
- Max field size: **200 km²** (aligns with app's existing guardrail — good)
- Rate limit: **10 requests/minute** per endpoint

**Implication for caching strategy:** 1000 trial requests will run out quickly if stats are not cached. The plan's cache-first approach in `POST /api/eosda/stats` is critical — never re-fetch if `cached_ndvi_stats` already has the result.

---

## 4. Cross-Document Issues

### 4.1 Broken `§N` section references in implementation.md

`implementation.md` cites `plan.md` sections by number, but `plan.md` uses named sections. Every cross-reference is broken:

| implementation.md cites | Should link to |
|---|---|
| `plan.md §7` (DB schema) | `architecture.md` — schema is there, not plan.md |
| `plan.md §3` (10 crops) | `plan.md §1 — Create /fields/new` |
| `plan.md §4` (analysis anatomy) | `plan.md §2 — Field Analysis Screen Anatomy` |
| `plan.md §10` (TanStack cache defaults) | Not defined anywhere — add a stale-time table to plan.md |
| `plan.md §13` (EOSDA key injection) | Not defined anywhere — add to Phase 4 section |
| `plan.md §16` (demo checklist) | `plan.md §7 — Verification & Testing` |

### 4.2 TanStack stale-time defaults are cited but never defined

`implementation.md` Modules 1.7, 6.2, 7.2 all reference stale times but the values are inconsistent and their source is never specified in plan.md:
- Module 1.7: "5 min stale on the list"
- Modules 6.2, 7.2: `staleTime: 60 * 60 * 1000` (1 hour)

**Add to plan.md:**
| Query | `staleTime` | Rationale |
|---|---|---|
| `['fields']` (list) | 5 min | Low-frequency changes, dashboard always fresh |
| `['fields', id]` (single) | 5 min | Same |
| `['eosda', 'scenes', fieldId]` | 1 hour | Scenes don't change intraday |
| `['eosda', 'stats', fieldId]` | 1 hour | Stats are historical, expensive to recompute |

### 4.3 DB schema lives in architecture.md, not plan.md

Module 1.2 in implementation.md says "defined in plan.md §7" but the schema is in `architecture.md`. The implementation.md cross-reference should point to `architecture.md` directly. Risk: if `architecture.md` diverges from the Drizzle schema, both docs will be wrong.

### 4.4 Module 2.5 status not updated

Modules 2.1–2.4 are all marked ✅. Module 2.5 (`CreateLayout`) has no status marker. Git status shows new untracked files in `apps/web/src/components/map/` and `apps/web/src/lib/arcgis.ts` — Phase 2 work is in progress. Update Module 2.5 status once complete.

### 4.5 ArcGIS style name drift

plan.md Module 2.4 says start with `'arcgis/imagery'` and switch if no symbol layers. The actual `lib/arcgis.ts` already uses `'arcgis/imagery/standard'` (the hybrid with labels). Plan should be updated to specify `/standard` directly to avoid confusion.

---

## 5. Architecture Gaps

### 5.1 NDVI band formula translation — NEW GAP (not in original plan)

The render proxy route (`GET /api/eosda/render/:z/:x/:y?band=NDVI`) must translate the index name to a formula before calling EOSDA. This translation layer and the required `COLORMAP` parameter are missing from the plan entirely.

**Add to Module 6.3:**
```ts
const INDEX_TO_BAND: Record<string, { formula: string; colormap: string }> = {
  NDVI: { formula: '(B08-B04)/(B08+B04)', colormap: 'RdYlGn' },
  EVI:  { formula: '2.5*((B08-B04)/(B08+6*B04-7.5*B02+1))', colormap: 'RdYlGn' },
  NDWI: { formula: '(B03-B08)/(B03+B08)', colormap: 'Blues' },
};
```

### 5.2 `cropper_ref` in render — Unconfirmed feature

The plan relies on passing `cropper_ref` as a query param to EOSDA's render endpoint for polygon-clipped tiles. This parameter is not in the official docs. Two possible outcomes:
- **If confirmed:** Add `cropper_ref=<field.eosda_cropper_ref>` to the upstream render URL.
- **If not available:** The field outline from `FieldLayer` provides visual context but NDVI renders the full scene. This is acceptable for v2. The `eosda_cropper_ref` column and `warmField` cropper creation step may be unnecessary overhead for v2 if clipping is not available.

### 5.3 Stats polling — timeout spec

Sync polling in a Fastify route handler. The `task_timeout` value from the EOSDA task creation response should set the cap. Recommended implementation:
```
- Poll interval: 2s
- Max wait: min(task_timeout, 60) seconds
- On timeout: return 504 to client with { error: 'STATS_TIMEOUT', taskId }
- On success: upsert to cached_ndvi_stats, return results
- On EOSDA error: return 502 with structured error body
```

Frontend (Module 7.2) should handle 504 by showing a "Stats computing, try again in a moment" toast and retrying after 10s (the `useEosdaStats` query can set `retry: 1, retryDelay: 10000`).

### 5.4 Clerk token refresh for MapLibre `transformRequest`

The plan defers this across Modules 2.2 and 6.4 with no concrete spec. Recommended implementation:

```ts
// In useMapInstance — create a token ref
const tokenRef = useRef<string | null>(null);

// Token refresh effect (set up in the same component that mounts MapView)
useEffect(() => {
  const refresh = async () => { tokenRef.current = await getToken(); };
  refresh();
  const interval = setInterval(refresh, 55 * 1000); // refresh every 55s (Clerk tokens expire at 60s)
  return () => clearInterval(interval);
}, [getToken]);

// In transformRequest:
transformRequest: (url) => {
  if (url.startsWith(`${env.VITE_API_BASE_URL}/api/eosda/render/`)) {
    return { url, headers: { Authorization: `Bearer ${tokenRef.current ?? ''}` } };
  }
  return { url };
}
```

The `tokenRef` should live in the component that owns `useMapInstance`, not inside the hook itself.

### 5.5 Layer ordering — split across Module 3.3 and 6.4

The canonical layer stack (`satellite → NDVI → labels → field fill → field outline`) is implied by both modules but never stated in one place. Consolidate into a single comment block in `lib/map-style.ts`:

```
Stack (bottom to top):
1. ArcGIS satellite (via BasemapStyle)
2. NDVI raster (below first symbol layer, using findFirstSymbolLayerId)
3. ArcGIS symbol/label layers
4. field-fill  (moveLayer to top, no beforeId)
5. field-outline (moveLayer to top, no beforeId)
```

`FieldLayer` uses `moveLayer` (no `beforeId`) to stay above everything. `NdviLayer` uses `addLayer(layer, findFirstSymbolLayerId(map))` to insert below labels.

### 5.6 `warmField` double error handler

Module 4.5 says `warmField` swallows all errors internally. Module 4.6 adds an outer `.catch()`. The outer catch never fires because `warmField` never rejects. Remove one:

**Recommended:** Keep the outer `.catch()` in Module 4.6 as the single handler (remove internal swallowing in `warmField`, let it propagate). The outer call site is the right place to log `{ fieldId }` context since `warmField` itself doesn't know where it was called from.

---

## 6. Action Items

### Immediate (before continuing Phase 2/3)

| # | Action | File to update | Priority |
|---|---|---|---|
| A1 | Update ArcGIS style name to `'arcgis/imagery/standard'` | `plan.md` Module 2.4 | Medium |
| A2 | Add NDVI/EVI/NDWI band formula translation table to Module 6.3 | `plan.md`, `implementation.md` | **High** |
| A3 | Add `COLORMAP` + `MIN_MAX` + `CALIBRATE` render params to Module 6.3 | `plan.md`, `implementation.md` | **High** |
| A4 | Clarify `eosda_cropper_ref` schema column type: INTEGER (not TEXT) | `implementation.md` Module 4.2 | **High** |
| A5 | Add `cropper_ref` in render — "confirm with EOSDA or skip for v2" decision note | `plan.md`, `implementation.md` | **High** |
| A6 | Fix all `§N` cross-references in implementation.md to named anchors | `implementation.md` | Medium |
| A7 | Add stale-time defaults table to plan.md | `plan.md` | Medium |
| A8 | Specify `x-api-key` header (not query param) as the API key injection method | `plan.md` Module 4.1, `implementation.md` Module 4.1 | Medium |

### Before Phase 4 (EOSDA)

| # | Action | Owner |
|---|---|---|
| B1 | Email EOSDA to confirm `cropper_ref` / field ID render clipping feature exists | User (in activation email) |
| B2 | Confirm EOSDA response field is `average` (not `mean`) — update Sample pane label | Dev (update Module 7.3) |
| B3 | Add `cloud_masking_level: 1` to stats request body in Module 7.1 | Dev |
| B4 | Add `task_timeout`-based polling cap to Module 7.1 | Dev |
| B5 | Update `eosda_cropper_ref` column in `db/schema.ts` to `integer` type if currently `text` | Dev |

### Documentation cleanup (can batch)

| # | Action |
|---|---|
| C1 | Add canonical layer-stack comment to `lib/map-style.ts` (or plan.md) |
| C2 | Fix `warmField` double-catch — remove internal swallow, keep outer `.catch` in Module 4.6 |
| C3 | Add Clerk token refresh spec (55s interval, `tokenRef`) to Module 2.2/6.4 |
| C4 | Mark Module 2.5 complete or in-progress once `CreateLayout` is done |
| C5 | Fix DB schema cross-reference in Module 1.2: `architecture.md`, not `plan.md §7` |

---

## 7. EOSDA Activation Email Template

Include these questions when emailing `api.support@eosda.com`:

```
Subject: Trial activation + technical questions — API Connect account [your account email]

Hi EOSDA support,

Please activate the trial for our account. We're building a crop monitoring
application and have a few technical questions:

1. Cropper API: Your Render API docs mention a `cropper_ref` parameter
   described as "optional AOI reference from Cropper API." We need to create
   a cropper reference from a field polygon to clip NDVI tiles. What is the
   endpoint URL and request format for creating a `cropper_ref`? (We did
   not find a documented Cropper API endpoint in the public docs.)

2. Field Management ID: The /field-management POST returns a numeric `id`.
   Is this the same as the `cropper_ref` used in the Render API, or are
   these two separate systems?

3. Render formula encoding: For virtual band formulas like
   `(B08-B04)/(B08+B04)` in the render path, should the formula be
   URL-encoded or used literally? Our docs research suggests literal, but
   please confirm.

4. Rate limits: What are the rate limits for the Render and Search APIs
   specifically for trial accounts?

5. Sentinel-2 dataset ID: Is `sentinel2` the correct dataset_id for the
   Search API, or is it `sentinel-2` or another variant?

Thank you.
```

---

## 8. Core Flow: Draw Plot → NDVI Display

> This section maps the user's primary requirement to concrete implementation steps and flags every confirmed gap in the current plan.
>
> **Requirement:** User draws a polygon on the map → app fetches Sentinel-2 data → NDVI heatmap appears clipped to the plot → user can switch index (EVI/NDWI).

---

### 8.1 End-to-End Flow (6 Steps)

```
[1] User draws polygon on /fields/new (Terra Draw)
         ↓
[2] POST /api/fields → DB insert → void warmField(fieldId)
         ↓
[3] warmField (background, async):
    a. POST /api/render/cropper/  ← EOSDA — create clip reference  [UNCONFIRMED]
       OR POST /field-management  ← EOSDA Field Management          [CONFIRMED, different purpose]
    b. POST /api/lms/search/v2/sentinel2 — fetch latest scene metadata [CONFIRMED endpoint, request body needs verification]
    c. upsert to cached_scenes
         ↓
[4] User opens /fields/:id
    POST /api/eosda/scenes → returns SceneDto[] from cached_scenes
    → DateTimeline renders scene dates
    → useUiStore.selectedViewId = latest low-cloud scene
         ↓
[5] GET /api/eosda/render/{z}/{x}/{y}?fieldId=...&viewId=...&band=NDVI
    Proxy server:
    a. Decode viewId from query param (contains slashes)       [GAP — not in current plan]
    b. Translate band=NDVI → formula (B08-B04)/(B08+B04)       [GAP 1 — CRITICAL, missing]
    c. Add COLORMAP=RdYlGn, MIN_MAX=-1,1, CALIBRATE=1          [GAP 1 — CRITICAL, missing]
    d. Optionally add cropper_ref for clipped tiles             [GAP 2 — UNCONFIRMED]
    e. Upstream: GET /api/render/{viewId}/{formula}/{z}/{x}/{y}?...
    f. Stream PNG back to MapLibre
         ↓
[6] NdviLayer: MapLibre raster source → NDVI heatmap on map
    User clicks IndexSwitcher → selectedIndex changes → NdviLayer recreates source
    User clicks DateTimeline chip → selectedViewId changes → NdviLayer recreates source
```

---

### 8.2 Gap 1: Band Formula Translation — Corrected Module 6.3 Spec

**Why it fails without this fix:** EOSDA's render API does not accept `NDVI` as a bands parameter. It needs the actual spectral formula or band codes. Sending `band=NDVI` upstream will return a 400 error or an unrecognized response.

**Why the heatmap will be grey without COLORMAP:** Even with the correct formula, EOSDA returns a grayscale PNG by default. `COLORMAP=RdYlGn` is required for the red-yellow-green NDVI visualization.

**Corrected `apps/api/src/routes/eosda.render.ts` spec:**

```typescript
// Add this constant at module top — do not inline in the handler
const INDEX_TO_BAND: Record<string, { formula: string; colormap: string; minMax: string }> = {
  NDVI: { formula: '(B08-B04)/(B08+B04)', colormap: 'RdYlGn', minMax: '-1,1' },
  EVI:  { formula: '2.5*((B08-B04)/(B08+6*B04-7.5*B02+1))', colormap: 'RdYlGn', minMax: '-1,1' },
  NDWI: { formula: '(B03-B08)/(B03+B08)', colormap: 'Blues', minMax: '-1,1' },
};

// In the route handler:
const { fieldId, viewId: rawViewId, band } = query;  // band validated by zod to ∈ {NDVI, EVI, NDWI}
const bandConfig = INDEX_TO_BAND[band];

// REQUIRED: URL-decode viewId. The browser sends it as a query param because it contains
// slashes (e.g. S2/43/P/GK/2026/3/23/0). The proxy must decode it before embedding in
// the upstream path, otherwise the slashes are double-encoded.
const viewId = decodeURIComponent(rawViewId);

// Build query string (api_key must NEVER appear in logs — log only path+status)
const params = new URLSearchParams({
  MIN_MAX: bandConfig.minMax,
  COLORMAP: bandConfig.colormap,
  CALIBRATE: '1',
  api_key: env.EOSDA_API_KEY,
});

// If cropper_ref is confirmed and field has one, add it
if (field.eosda_cropper_ref != null) {
  params.set('cropper_ref', String(field.eosda_cropper_ref));
}

// NOTE: formula contains characters like ( ) + - /
// EOSDA examples show the formula literally in the path without URL-encoding.
// Test with a known formula first (see §8.2 open question below).
const upstreamUrl =
  `https://api-connect.eos.com/api/render/${viewId}/${bandConfig.formula}/${z}/${x}/${y}?${params}`;

const upstream = await fetch(upstreamUrl);
if (!upstream.ok) {
  // Log path only, never full URL (contains api_key)
  const path = `/api/render/${viewId}/${band}/${z}/${x}/${y}`;
  req.log.error({ status: upstream.status, path }, 'EOSDA render failed');
  return reply.status(upstream.status).send();
}

reply
  .header('Content-Type', 'image/png')
  .header('Cache-Control', 'private, max-age=86400');
return reply.send(Buffer.from(await upstream.arrayBuffer()));
```

**Formula encoding — CONFIRMED by official docs:** The formula goes **literally in the path without URL-encoding**. EOSDA's render router knows the `view_id` has a fixed depth (e.g. `S2/{grid_zone}/{grid_square}/{grid_id}/{year}/{month}/{day}/{seq}` = 8 segments) so it counts from the right to find `{z}/{x}/{y}` and captures everything in between as the bands/formula. The `/` characters inside `(B08-B04)/(B08+B04)` become part of the path and EOSDA parses them correctly. Node.js `fetch()` sends the string as-is, so this works server-side. Do NOT URL-encode the formula.

---

### 8.3 Gap 2: Field Clipping (cropper_ref) — Status Updated

**What the plan says:** Module 4.2 calls `POST /api/render/cropper/` to get a `cropper_ref` and stores it in `fields.eosda_cropper_ref`. This ref is passed to the Render API to clip tiles to the field polygon.

**What is now confirmed:**
- The `cropper_ref` query parameter IS confirmed in the Render API docs: "optional AOI reference from Cropper API; any image data that does not fall into AOI is made transparent." ✅
- The `/api/render/cropper/` **creation endpoint** is NOT documented on the Render API page. It exists as a separate "Cropper API" but the URL and request format are unknown from the pages fetched. 🔴

**Impact without `cropper_ref`:**
- NDVI tiles cover the entire Sentinel-2 scene (~10,000 km²), not just the user's field
- The user sees a wide-area NDVI heatmap with the field polygon overlaid as a white outline
- This is visually adequate for v2 but not the polished "field-specific" view

**Two implementation paths:**

| Path | Condition | What to implement |
|---|---|---|
| **Path A: Cropper API found** | Find endpoint from EOSDA docs or support email | Module 4.2 as written; add `cropper_ref` to render upstream URL |
| **Path B: v2 fallback** | Cropper endpoint not found before Phase 4 | Skip Module 4.2; render full-scene tiles; FieldLayer provides field outline context |

**Recommendation for v2:** Implement Path B first. The render proxy already conditionally adds `cropper_ref` (see §8.2 code spec) — once the Cropper API is found and the ref is populated, it will activate automatically. This lets you ship NDVI now and clip later.

**Action:** Add to EOSDA activation email (§7): "What is the endpoint and request format for creating a Cropper AOI reference (`cropper_ref`) to use with the Render API?"

**Schema impact for Path B:**
- Column `fields.eosda_cropper_ref` stays (NULL until Path A)
- Module 4.2 (`eosda-cropper.ts`) is a stub returning `null` for now
- `warmField` skips step (a) from §8.1 above

---

### 8.4 EOSDA Search Request Body — Now Confirmed

**Module 4.3 `eosda-search.ts` should use this exact request body:**

```typescript
const body = {
  search: {
    date: { from: fromDate, to: toDate },       // ISO date strings "YYYY-MM-DD"
    cloudCoverage: { from: 0, to: 80 },
    shape: fieldGeometry,                        // GeoJSON Polygon object
    shapeRelation: 'CONTAINS',
  },
  limit: options.limit ?? 10,
  page: 1,
  sort: { date: 'desc' },
};
```

**Module 4.3 response normalization (corrected field names):**

```typescript
// Map EOSDA response → SceneDto
function normalizeScene(raw: EosdaSearchResult): SceneDto {
  return {
    sceneId:             raw.sceneID,               // camelCase, not snake_case
    viewId:              raw.view_id,               // snake_case (mixed in EOSDA response)
    sceneDate:           raw.date,                  // "YYYY-MM-DD", NOT "timestamp"
    cloudPercent:        raw.cloudCoverage,         // NOT "cloud"
    dataCoveragePercent: raw.dataCoveragePercentage, // NOT "data_coverage_percentage"
    tmsTemplate:         raw.tms,
  };
}
```

**Note:** `view_id` is the only snake_case field in the response; all others are camelCase. The response is wrapped in `{ results: [...], meta: { found, page, limit } }`.

**This is now confirmed — no further verification needed for Module 4.3 field names.**

---

### 8.5 NdviLayer Tile URL Construction

**How MapLibre's raster source works:**

MapLibre substitutes `{z}`, `{x}`, `{y}` in the tile URL template automatically. The template is set once when the source is created. When `viewId` or `index` changes, the entire source (and layer) must be removed and re-added.

**Tile URL template (set in `NdviLayer.tsx`):**
```typescript
// viewId must be URL-encoded for the query param
const encodedViewId = encodeURIComponent(viewId); // encodes the / chars

const tileUrl =
  `${env.VITE_API_BASE_URL}/api/eosda/render/{z}/{x}/{y}` +
  `?fieldId=${fieldId}&viewId=${encodedViewId}&band=${selectedIndex}`;

map.addSource('ndvi', {
  type: 'raster',
  tiles: [tileUrl],
  tileSize: 256,
  attribution: '© EOSDA',
});
```

**Why `encodeURIComponent` on the viewId here:** The browser (or MapLibre) must not further encode the `{z}/{x}/{y}` tokens. Only `viewId` (which contains literal `/` chars) needs encoding in the query param. When the proxy receives `viewId`, it calls `decodeURIComponent` before building the upstream URL.

---

### 8.6 Critical Path to First Working NDVI

Implement in this exact order to get NDVI working for the first time:

| Priority | Module | Change | Status |
|---|---|---|---|
| 1 | `eosda-client.ts` (4.1) | Use `x-api-key` header, not query param; never log full URL | To do |
| 2 | `eosda-search.ts` (4.3) | Verify request body field names against official docs; normalize `timestamp` → `sceneDate` | Needs live test |
| 3 | `field-warmup.ts` (4.5) | Skip cropper creation (Path B); just search + upsert scenes | To do |
| 4 | `eosda.render.ts` (6.3) | Add `INDEX_TO_BAND` map; decode `viewId`; add COLORMAP/MIN_MAX/CALIBRATE | **Blocker — do first** |
| 5 | `NdviLayer.tsx` (6.4) | `encodeURIComponent(viewId)` in tile URL template | To do |
| 6 | Live test | Create a Karnataka field, check `cached_scenes` populated, open `/fields/:id`, confirm NDVI renders in color | Verify |

**If Step 4 is missing, the app will silently return wrong EOSDA data or a grey image — the most common failure mode.**

---

### 8.7 Open Questions

Resolved questions are removed. Remaining questions require EOSDA support or live testing.

| # | Question | Blocks | Status |
|---|---|---|---|
| Q1 | ~~Formula URL encoding~~ | ~~Module 6.3~~ | ✅ **Resolved** — use literal formula, no encoding |
| Q2 | ~~Search request body field names~~ | ~~Module 4.3~~ | ✅ **Resolved** — `search.shape`, `search.date`, `search.cloudCoverage`, `search.shapeRelation` confirmed |
| Q3 | What is the Cropper API endpoint URL and request body for creating a `cropper_ref`? | Module 4.2 (Path A field clipping) | ❓ Needs EOSDA support email |
| Q4 | What is the Sentinel-2 `dataset_id` for the search endpoint? (`sentinel2` or `sentinel-2`?) | Module 4.3 | ❓ Needs live test |
| Q5 | What does EOSDA return when no scenes are found for the polygon + date range? Empty `results[]` or an error status? | Module 4.5 fallback logic | ❓ Needs live test |

Add Q3 to the EOSDA activation email (§7).

---

*This document should be updated as questions are answered and action items are completed. Delete resolved items from the action items table.*
