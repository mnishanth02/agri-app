/**
 * Shared date-range helpers for routes that consume EOSDA APIs by date.
 *
 * Both `routes/eosda.scenes.ts` (Module 6.1) and `routes/eosda.stats.ts`
 * (Module 7.1) need the same behaviour:
 *
 *   - Default `to` to today.
 *   - Default `from` to `to − 90 days`, anchored on the *resolved* `to`
 *     (NOT on `now`) so an explicit historical `to` produces a
 *     meaningful 90-day window around that date.
 *
 * Centralising the resolver here is the source-of-truth fix from the
 * Phase 7 plan corrections: a divergent `from` default between the
 * scenes timeline and the stats series would cause first-paint stats
 * to skip scenes that the timeline still renders (or vice versa).
 */

/** Default Search/Stats window in days when the caller omits `dateRange`. */
export const DEFAULT_WINDOW_DAYS = 90;

/** Convert a `Date` to a UTC `YYYY-MM-DD` string (mirrors `field-warmup.ts`). */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface RequestedDateRange {
  from?: string | undefined;
  to?: string | undefined;
}

export interface ResolvedDateRange {
  from: string;
  to: string;
}

/**
 * Resolve a request's `dateRange` (with possibly-omitted bounds) into a
 * concrete `{ from, to }` window in UTC `YYYY-MM-DD`.
 *
 * Defaults `to` to today and `from` to `to − DEFAULT_WINDOW_DAYS`.
 * Subtracting in milliseconds keeps the math DST-agnostic. Anchoring on
 * the resolved `to` (not on `now`) ensures an explicit historical `to`
 * value produces a meaningful window around that date instead of a
 * 90-day window ending today which would almost certainly skip the date
 * the caller asked about.
 */
export function resolveDateRange(
  requested: RequestedDateRange | undefined,
  now: Date,
): ResolvedDateRange {
  const to = requested?.to ?? toIsoDate(now);
  if (requested?.from) return { from: requested.from, to };
  const toMs = Date.parse(`${to}T00:00:00Z`);
  const anchorMs = Number.isFinite(toMs) ? toMs : now.getTime();
  const fromMs = anchorMs - DEFAULT_WINDOW_DAYS * 86_400_000;
  return { from: toIsoDate(new Date(fromMs)), to };
}
