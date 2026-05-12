/**
 * Module 7.3 / 7.4 — shared NDVI color thresholds.
 *
 * Both the Sample sidebar pane (Module 7.3) and the Chart tab (Module
 * 7.4) classify NDVI / EVI / NDWI scalar values into three "vegetation
 * health" buckets so the user gets the same visual signal whether they
 * are reading the per-scene mean in the sidebar or the per-scene mean
 * marker on the time-series line.
 *
 *   - red    `value < 0.3`  — "stressed / bare / water"
 *   - yellow `0.3 <= value < 0.5` — "moderate"
 *   - green  `value >= 0.5` — "healthy / dense canopy"
 *   - gray   `value === null` (no data, e.g. tombstone scene)
 *
 * Tailwind tokens chosen to match the rest of the analysis chrome
 * (`red-500`, `yellow-400`, `emerald-500`, `slate-400`).
 */

export type NdviColorKey = 'red' | 'yellow' | 'green' | 'gray';

export interface NdviColorClasses {
  /** Tailwind background utility (`bg-red-500` etc.). */
  bg: string;
  /** Tailwind text utility for foreground glyphs / numbers. */
  text: string;
  /** Tailwind border utility for outlines. */
  border: string;
  /** SVG `fill`-compatible HEX color for recharts dots. */
  hex: string;
}

export const NDVI_COLOR_CLASSES: Record<NdviColorKey, NdviColorClasses> = {
  red: {
    bg: 'bg-red-500',
    text: 'text-red-500',
    border: 'border-red-500',
    hex: '#ef4444',
  },
  yellow: {
    bg: 'bg-yellow-400',
    text: 'text-yellow-400',
    border: 'border-yellow-400',
    hex: '#facc15',
  },
  green: {
    bg: 'bg-emerald-500',
    text: 'text-emerald-500',
    border: 'border-emerald-500',
    hex: '#10b981',
  },
  gray: {
    bg: 'bg-slate-400',
    text: 'text-slate-400',
    border: 'border-slate-400',
    hex: '#94a3b8',
  },
};

/**
 * Map an NDVI / EVI / NDWI scalar to a color bucket. `null` /
 * `undefined` returns `'gray'`. Non-finite values (NaN, Infinity) also
 * collapse to `'gray'` rather than throwing — the upstream cache layer
 * already guards against persisting them, but the renderer should not
 * crash if a bad value ever slips through.
 */
export function getNdviColor(value: number | null | undefined): NdviColorKey {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'gray';
  if (value < 0.3) return 'red';
  if (value < 0.5) return 'yellow';
  return 'green';
}
