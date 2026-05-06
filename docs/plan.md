# viz-crop Prototype — Implementation Plan

> **Goal:** Prove that all four map layers — Esri satellite, Esri labels + roads, Copernicus NDVI heatmap, and a user-drawn field polygon — render together correctly in a React app using MapLibre GL JS.
>
> **This is a pure integration spike.** No backend. No database. No auth. Frontend only.

---

## Quick Reference

| Item | Value |
|---|---|
| Estimated effort | ~4 hours focused |
| Total cost | $0 |
| External accounts needed | 2 (both free) |
| Framework | Vite + React + TypeScript |
| Map renderer | MapLibre GL JS (direct, no wrapper) |
| Drawing | terra-draw |

---

## The Four Layers

These are the four layers that compose into the final map view, stacked bottom to top:

| # | Layer | Provider | What it provides | Cost |
|---|---|---|---|---|
| 1 | Satellite background | Esri World Imagery | High-res satellite photo of India (30–50cm Maxar Vivid) | Free (2M tiles/month) |
| 2 | Roads + labels | Esri Transportation + Boundaries | Road lines, village names, district names, state labels | Free (same quota) |
| 3 | NDVI / dpRVI heatmap | Copernicus Sentinel Hub | Vegetation health overlay from Sentinel-2 (NDVI) or Sentinel-1 SAR (dpRVI) | Free (10,000 PU/month) |
| 4 | Field polygon | Your app (GeoJSON) | The boundary the agronomist draws around their field | Your code |

---

## Tech Stack

```
Vite + React + TypeScript     → App scaffold (fast dev, modern)
MapLibre GL JS                → Map renderer (open-source, no Mapbox dependency)
terra-draw                    → Polygon drawing tools
terra-draw-maplibre-gl-adapter → MapLibre adapter for terra-draw
@turf/turf                    → Geometry helpers (bbox, area, etc.)
date-fns                      → Date formatting for WMS TIME param
```

**Why not react-map-gl?**
For this prototype, direct MapLibre via `useRef` + `useEffect` is simpler. You're adding raster sources programmatically, and terra-draw integrates more naturally with a direct map instance. No extra abstraction to debug.

---

## Prerequisites — Complete Before Writing Code

### Account 1: ArcGIS Location Platform (Esri tiles) — ~10 minutes

1. Sign up free at [developers.arcgis.com](https://developers.arcgis.com) — no credit card required
2. From the dashboard, create a new **API key**
3. Scope the key to the **Basemaps** service
4. Save the key — it covers all three Esri layers (satellite, transportation, labels) under a single key
5. Free tier: **2,000,000 tiles/month** — shared across all three layers

**Tile URL pattern:**
```
https://ibasemaps-api.arcgis.com/arcgis/rest/services/{LAYER}/MapServer/tile/{z}/{y}/{x}?token=YOUR_KEY
```

> ⚠️ **Important:** Use `ibasemaps-api` (raster tiles), not `basemaps-api` (vector tiles). Wrong URL = silent 401 errors.

---

### Account 2: Copernicus Data Space Ecosystem (NDVI) — ~20 minutes

1. Sign up free at [dataspace.copernicus.eu](https://dataspace.copernicus.eu) — no credit card required
2. From the portal, open the **Sentinel Hub Dashboard**
3. Create a new **Configuration** — this gives you an **Instance ID**
4. Inside the configuration, add a **Layer** using **Sentinel-2 L2A** as the data source
5. Set the layer's name to something obvious like `NDVI`
6. Paste the evalscript below into the layer's evalscript field
7. Save — your WMS endpoint will be:

```
https://sh.dataspace.copernicus.eu/ogc/wms/{YOUR_INSTANCE_ID}
```

**Free tier: 10,000 Processing Units/month** — covers thousands of field scans.

#### NDVI Evalscript (paste into Sentinel Hub layer config)

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

---

## Project Setup

### Install

```bash
npm create vite@latest viz-crop-prototype -- --template react-ts
cd viz-crop-prototype

npm install \
  maplibre-gl \
  terra-draw \
  terra-draw-maplibre-gl-adapter \
  @turf/turf \
  date-fns
```

### Environment Variables

Create `.env` in the project root:

```env
VITE_ESRI_API_KEY=your_arcgis_api_key_here
VITE_SH_INSTANCE_ID=your_sentinel_hub_instance_id_here
```

Add `.env` to `.gitignore` immediately.

```bash
echo ".env" >> .gitignore
```

### CSS Import

In `src/main.tsx`, add:

```typescript
import 'maplibre-gl/dist/maplibre-gl.css';
```

---

## Project Structure

```
viz-crop-prototype/
├── .env                          # API keys — never commit this
├── .env.example                  # Commit this with placeholder values
├── .gitignore
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
└── src/
    ├── main.tsx                  # Entry point — imports maplibre CSS
    ├── App.tsx                   # Layout: sidebar (left) + map (right)
    ├── components/
    │   ├── MapView.tsx           # All MapLibre init + layer management
    │   └── Sidebar.tsx           # Draw button + date picker + layer info
    ├── lib/
    │   ├── esri.ts               # Esri tile URL builders
    │   └── sentinelHub.ts        # Sentinel Hub WMS URL builder
    └── types.ts                  # FieldPolygon, NdviRequest types
```

---

## Esri Tile URL Reference (`src/lib/esri.ts`)

```typescript
const KEY = import.meta.env.VITE_ESRI_API_KEY;
const BASE = 'https://ibasemaps-api.arcgis.com/arcgis/rest/services';

export const ESRI_URLS = {
  satellite:      `${BASE}/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${KEY}`,
  transportation: `${BASE}/World_Transportation/MapServer/tile/{z}/{y}/{x}?token=${KEY}`,
  labels:         `${BASE}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}?token=${KEY}`,
};
```

---

## Sentinel Hub WMS URL Builder (`src/lib/sentinelHub.ts`)

```typescript
const INSTANCE_ID = import.meta.env.VITE_SH_INSTANCE_ID;
const BASE = `https://sh.dataspace.copernicus.eu/ogc/wms/${INSTANCE_ID}`;

export function buildNdviUrl(params: {
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  date: string;                            // 'YYYY-MM-DD'
  width?: number;
  height?: number;
}): string {
  const { bbox, date, width = 512, height = 512 } = params;

  // 10-day window ending on the selected date
  const endDate = date;
  const startDate = new Date(new Date(date).getTime() - 10 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  const p = new URLSearchParams({
    SERVICE:     'WMS',
    REQUEST:     'GetMap',
    LAYERS:      'NDVI',              // must match layer name in Sentinel Hub dashboard
    BBOX:        bbox.join(','),
    WIDTH:       String(width),
    HEIGHT:      String(height),
    FORMAT:      'image/png',
    CRS:         'EPSG:4326',
    TIME:        `${startDate}/${endDate}`,
    MAXCC:       '20',                // max 20% cloud coverage
  });

  return `${BASE}?${p.toString()}`;
}
```

---

## Implementation Phases

### Phase 0 — Project Scaffold · ~30 min

**What you build:** Bare React app with the layout structure in place.

**Steps:**
1. Run the Vite scaffold command above
2. Install all dependencies
3. Create `.env` with both keys
4. Replace `App.tsx` with a two-column layout: a 280px sidebar on the left, a full-height map container on the right
5. Create empty `MapView.tsx` and `Sidebar.tsx` components
6. Import `maplibre-gl/dist/maplibre-gl.css` in `main.tsx`

**`src/App.tsx` layout:**
```tsx
import MapView from './components/MapView';
import Sidebar from './components/Sidebar';
import { useState } from 'react';
import type { Feature, Polygon } from 'geojson';

export default function App() {
  const [field, setField] = useState<Feature<Polygon> | null>(null);
  const [date, setDate] = useState('2024-12-01');

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      <Sidebar
        field={field}
        date={date}
        onDateChange={setDate}
      />
      <div style={{ flex: 1 }}>
        <MapView
          field={field}
          date={date}
          onFieldDrawn={setField}
        />
      </div>
    </div>
  );
}
```

**✅ Done when:** `npm run dev` shows a blank page with the two-column layout, no console errors.

---

### Phase 1 — Esri Satellite Layer · ~30 min

**What you build:** High-res India satellite imagery loads as the map background.

**Steps:**
1. Create `MapView.tsx` with a `useRef` for the container div and a `useEffect` to initialize MapLibre
2. Initialize the map with an empty style (`{ version: 8, sources: {}, layers: [] }`)
3. Set the starting centre to Ludhiana, Punjab: `[75.85, 30.90]` at zoom `14` — clear cropland, easy to verify
4. Inside `map.on('load', ...)`, add the Esri satellite as a raster source and render it as a raster layer

**`MapView.tsx` core structure:**
```tsx
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { ESRI_URLS } from '../lib/esri';
import type { Feature, Polygon } from 'geojson';

interface Props {
  field: Feature<Polygon> | null;
  date: string;
  onFieldDrawn: (f: Feature<Polygon>) => void;
}

export default function MapView({ field, date, onFieldDrawn }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: { version: 8, sources: {}, layers: [] },
      center: [75.85, 30.90],  // Ludhiana, Punjab
      zoom: 14,
    });

    map.on('load', () => {
      // Phase 1: Satellite
      map.addSource('esri-sat', {
        type: 'raster',
        tiles: [ESRI_URLS.satellite],
        tileSize: 256,
        attribution: 'Esri, Maxar, GeoEye, USDA FSA',
      });
      map.addLayer({ id: 'esri-sat', type: 'raster', source: 'esri-sat' });
    });

    mapRef.current = map;
    return () => map.remove();
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
```

**✅ Done when:** You see sharp satellite imagery of Punjab farmland — distinct field boundaries, irrigation channels, and tree lines visible.

---

### Phase 2 — Esri Labels + Roads Overlay · ~15 min

**What you build:** Village names, road lines, and district labels appear on top of the satellite photo.

**Steps:**
1. Inside the same `map.on('load', ...)` block, add two more raster sources after the satellite layer
2. Layer order matters: satellite first, then transportation, then labels (last = on top)

**Add to the `map.on('load', ...)` block after Phase 1:**
```typescript
// Phase 2: Transportation (roads)
map.addSource('esri-transport', {
  type: 'raster',
  tiles: [ESRI_URLS.transportation],
  tileSize: 256,
});
map.addLayer({ id: 'esri-transport', type: 'raster', source: 'esri-transport' });

// Phase 2: Labels (place names, boundaries)
map.addSource('esri-labels', {
  type: 'raster',
  tiles: [ESRI_URLS.labels],
  tileSize: 256,
});
map.addLayer({ id: 'esri-labels', type: 'raster', source: 'esri-labels' });
```

**✅ Done when:** You see road lines and city/village/district names clearly rendered on top of the satellite image.

---

### Phase 3 — Field Polygon Drawing · ~45 min

**What you build:** Agronomist can draw a field boundary polygon on the map. Polygon persists in state and renders with a visible outline.

**Install terra-draw:**
```bash
npm install terra-draw terra-draw-maplibre-gl-adapter
```

**Steps:**
1. Initialize `TerraDraw` with the MapLibre adapter inside the `useEffect`
2. Add a "Draw field" button to `Sidebar.tsx` — clicking calls `draw.start()` and sets mode to `polygon`
3. Subscribe to `draw.on('finish', ...)` to capture the polygon GeoJSON
4. Pass it up to App state via `onFieldDrawn` callback
5. Add a GeoJSON source for the drawn polygon with a fill layer and an outline layer
6. When `field` prop updates, call `(map.getSource('field') as GeoJSONSource).setData(field)`

**terra-draw initialization (inside `map.on('load', ...)`):**
```typescript
import { TerraDraw, TerraDrawPolygonMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';

const draw = new TerraDraw({
  adapter: new TerraDrawMapLibreGLAdapter({ map }),
  modes: [new TerraDrawPolygonMode()],
});

draw.start();

draw.on('finish', (id) => {
  const snapshot = draw.getSnapshot();
  const polygon = snapshot.find(f => f.id === id);
  if (polygon) {
    onFieldDrawn(polygon as Feature<Polygon>);
    draw.stop();
  }
});
```

**Field polygon layers (add after NDVI source in Phase 4, but set up source now):**
```typescript
map.addSource('field', {
  type: 'geojson',
  data: { type: 'FeatureCollection', features: [] },
});

// Fill (semi-transparent)
map.addLayer({
  id: 'field-fill',
  type: 'fill',
  source: 'field',
  paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.15 },
});

// Outline (solid white)
map.addLayer({
  id: 'field-outline',
  type: 'line',
  source: 'field',
  paint: { 'line-color': '#ffffff', 'line-width': 2 },
});
```

**React effect to update field when prop changes:**
```typescript
useEffect(() => {
  const map = mapRef.current;
  if (!map || !map.isStyleLoaded()) return;
  const source = map.getSource('field') as maplibregl.GeoJSONSource;
  if (!source) return;
  source.setData(field ?? { type: 'FeatureCollection', features: [] });
}, [field]);
```

**✅ Done when:** You can click "Draw field", click points around a real field on the map, double-click to finish — the polygon stays visible with a white outline.

---

### Phase 4 — Copernicus NDVI Overlay · ~60 min

**What you build:** A coloured vegetation heatmap appears over the drawn field.

**Steps:**
1. When a polygon is drawn, compute its bounding box using Turf
2. Build the Sentinel Hub WMS URL using `buildNdviUrl()`
3. Fetch the image as a blob and create an object URL
4. Add it as a MapLibre `image` source with the polygon bounds as geographic coordinates
5. Add a raster layer for the NDVI image — placed above labels but below the polygon outline

**NDVI fetch and render (add to `useEffect` watching `field` and `date`):**
```typescript
import * as turf from '@turf/turf';
import { buildNdviUrl } from '../lib/sentinelHub';

useEffect(() => {
  const map = mapRef.current;
  if (!map || !field || !map.isStyleLoaded()) return;

  const bbox = turf.bbox(field) as [number, number, number, number];
  // bbox = [minLon, minLat, maxLon, maxLat]

  const url = buildNdviUrl({ bbox, date });

  // Remove old NDVI layer/source if it exists
  if (map.getLayer('ndvi')) map.removeLayer('ndvi');
  if (map.getSource('ndvi')) map.removeSource('ndvi');

  // Add new image source
  map.addSource('ndvi', {
    type: 'image',
    url,
    coordinates: [
      [bbox[0], bbox[3]], // top-left    [minLon, maxLat]
      [bbox[2], bbox[3]], // top-right   [maxLon, maxLat]
      [bbox[2], bbox[1]], // bottom-right [maxLon, minLat]
      [bbox[0], bbox[1]], // bottom-left  [minLon, minLat]
    ],
  });

  // Insert NDVI layer above labels but below field outline
  map.addLayer(
    { id: 'ndvi', type: 'raster', source: 'ndvi', paint: { 'raster-opacity': 0.85 } },
    'field-fill' // insert before field layers
  );
}, [field, date]);
```

**✅ Done when:** Drawing a field over a known crop area (try Ludhiana in November–March) shows a green-yellow-orange heatmap rectangle. Green = healthy vegetation, orange/red = stressed or bare soil.

> **Tip:** If you get a transparent image, the date you picked may have cloud cover. Try `2024-02-15` for Punjab — clear sky in winter.

---

### Phase 5 — Date Selector · ~30 min

**What you build:** Switching dates updates the NDVI overlay.

**Steps:**
1. Add a `<input type="date" />` to `Sidebar.tsx`
2. Wire its `onChange` to update the `date` state in `App.tsx`
3. The Phase 4 `useEffect` already watches `date` — it will automatically re-fetch and replace the NDVI source

**`Sidebar.tsx` date control:**
```tsx
interface Props {
  field: Feature<Polygon> | null;
  date: string;
  onDateChange: (d: string) => void;
}

export default function Sidebar({ field, date, onDateChange }: Props) {
  return (
    <div style={{ width: 280, padding: 16, borderRight: '1px solid #e5e7eb' }}>
      <h2 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>viz-crop prototype</h2>

      <button onClick={/* trigger draw mode */}>
        Draw field
      </button>

      {field && (
        <div style={{ marginTop: 16 }}>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
            NDVI date
          </label>
          <input
            type="date"
            value={date}
            max={new Date().toISOString().split('T')[0]}
            onChange={e => onDateChange(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
```

**✅ Done when:** Picking a date in a dry winter month (February) vs monsoon month (July) produces visibly different NDVI values for the same field. This confirms the time dimension is working.

---

### Phase 6 — Verification · ~30 min

**What you build:** Nothing new — confirm everything works on real Indian fields.

**Three test fields to verify:**

| Location | Coordinates (centre) | Season to test | Expected NDVI |
|---|---|---|---|
| Ludhiana, Punjab | `[75.85, 30.90]` | Nov–Feb (rabi wheat) | Moderate-high green |
| Akola, Maharashtra | `[77.00, 20.70]` | Oct–Dec (post-kharif) | Mixed brown/green |
| EOS screenshot field | `[77.17, 8.50]` | Jan–Mar (dry season) | Variable |

**Verification checklist for each field:**

- [ ] Satellite imagery renders sharp at zoom 14–16
- [ ] Village/road labels are readable
- [ ] Polygon draws cleanly, no snapping issues
- [ ] NDVI loads within a few seconds of polygon finishing
- [ ] NDVI shows colour variation (not all one colour)
- [ ] Switching dates visibly changes the NDVI
- [ ] No console errors during any of the above

---

## MapLibre Layer Ordering Reference

Layer order in MapLibre is controlled by the order you call `addLayer()`. Last added = on top. The correct final order from bottom to top:

```
1. esri-sat          (Esri satellite raster — background)
2. esri-transport    (Esri roads raster)
3. esri-labels       (Esri labels raster)
4. ndvi              (Copernicus NDVI raster — above labels)
5. field-fill        (polygon semi-transparent fill)
6. field-outline     (polygon solid white outline — topmost)
```

When inserting layers dynamically, always use the `beforeId` parameter:

```typescript
// Insert NDVI above labels but below field layers
map.addLayer({ id: 'ndvi', ... }, 'field-fill');
```

---

## Common Gotchas

### 1. Layer order breaks silently
If NDVI appears below the label layer, you'll still see colour but labels will overlay it — looks broken. Always use `beforeId` when inserting dynamic layers. Check layer order if something looks visually wrong.

### 2. Esri token — use `ibasemaps-api`, not `basemaps-api`
There are two Esri base domains. `ibasemaps-api` serves raster (image) tiles for World_Imagery, World_Transportation, and World_Boundaries_and_Places. `basemaps-api` serves vector tiles (different format, different setup). Using the wrong one gives silent 401 errors.

### 3. Sentinel Hub layer name must match exactly
The `LAYERS=NDVI` parameter in your WMS URL must exactly match the layer name you set in the Sentinel Hub dashboard. Case-sensitive. If your dashboard layer is named `ndvi-layer`, the URL must say `LAYERS=ndvi-layer`.

### 4. NDVI returns transparent when clouds are present
Sentinel-2 is an optical sensor. During India's monsoon (June–September), cloud cover can mean completely transparent tiles. Always test with a known clear-sky date first (February–March for north India). Add `MAXCC=20` to the WMS URL to reject images with >20% cloud cover.

### 5. `terra-draw` vs `@mapbox/mapbox-gl-draw`
The original `@mapbox/mapbox-gl-draw` only works with Mapbox GL JS (proprietary). The community MapLibre fork is unmaintained. Use `terra-draw` with its MapLibre adapter — TypeScript-first, actively maintained, cleaner event handling.

### 6. Image source coordinates order
MapLibre's `image` source expects coordinates in `[top-left, top-right, bottom-right, bottom-left]` order (clockwise). Turf's `bbox` returns `[minLon, minLat, maxLon, maxLat]`. Make sure you convert correctly:

```typescript
coordinates: [
  [bbox[0], bbox[3]], // top-left    = [minLon, maxLat]
  [bbox[2], bbox[3]], // top-right   = [maxLon, maxLat]
  [bbox[2], bbox[1]], // bottom-right = [maxLon, minLat]
  [bbox[0], bbox[1]], // bottom-left  = [minLon, minLat]
]
```

### 7. `map.isStyleLoaded()` check
Any `useEffect` that calls `map.addSource` or `map.addLayer` must check `map.isStyleLoaded()` first. MapLibre's map object may exist before the style is fully loaded.

---

## Out of Scope for This Prototype

The following are deliberately **not** built. They belong in the MVP, not the integration spike.

| Feature | When to add |
|---|---|
| User authentication | Phase 2 (productisation) |
| Database / persisting fields | Phase 2 |
| Backend API server | Phase 2 |
| Multiple fields per user | Phase 2 |
| Field dashboard / list view | Phase 2 |
| Per-pixel NDVI clipping to polygon | Phase 1 polish |
| dpRVI radar layer (Sentinel-1) | After NDVI is working |
| Timeline scrubber / date range | After basic date picker works |
| Stats panel (mean, p10/p90) | Phase 1 MVP |
| Cloud cover indicator | Phase 1 MVP |
| Mobile responsive layout | Phase 2 |
| Tests | Phase 2 |
| Deployment / CI/CD | Phase 2 |

---

## Cost Summary

| Layer | Provider | Prototype cost | MVP scale (500 fields) |
|---|---|---|---|
| Esri satellite | ArcGIS Location Platform | $0 (2M tiles/month free) | $0 (still within free tier) |
| Esri labels + roads | ArcGIS Location Platform | $0 (same quota) | $0 |
| NDVI (on-demand, 4 scans/yr) | Copernicus Sentinel Hub | $0 (10K PU/month free) | $0 (3 PU/month total) |
| NDVI (auto-refresh, 73/yr) | Copernicus Sentinel Hub | $0 | ~$0 (still free tier) |
| **Total** | | **$0** | **~$0–25/month** |

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
| Esri basemap tile reference | https://developers.arcgis.com/rest/basemap-styles |
| Geofabrik India OSM extract | https://download.geofabrik.de/asia/india.html |

---

*Generated from viz-crop product planning session — May 2026*