# viz-crop — Implementation, Explained in Plain English

> A plain-language companion to [`implementation.md`](./implementation.md) and [`plan.md`](./plan.md).
> If [`implementation.md`](./implementation.md) is the **recipe** (technical steps, file names, exact commands), this document is the **menu description** — what we are cooking, what it tastes like, and why anyone would want it on the table.

**Audience:** product owners, stakeholders, new joiners, designers, or anyone who wants to understand what each piece of the project actually does for the user without reading code.

**How to read it:** Each phase has three short sections — *What we built*, *Why it matters*, *What the user can now do*. Modules sit under their phase as one-paragraph explanations.

---

## The big picture in one paragraph

We are building a web application called **viz-crop** that lets a farmer or agronomist draw their field on a satellite map of India, save it, and then see how healthy the crops on that field look using satellite imagery — color-coded over time. The app combines four things: (1) a **map** showing the real ground, (2) a **drawing tool** so the user can outline their farm, (3) a **satellite-data service (EOSDA)** that tells us how green/healthy the crops are on any given week, and (4) a **dashboard and charts** so the user can compare dates, see trends, and decide when something is off. The work is split into 9 phases, built in order, so that each phase delivers something the user can see and use, and nothing later breaks the foundation laid earlier.

---

## Table of contents

- [Pre-flight — Setting up the outside accounts](#pre-flight--setting-up-the-outside-accounts)
- [Phase 0 — The empty house with a working front door](#phase-0--the-empty-house-with-a-working-front-door)
- [Phase 1 — Saving fields to a real database](#phase-1--saving-fields-to-a-real-database)
- [Phase 2 — Putting a satellite map on the screen](#phase-2--putting-a-satellite-map-on-the-screen)
- [Phase 3 — Letting the user draw a field and save it](#phase-3--letting-the-user-draw-a-field-and-save-it)
- [Phase 4 — Quietly preparing satellite data in the background](#phase-4--quietly-preparing-satellite-data-in-the-background)
- [Phase 5 — Building the analysis screen layout](#phase-5--building-the-analysis-screen-layout)
- [Phase 6 — Showing the crop-health heatmap on the map](#phase-6--showing-the-crop-health-heatmap-on-the-map)
- [Phase 7 — Numbers and charts about field health](#phase-7--numbers-and-charts-about-field-health)
- [Phase 8 — Polish, safety nets, and handover](#phase-8--polish-safety-nets-and-handover)

---

## Pre-flight — Setting up the outside accounts

**What we built:** Three sign-ups with companies whose services we depend on — **ArcGIS** (for the satellite basemap), **EOSDA** (for the actual crop-health imagery and statistics), and **Clerk** (for letting users sign in safely).

**Why it matters:** Our app is not magic — it stitches together a few specialised services that already exist. Each of those services hands us a unique secret key. Without the keys, the satellite map is blank, the crop-health pictures never arrive, and nobody can log in. We start the sign-ups on day one because the EOSDA trial in particular takes time to be activated by their support team.

**What the user can now do:** Nothing yet — this is plumbing. But the rest of the build is unblocked.

---

## Phase 0 — The empty house with a working front door

**What we built:** The skeleton of the project. Think of it as building an empty house — the foundation is poured, the walls are up, the front door has a working lock — but there are no rooms yet. Specifically: a code workspace, a local copy of the database, a backend service, a frontend website, page-routing so URLs like `/sign-in` and `/` work, and a real sign-in screen powered by Clerk.

**Why it matters:** Every later feature lives inside this skeleton. We want the foundation to be correct **before** we start putting furniture in, because moving foundations later is expensive. We also want the front door (sign-in) working from the start so we never accidentally ship features that anyone on the internet can see.

**What the user can now do:** Visit the site, see a Clerk sign-in screen, sign in, and land on a blank dashboard page. That is all — but it is signed-in, secure, and ready to be built on.

### Module 0.1 — Workspace skeleton
Set up the project folder so that the website code, the backend code, and the shared code all live together neatly and share the same formatting and code-quality rules. We picked one tool (Biome) to handle both formatting and code-quality so there is never an argument between two tools about how the code should look.

### Module 0.2 — Local Postgres + PostGIS
Started a local copy of the database (Postgres) inside Docker, with a special add-on called **PostGIS** that knows how to store and reason about geographic shapes — polygons, points, distances, areas. This is the same database that will hold every user's saved fields.

### Module 0.3 — `packages/shared` skeleton
Created a small shared library that both the website and the backend can import. It will eventually hold the data shapes (e.g. "what does a 'field' look like?") so the two sides can never accidentally disagree on the format.

### Module 0.4 — `apps/api` skeleton
Built the empty backend service — the bit that lives on the server, talks to the database, and answers requests like "list my fields" or "save this field". Right now it only answers a single health-check question ("are you alive?" → "yes").

### Module 0.5 — `apps/web` skeleton
Built the empty website — the bit the user sees in their browser. Wired up Tailwind CSS and a component library called **shadcn** so we have nice-looking buttons, dialogs, and forms ready to use later.

### Module 0.6 — TanStack Router (file-based)
Decided how URLs map to pages. With this in place, going to `/sign-in` shows the sign-in page, going to `/fields/new` shows the create-field page, and so on. Pages can be marked as "must be signed in" centrally, so we never forget.

### Module 0.7 — TanStack Query
Added the system that the website uses to talk to the backend, automatically caches the answers, and re-fetches when needed. This means lists update on their own, the same data is never fetched twice in a row, and loading/error states are handled in one consistent way everywhere.

### Module 0.8 — Clerk auth (web + API)
Connected the real sign-in. From now on, opening the site without being signed in bounces the user to a Clerk sign-in screen; after signing in they land on the dashboard. The backend also checks every request — without a valid sign-in token, requests are rejected. This is the security wall the rest of the app sits behind.

---

## Phase 1 — Saving fields to a real database

**What we built:** The first thing a user actually does — create, list, rename, and delete fields — is fully working end-to-end. The backend stores the field's polygon shape inside the geographic database; the dashboard shows the user their fields as cards with the calculated area in hectares.

**Why it matters:** Until this phase, "fields" did not exist. After this phase, they do — they are saved, they belong to one user (other users can't see them), and the database itself enforces that the shape is a valid polygon inside India and not some impossible blob. The frontend can list them, the area is computed automatically, and each user only sees their own data.

**What the user can now do:** After signing in, see a dashboard. If they have no fields, they see an empty-state screen. If they have fields (we can create them via direct API calls for now), they see cards with the field name, crop, area in hectares, and a kebab menu offering rename and delete with a confirm dialog.

### Module 1.1 — Drizzle setup
Picked **Drizzle** as the bridge between the backend code and the database. From now on, the backend can talk to the database in TypeScript instead of writing raw SQL by hand for every operation.

### Module 1.2 — Schema + initial migration
Designed the actual tables in the database — most importantly the `fields` table that holds each saved field, and two cache tables (`cached_scenes` and `cached_ndvi_stats`) for storing satellite results we have already paid to fetch. The database is told to compute the area of each field automatically and to refuse polygons that are invalid or in the wrong coordinate system.

### Module 1.3 — Geometry helpers (server-side)
Added small helper functions so that whenever the backend reads or writes a polygon, it does so the same way every time — converting safely between the format the database expects and the standard "GeoJSON" format the rest of the world uses.

### Module 1.4 — Shared zod schemas (fields + geometry)
In the shared library, wrote down precisely what a "valid field" looks like — the name length, the allowed crop types (Rice, Wheat, Cotton, etc.), the four seasons (Kharif, Rabi, Zaid, Annual), and the rules a polygon must obey (closed ring, inside the India bounding box, not too small, not too large). Both the website and the backend use this single source of truth, so they cannot drift apart.

### Module 1.5 — Geometry area + bounds validation tests
Wrote automated tests that check the rules above keep working as the code changes. For example: a 1-hectare polygon in Karnataka should be accepted, but the same polygon in New York should be rejected because we are an India-only product for now.

### Module 1.6 — Field routes (CRUD)
Built the backend endpoints for list / create / read / rename / delete. Every endpoint checks that the request is signed in, and that the user is only touching fields they themselves own.

### Module 1.7 — Web `useFields` hook
Built the website's wrapper around those endpoints, so any page that wants the list of fields just asks `useFieldList()` and gets back data, loading state, and errors.

### Module 1.8 — Dashboard UI
Built the actual dashboard the user sees: empty-state screen for new users, a grid of cards for users with fields, and a kebab menu on each card for rename / delete with a confirmation dialog.

### Module 1.9 — Auth/ownership smoke tests for the API
Added automated tests that prove the backend really does keep users separated. User A cannot see, edit, or delete User B's fields — and the test suite will fail loudly if anyone ever breaks that rule by accident.

---

## Phase 2 — Putting a satellite map on the screen

**What we built:** A real, full-bleed satellite map of Karnataka with road and place labels, showing on the create-field page. No drawing yet — just the map.

**Why it matters:** The map is the centrepiece of the whole product. Before we let the user draw on it, we need a clean, well-behaved map that loads quickly, shows the right area by default, and does not leak memory or duplicate itself when the user navigates around. We are using **MapLibre** for the map itself and **ArcGIS** for the satellite imagery + labels, because that combination gives us beautiful imagery with road and city names baked in.

**What the user can now do:** Click "Add field" and see a real satellite map of Karnataka they can pan and zoom. There is still no way to draw on it.

### Module 2.1 — MapLibre installation + base styles
Installed the map library and made the satellite-imagery key (from ArcGIS) a hard requirement. If the key is missing, the app refuses to start with a clear error — better than launching with a broken grey map.

### Module 2.2 — `useMapInstance` hook (StrictMode-safe)
Built a small reusable piece of code that creates exactly one map per page and cleans it up properly when the user navigates away. This sounds simple but is one of the most common sources of map bugs (duplicate maps, memory leaks, missing layers). We did it once, carefully, so every page that uses a map gets it right for free.

### Module 2.3 — `MapView` component
Wrapped the map hook above into a component called `MapView` that any page can drop in. It also makes the map available to any "overlay" component sitting inside it (drawing tools, the field outline, the heatmap layer) without manual wiring.

### Module 2.4 — ArcGIS basemap plugin
Connected the ArcGIS satellite imagery + labels style. The result is the photographic satellite view with road names and city names overlaid — the kind of map a farmer can recognise their village on.

### Module 2.5 — `CreateLayout` shell + Karnataka default
Built the two-column "create field" page: ~70% map on the left, ~30% form column on the right (form is still a placeholder). The map opens centred on Karnataka at a reasonable zoom level.

---

## Phase 3 — Letting the user draw a field and save it

**What we built:** The full create-a-field flow. The user can draw a polygon on the map by clicking points, see the area update live, fill in the form on the right, and click **Create Field** — which saves the field, navigates them to the analysis page, and adds the new field to their dashboard.

**Why it matters:** This is the moment the user becomes an owner — they have put their farm into our system. The drawing experience must feel forgiving (you can clear and redo), it must catch obvious mistakes early (self-intersecting "bowtie" shapes, polygons that are clearly not in India, polygons that are absurdly big or small), and the form must refuse to submit until everything is consistent.

**What the user can now do:** Draw their field on the map, see "1.42 ha" update as they draw, fill in name + crop + season + village/district, click Create, and immediately land on their new field's analysis page (which is still mostly empty until Phase 5 builds it out).

### Module 3.1 — `useUiStore` and `useFieldStore` (Zustand)
Set up two small "memory boxes" the website uses to remember things across components without prop-drilling — one for the field-being-drawn (the draft polygon, its area, whether it's valid) and one for general UI state (which sidebar item is open, which date is selected, etc.).

### Module 3.2 — Terra-draw integration
Plugged in **Terra Draw**, the library that turns the map into a drawing surface. The user can now click points on the map to outline a polygon, and the result is stored in the draft memory-box from 3.1. Bowtie shapes (where the line crosses itself) are caught and the user gets a friendly toast asking them to redraw.

### Module 3.3 — `FieldLayer` (Layer 3)
Made the drawn polygon visually appear as a translucent white fill with a white outline on the map. This same component is reused on the analysis page later to show the saved field outline.

### Module 3.4 — Geometry feedback (live area + validation hints)
Added the live area calculation (in hectares) and live validation messages so the user sees immediately if their polygon is too small, too large, or outside India — instead of finding out only after they hit submit.

### Module 3.5 — `CreateFieldForm`
Built the form on the right column: name, crop dropdown, season selector, and the optional metadata fields (farmer name, village, district, state). The submit button stays disabled until both the form and the polygon are valid.

### Module 3.6 — Wire `CreateLayout` form column
Replaced the placeholder column from Phase 2 with the real form. Now the map and the form work together as one screen.

---

## Phase 4 — Quietly preparing satellite data in the background

**What we built:** The moment a user saves a new field, the backend quietly fires off two requests to EOSDA — one to register the polygon for image-clipping, and one to find the most recent Sentinel-2 satellite scene that covers it. The user does not wait for these — they happen in the background, and the results land in our cache so the analysis page is fast when the user opens it.

**Why it matters:** EOSDA is a paid, rate-limited external service. We want to be polite (not call them more than necessary), fast for the user (cache everything we get), and resilient (if EOSDA is down or slow, field creation must still succeed). This phase introduces all the discipline around how we talk to EOSDA so later phases can simply read from the cache.

**What the user can now do:** Nothing visibly different from Phase 3 — but behind the scenes, by the time the user clicks into their new field, the latest satellite scene metadata is already waiting.

### Module 4.1 — EOSDA HTTP client
Built one small wrapper that all our EOSDA calls go through. It attaches the API key the right way, handles errors uniformly, and importantly **never logs the API key** even when something goes wrong.

### Module 4.2 — Cropper-ref creation/reuse
For each new field, asks EOSDA to register the polygon and remember it under a 32-character ID called the `cropper_ref`. Later, when we ask EOSDA for an NDVI image, we pass this ID so the image comes back already cropped to the field's exact shape, instead of a square tile that bleeds into the neighbours.

### Module 4.3 — Search wrapper
A typed wrapper around EOSDA's "Search" endpoint, which answers the question "which Sentinel-2 satellite scenes cover this polygon between these two dates, sorted by newest first?" The answers are normalised so the rest of the code does not have to deal with EOSDA's mixed naming conventions (`sceneID` vs `view_id` vs `dataCoveragePercentage`).

### Module 4.4 — Scene cache service
The little service that writes the search results into our `cached_scenes` table. Re-saving the same scene is safe — the database treats it as an "update if exists, insert if new" so there are no duplicates.

### Module 4.5 — `field-warmup` orchestrator
The function that ties 4.2, 4.3, and 4.4 together — given a new field ID, it does the cropper registration and the latest-scene lookup in parallel, and tucks the results away. If something fails it logs cleanly and exits without crashing field creation.

### Module 4.6 — Wire `warmField` into `POST /api/fields`
Hooks the warm-up into the "create field" endpoint. The endpoint returns immediately (the user does not wait), and the warm-up runs by itself in the background.

---

## Phase 5 — Building the analysis screen layout

**What we built:** The full visual scaffolding of the analysis page (`/fields/:id`) — top bar with the field name and area, collapsible right sidebar with all the icons (Sample, Monitoring, Weather, etc.), collapsible bottom bar with three tabs, and all the small map overlays (zoom controls, scale bar, date timeline, source/index switchers, opacity slider, fullscreen, etc.) — even though most of them are visual stubs without real data behind them yet.

**Why it matters:** Building all the chrome at once means we can verify the whole layout matches the reference screenshots, that nothing overlaps or breaks at small screen sizes, and that the navigation feels right. Each stubbed control can then be wired to live data in later phases without ever revisiting the layout.

**What the user can now do:** Click into a field from the dashboard and see the proper analysis layout — their field outline on the satellite map, the field name and area in the top bar, sidebar icons they can click to expand a "Coming soon" pane, and the bottom bar with tabs they can flip between. The Crop info tab shows real metadata (crop and season). Other tabs and sidebar items are placeholders.

### Module 5.1 — `AnalysisLayout` shell
The top-level page layout for `/fields/:id` — full-bleed map underneath, with three slots for the top bar, right sidebar, and bottom bar overlaid on top.

### Module 5.2 — `TopBar`
The bar across the top: back arrow, field icon, field name, area in hectares, crop type, "Get Overview" button (no-op for v2), and an "All fields" dropdown.

### Module 5.3 — `RightSidebar` (collapsible)
The thin icon rail on the right that expands to a wider pane when you click an icon. All twelve sidebar items from the design (Sample, Monitoring, Weather, Field activity, VRA maps, Scout tasks, Data manager, Field manager, AI assistant, Notifications, Help, Marketplace) are there as icons; only **Sample** will get real content (in Phase 7), the rest say "Coming soon".

### Module 5.4 — `BottomBar`
The collapsible bar at the bottom with three tabs — **Crop info** (shows the field's crop and season + placeholder cards for growth stages, risks, and sown area), **Chart** (placeholder until Phase 7), and **Activities** (empty list).

### Module 5.5 — Map overlays (visual only)
All the small floating controls on the map: live cursor coordinates (top-left), scale bar (top-right), zoom buttons (left), date timeline (bottom — visual only for now), cloud-hidden toast (bottom-left), and the bottom-right cluster: source switcher (Sentinel-2), index switcher (NDVI/EVI/NDWI), opacity slider, download button, fullscreen button, sidebar collapse toggle.

---

## Phase 6 — Showing the crop-health heatmap on the map

**What we built:** The actual NDVI heatmap — a coloured image that overlays the field, where green means healthy crop, yellow means stressed, and red means very stressed or bare. The date timeline at the bottom is now real: it shows the actual dates EOSDA has imagery for, with a cloud icon on cloudy ones, and clicking a date repaints the heatmap. The NDVI/EVI/NDWI switcher at the bottom-right also works.

**Why it matters:** This is the core of the product — the whole reason the user came here. Until now they had a map; now they have a map that tells them something useful about their crop. Importantly, every NDVI tile flows through our own backend (which adds the secret EOSDA key on the server side) — the user's browser never sees the EOSDA key, and we count exactly how much imagery we serve.

**What the user can now do:** Open one of their fields and see a colour-coded NDVI heatmap clipped to its shape on top of the satellite. Click a different date in the timeline to see how the field looked then. Switch from NDVI to EVI or NDWI in the bottom-right to see different crop-health indices.

### Module 6.1 — `POST /api/eosda/scenes`
Backend endpoint that returns the list of available satellite dates for a field. It reads our cache first, and only calls EOSDA when the cache is stale or missing dates the user is asking for.

### Module 6.2 — `useEosdaScenes` hook
The website wrapper around that endpoint. It also automatically picks a sensible default date for the user (newest scene with low cloud cover) the first time they open a field.

### Module 6.3 — Render proxy route
The backend endpoint that fetches a single NDVI/EVI/NDWI image tile from EOSDA on behalf of the user. It checks the user owns the field, validates that the requested date and band are sensible, attaches the EOSDA API key on the server side, and streams the resulting PNG image back to the browser. The browser only ever sees our endpoint, never EOSDA's.

### Module 6.4 — `NdviLayer` (Layer 4)
The map layer that fetches the heatmap tiles from our render endpoint and draws them on the map at the right opacity, below the road labels and the field outline.

### Module 6.5 — Wire DateTimeline interactivity
Replaces the visual stub from Phase 5 with a real, clickable date strip. Each available scene becomes a chip with a cloud icon if it's cloudy; clicking switches the heatmap to that date. Cloudy dates can be hidden via a toggle.

### Module 6.6 — `IndexSwitcher` wired
The NDVI/EVI/NDWI switcher in the bottom-right is now connected — picking EVI or NDWI swaps the heatmap to the chosen index.

---

## Phase 7 — Numbers and charts about field health

**What we built:** The Sample sidebar pane on the right shows real numbers — the Mean NDVI for the selected date (big, color-coded red/yellow/green), plus p10 / p90 / median, plus a confidence indicator based on cloud cover. The Chart tab in the bottom bar shows a line graph of Mean NDVI across all the dates we have data for, so the user can spot trends.

**Why it matters:** The heatmap is great for "where is the trouble", but the numbers and the chart answer "how bad is it" and "is it getting better or worse over time". EOSDA exposes a separate, asynchronous "Statistics" service for this — it's slower than the imagery, so we cache the results aggressively.

**What the user can now do:** Open the **Sample** item in the right sidebar and see "Mean NDVI 0.62" in green, with the confidence and the spread. Open the **Chart** tab in the bottom bar and see a line plotting Mean NDVI over the past few months — high in the growing season, dropping after harvest, etc. They can tell at a glance whether their field is doing better or worse than last month.

### Module 7.1 — `POST /api/eosda/stats`
Backend endpoint that returns NDVI statistics for a field. It checks the cache first; on a miss it asks EOSDA to compute them (an asynchronous task that takes seconds to a minute), polls until the result is ready, caches it, and returns it.

### Module 7.2 — `useEosdaStats` hook
Website wrapper around the stats endpoint. Handles slow responses gracefully and shows a friendly "still computing" toast on the rare second timeout.

### Module 7.3 — Sample sidebar pane
Builds the Sample pane: the big Mean NDVI number with red/yellow/green color, the smaller p10/p90/median line, the cloud + data-coverage confidence line, and a mini histogram of the NDVI values across the field.

### Module 7.4 — Chart tab
Replaces the placeholder Chart tab with a real line chart (recharts) — x-axis is date, y-axis is Mean NDVI, dots colored by the same red/yellow/green thresholds, with cloudy points faded so the user knows to trust them less.

---

## Phase 8 — Polish, safety nets, and handover

**What we built:** All the polish that turns a working prototype into something a teammate can run and demo without prior knowledge — proper loading skeletons everywhere, friendly error toasts when something breaks, the rename and delete flows fully wired with confirm dialogs, a broader test suite, and a README that walks a new developer from "I just cloned the repo" to "I have a working app" without guesswork.

**Why it matters:** The earlier phases focused on making things work; this phase makes them feel professional and lets others repeat what we did. It is also where we run the full demo checklist from `plan.md` to catch anything that slipped through.

**What the user can now do:** Use the whole product end-to-end without weird empty screens, mysterious errors, or dead buttons. A new developer can clone the repo, run a few commands from the README, and get the same working app on their machine.

### Module 8.1 — Loading + error UX
Adds skeleton placeholders everywhere data is loading (dashboard list, polygon load, date timeline, sample pane, chart) and a single helper that turns any backend error into a readable toast notification — including translating known error codes (like "EOSDA quota exceeded") into friendly language.

### Module 8.2 — Field rename + delete dialogs
Wires up the rename and delete actions on the dashboard kebab menu and on the analysis page's "All fields" dropdown, with proper confirm dialogs so a user does not accidentally delete a field they spent time drawing.

### Module 8.3 — API smoke tests (expanded)
Adds more automated tests for the EOSDA-related backend endpoints — proving that one user cannot peek at another user's scenes, that nonsense parameters are rejected, and that only the allowed indexes (NDVI / EVI / NDWI) are accepted.

### Module 8.4 — Demo data & README
Walks the full demo checklist from `plan.md` against five test fields, and writes the README so a new contributor needs only Node, pnpm, Docker, and the three account keys to get the app running cold.

---

## How the phases stack on top of each other

If you read only this list, you get the story:

1. **Phase 0** — empty house with a working front door (sign-in works, but no rooms).
2. **Phase 1** — the user can save fields to a real database.
3. **Phase 2** — there is a real satellite map of India on the screen.
4. **Phase 3** — the user can draw a field on that map and save it.
5. **Phase 4** — when they save, satellite data is quietly prepared in the background.
6. **Phase 5** — the analysis screen layout is built (still mostly stubs).
7. **Phase 6** — the NDVI heatmap and the date timeline come alive.
8. **Phase 7** — the numbers and the trend chart show up.
9. **Phase 8** — polish, error handling, README, demo-ready.

Every phase ends with something a real user could touch. Nothing later breaks anything earlier, because the build order respects dependencies — the satellite map is built before the drawing tool, the drawing tool before the save flow, the save flow before the warm-up, the warm-up before the analysis screen needs the data.

---

## Glossary (for non-technical readers)

- **NDVI / EVI / NDWI** — three different mathematical recipes for turning a satellite image into a "how green / how stressed / how wet" picture. NDVI is the most common; the user can switch between them.
- **Polygon** — the closed shape the user draws around their field on the map.
- **Hectare (ha)** — a unit of area; 1 ha = 10,000 m² ≈ 2.47 acres.
- **Sentinel-2** — the European satellite constellation whose imagery EOSDA gives us. Revisits the same place roughly every 5 days.
- **Cloud cover** — percentage of the scene covered by cloud. High cloud cover means the imagery is unreliable that day.
- **Tile** — a small square image (256 × 256 pixels) that the map fetches and stitches together to cover the visible area. Faster than fetching one giant picture.
- **EOSDA** — the third-party company that provides the satellite imagery, the index calculations (NDVI/EVI/NDWI), and the statistics. We pay them per request.
- **ArcGIS** — the third-party company that provides the satellite-photo basemap with road and place labels.
- **Clerk** — the third-party company that handles user sign-in for us, so we never store passwords ourselves.
- **PostGIS** — the geographic add-on for the Postgres database. It is what knows how to compute the area of a polygon, check it is in India, and refuse impossible shapes.
- **Cache** — a copy of an answer we already paid for, kept locally so we do not have to ask (and pay) again. Almost everything in the app that touches EOSDA is cached.
- **Warm-up** — the background work that happens right after a user creates a field, so the analysis page is fast when they open it.
