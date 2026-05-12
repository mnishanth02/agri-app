/**
 * Module 7.2 — TanStack Query hook wrapping `POST /api/eosda/stats`
 * (Module 7.1, `apps/api/src/routes/eosda.stats.ts`).
 *
 * As with `useEosdaScenes`, the transport is `POST` to keep the
 * `{ fieldId, indexes }` body off the URL but the operation is
 * conceptually a **read**, so we use `useQuery` for dedup + cache
 * sharing across components (Sample pane and Chart tab).
 *
 * ## Cache shape
 *
 * Per Phase-7 plan correction C7b: the query key MUST include every
 * dimension that affects the response or unrelated subscribers will hit
 * a stale cache when the user toggles the index. We hash:
 *
 *   `[ ...eosdaKeys.all, 'stats', fieldId, sortedIndexes.join(',') ]`
 *
 * Sorting the indexes makes `['NDVI', 'EVI']` and `['EVI', 'NDVI']` cache
 * to the same response (the server returns the same payload for both).
 *
 * `dateRange` is **deliberately omitted** from the v2 hook signature.
 * Both this hook and `useEosdaScenes` rely on the API server's default
 * last-90-days window; opting one query into a custom range without the
 * other would let the race-fix gate below (which subscribes to a
 * `(fieldId)`-only scenes query) silently fail. When a date-range
 * picker is added in a future phase, **both** `useEosdaScenes` and
 * `useEosdaStats` must be widened together.
 *
 * ## Race fix (plan C5)
 *
 * The route's NO_SCENES_FOR_RANGE short-circuit and `findMissingPairs`
 * both depend on `cached_scenes` being populated for `fieldId`. We
 * therefore gate `enabled` on the parent `useEosdaScenes(fieldId)`
 * being **both** successful AND not currently fetching, so we never
 * fire stats while a scenes refetch (e.g., after `invalidateQueries({
 * queryKey: eosdaKeys.all })`) is in flight. Without the
 * `!isFetching` half, a forced refresh could refetch scenes and stats
 * concurrently and stats would observe a stale server-side scene
 * cache.
 *
 * ## 504 retry policy (plan C7)
 *
 * EOSDA `mt_stats` is asynchronous; the route waits up to 60s and then
 * surfaces `HTTP 504 { error: 'STATS_TIMEOUT', taskId }`. We retry that
 * exactly once after 10s — long enough for EOSDA to finish on the next
 * attempt without wedging the UI on a guaranteed-broken upstream. All
 * other failures use a `retry: 1` policy mirroring the global default
 * in `main.tsx`, EXCEPT 401/403 which never retry (auth is not
 * transient).
 *
 * ## Toast on final error
 *
 * TanStack Query v5 removed `onError` from `useQuery`. We use a local
 * effect with a `useRef` tracking the failure-count snapshot at toast
 * time so the user sees one `toast.error(...)` after the final failure
 * (post-retry) rather than two. The toast is fired from the hook so
 * consumers stay declarative.
 */
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import {
  type EosdaStatsRequest,
  type EosdaStatsResponse,
  eosdaStatsResponse,
  type VegetationIndex,
} from '@viz-crop/shared';
import { useEffect } from 'react';
import { ApiError, apiFetch } from '@/lib/api';
import { notifyError } from '@/lib/notify';
import { eosdaKeys, useEosdaScenes } from './useEosdaScenes';

const TEN_MINUTES = 10 * 60 * 1000;
const RETRY_DELAY_MS_504 = 10_000;

export interface UseEosdaStatsArgs {
  fieldId: string;
  /** Defaults to `['NDVI']`. Caller is expected to pin the user's selected index. */
  indexes?: VegetationIndex[];
}

const DEFAULT_INDEXES: VegetationIndex[] = ['NDVI'];

/** Stable, sorted, comma-joined index list for use as a single key segment. */
function indexesKeySegment(indexes: VegetationIndex[]): string {
  return [...indexes].sort().join(',');
}

/**
 * Stats subkey under the shared `eosdaKeys.all` prefix so a single
 * `invalidateQueries({ queryKey: eosdaKeys.all })` after a forced
 * refresh hits both scenes and stats consistently.
 */
const statsKey = (fieldId: string, indexes: VegetationIndex[]) =>
  [...eosdaKeys.all, 'stats', fieldId, indexesKeySegment(indexes)] as const;

function is504(err: unknown): boolean {
  return err instanceof ApiError && err.status === 504;
}

/**
 * Module-level dedupe map shared across every `useEosdaStats` call
 * site so that when SamplePane and NdviChart both subscribe to the
 * same query — and both their toast effects fire on the same terminal
 * failure — the user only sees one toast. Keyed by the stringified
 * query key so concurrent stats queries for different fields/indexes
 * still each get their own toast.
 */
const lastToastedFailureCountByKey = new Map<string, number>();

/**
 * `POST /api/eosda/stats` — read-or-compute NDVI/EVI/NDWI zonal
 * statistics for one of the caller's fields. See module-header docblock
 * for cache, retry, and race semantics.
 */
export function useEosdaStats(args: UseEosdaStatsArgs): UseQueryResult<EosdaStatsResponse, Error> {
  const { fieldId } = args;
  const indexes = args.indexes ?? DEFAULT_INDEXES;

  const scenesQuery = useEosdaScenes(fieldId);

  const queryKey = statsKey(fieldId, indexes);
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const body: EosdaStatsRequest = { fieldId, indexes };
      const data = await apiFetch<unknown>('/api/eosda/stats', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      return eosdaStatsResponse.parse(data);
    },
    enabled: fieldId.length > 0 && scenesQuery.isSuccess && !scenesQuery.isFetching,
    staleTime: TEN_MINUTES,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        return false;
      }
      // Both 504 and "everything else" follow the same once-then-give-up
      // policy in v2. The `retryDelay` below switches between the 10s
      // STATS_TIMEOUT delay and the standard exponential backoff.
      return failureCount < 1;
    },
    retryDelay: (attemptIndex, error) =>
      is504(error) ? RETRY_DELAY_MS_504 : Math.min(1000 * 2 ** attemptIndex, 30_000),
  });

  // Toast once per terminal failure across ALL subscribers of this
  // query key. v5 has no `onError` on useQuery, and a per-component
  // `useRef` guard fires once per *component* — meaning when both
  // SamplePane and NdviChart subscribe to the same query the user
  // sees two identical toasts. We dedupe via a module-level Map keyed
  // by the stringified query key (which is safe — different fields /
  // indexes get different keys, and identical keys really should
  // dedupe). The map entry is reset after a successful fetch.
  const queryKeyHash = JSON.stringify(queryKey);
  const error = query.error;
  const isError = query.isError;
  const isFetching = query.isFetching;
  const failureCount = query.failureCount;
  useEffect(() => {
    const lastToasted = lastToastedFailureCountByKey.get(queryKeyHash) ?? 0;
    if (isError && !isFetching && error && failureCount > lastToasted) {
      lastToastedFailureCountByKey.set(queryKeyHash, failureCount);
      // 504 already maps to STATS_TIMEOUT inside `notifyError` via the
      // `ApiError.body.error` sentinel that `eosda.stats.ts` returns —
      // no inline branch needed here.
      notifyError(error, { fallback: 'Failed to load statistics.' });
    }
    if (!isError) {
      lastToastedFailureCountByKey.delete(queryKeyHash);
    }
  }, [isError, isFetching, error, failureCount, queryKeyHash]);

  return query;
}
