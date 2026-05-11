/**
 * Module 6.2 — TanStack Query hook wrapping `POST /api/eosda/scenes`
 * (Module 6.1, `apps/api/src/routes/eosda.scenes.ts`).
 *
 * Even though the transport is `POST` (so we can ship the
 * `{ fieldId, dateRange?, forceRefresh? }` body without URL bloat), this
 * is conceptually a **read** — it returns a list of cached scenes and
 * never has user-visible side effects. We therefore use `useQuery`, NOT
 * `useMutation`, so consumers benefit from request deduping (timeline +
 * cloud-hidden toast both subscribe to the same key), automatic
 * cache-on-mount, and a stable `query.data` reference between renders.
 * (Decision recorded as critique #10 in the Phase-6 plan refinement.)
 *
 * ## Cache shape
 *
 * - Key factory `eosdaKeys` mirrors `fieldsKeys` from `useFields.ts`.
 *   `eosdaKeys.all` is the prefix every EOSDA-derived query shares so
 *   `invalidateQueries({ queryKey: eosdaKeys.all })` is a single-line
 *   blast radius (used after a future "refresh" button or explicit
 *   `forceRefresh: true` round-trip).
 * - `staleTime` is **1 hour** — Sentinel-2 cadence is ~5 days and the
 *   API route already enforces a 24 h freshness check, so the client
 *   doesn't need to be more aggressive than that. A user navigating
 *   away from `/fields/:id` and back within the hour pays zero network.
 *
 * ## Boundary validation
 *
 * Per repo convention (see `useFields.ts`), the response is re-parsed
 * with the matching shared zod (`eosdaScenesResponse`). This is the
 * **only** safe place to coerce the wire `numeric` strings (`pg`'s
 * default `numeric` shape) into the `number`s that consumers expect via
 * `sceneDto`'s `z.coerce.number()` calls. A drifted contract surfaces
 * as a `ZodError` instead of a `Cannot read properties of undefined`
 * deep in a downstream component.
 *
 * ## Side-effect orchestration
 *
 * The companion hook `useAutoSelectDefaultScene` (sibling file) consumes
 * this query and writes a default `selectedViewId` into `useUiStore`. It
 * is mounted from `AnalysisLayout` (NOT from inside this query) so the
 * query stays a pure read and any number of components can subscribe
 * (DateTimeline, CloudHiddenToast, …) without racing each other on the
 * store.
 */

import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { type EosdaScenesRequest, eosdaScenesResponse, type SceneDto } from '@viz-crop/shared';
import { ApiError, apiFetch } from '@/lib/api';

const ONE_HOUR = 60 * 60 * 1000;

/**
 * Query key factory. Shared with future EOSDA-derived queries (e.g.,
 * `eosdaKeys.stats(fieldId, viewId)` in Phase 7) — they all live under
 * the `['eosda']` prefix so a single `invalidateQueries({ queryKey:
 * eosdaKeys.all })` after a forced refresh hits everything.
 */
export const eosdaKeys = {
  all: ['eosda'] as const,
  scenes: (fieldId: string) => [...eosdaKeys.all, 'scenes', fieldId] as const,
};

/**
 * `POST /api/eosda/scenes` — list cached Sentinel-2 scenes for a field.
 *
 * Disabled when `fieldId` is empty so a partially-rendered route
 * doesn't fire a request with `{ fieldId: '' }` (which the API would
 * 400 anyway, but the request is wasteful).
 */
export function useEosdaScenes(fieldId: string): UseQueryResult<SceneDto[], Error> {
  return useQuery({
    queryKey: eosdaKeys.scenes(fieldId),
    queryFn: async ({ signal }) => {
      const body: EosdaScenesRequest = { fieldId };
      const data = await apiFetch<unknown>('/api/eosda/scenes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      return eosdaScenesResponse.parse(data).scenes;
    },
    enabled: fieldId.length > 0,
    staleTime: ONE_HOUR,
    // Don't retry auth failures — they're not transient and a retry
    // burns a JWT round-trip while the user waits. All other errors
    // get one retry, matching the global default.
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        return false;
      }
      return failureCount < 1;
    },
  });
}
