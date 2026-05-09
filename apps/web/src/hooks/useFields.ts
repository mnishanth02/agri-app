/**
 * Module 1.7 — TanStack Query hooks wrapping the `/api/fields` CRUD routes
 * shipped in Module 1.6 (`apps/api/src/routes/fields.ts`).
 *
 * Design choices (see plan-1.7.md in the session workspace for the full
 * pre-implementation rubber-duck pass):
 *
 * - **Query key factory.** `fieldsKeys.list()` is `['fields', 'list']` and
 *   `fieldsKeys.detail(id)` is `['fields', 'detail', id]`. Both share the
 *   `['fields']` prefix, so `invalidateQueries({ queryKey: fieldsKeys.all })`
 *   correctly hits both. The explicit `'list'` / `'detail'` segments make
 *   the intent obvious and leave room for future siblings (e.g., a
 *   `['fields', 'count']` aggregate) without key collisions.
 *
 * - **Boundary validation with `fieldDto`.** Even though the API already
 *   parses every outgoing row, the client re-parses because (a) it gives
 *   crisp `ZodError` runtime errors during dev if the contract drifts, and
 *   (b) `fieldDto` performs `areaHectares: z.coerce.number()` which is the
 *   only safe place to handle the `numeric → string` quirk if any path is
 *   ever added that bypasses the API parse. The runtime cost is small for
 *   Phase 1 (≤ a few hundred fields per user); revisit if list size grows.
 *
 * - **Update strategy.** PATCH returns the full updated row. We
 *   `setQueryData(detail, updated)` for instant UI refresh AND invalidate
 *   only the list — invalidating the detail key on top would cancel the
 *   `setQueryData` benefit by forcing an immediate refetch.
 *
 * - **Delete strategy.** DELETE returns 204. We `removeQueries(detail)` so
 *   the cache doesn't serve stale data if the user navigates back to the
 *   deleted UUID, then invalidate the list. Callers are responsible for
 *   navigating away from a detail page they just deleted (otherwise the
 *   active detail query will refetch and 404 — by design).
 *
 * - **Abort signals.** Every read query forwards TanStack's `signal` into
 *   `apiFetch` so unmounted / superseded queries don't keep the network
 *   busy. Mutations do not accept `signal` in TanStack Query — those are
 *   user-initiated actions that should always run to completion.
 */

import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  type CreateFieldDto,
  type FieldDto,
  fieldDto,
  type UpdateFieldDto,
} from '@viz-crop/shared';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';

const FIVE_MINUTES = 5 * 60 * 1000;

/**
 * Query key factory. Always derive keys from this object — never hand-build
 * arrays at the call site. That way refactors of the key shape touch one
 * place instead of every consumer.
 */
export const fieldsKeys = {
  all: ['fields'] as const,
  list: () => [...fieldsKeys.all, 'list'] as const,
  detail: (id: string) => [...fieldsKeys.all, 'detail', id] as const,
};

/**
 * Response envelope returned by `GET /api/fields`. Kept private to this
 * module so call sites only ever see the unwrapped `FieldDto[]`.
 *
 * Validating the envelope (rather than `data.fields` directly) means a
 * malformed top-level response surfaces as a clear `ZodError` instead of a
 * `TypeError: Cannot read properties of undefined`.
 */
const fieldListResponseSchema = z.object({
  fields: z.array(fieldDto),
});

/**
 * `GET /api/fields` — list every field owned by the signed-in user.
 *
 * `staleTime: 5 min` per the implementation spec. The list rarely changes
 * outside of explicit user actions (create / update / delete), all of
 * which invalidate this key on success — so a 5 min stale window is a
 * good battery / network compromise.
 */
export function useFieldList(): UseQueryResult<FieldDto[], Error> {
  return useQuery({
    queryKey: fieldsKeys.list(),
    queryFn: async ({ signal }) => {
      const data = await apiFetch<unknown>('/api/fields', { signal });
      return fieldListResponseSchema.parse(data).fields;
    },
    staleTime: FIVE_MINUTES,
  });
}

/**
 * `GET /api/fields/:id` — fetch a single field. Returns 404 if the row
 * does not exist or is owned by another user.
 *
 * Disabled when `id` is an empty string so a partially-rendered route
 * doesn't accidentally fire `GET /api/fields/`. TanStack Router params
 * should always provide a string, but the guard is cheap insurance.
 */
export function useField(id: string): UseQueryResult<FieldDto, Error> {
  return useQuery({
    queryKey: fieldsKeys.detail(id),
    queryFn: async ({ signal }) => {
      const data = await apiFetch<unknown>(`/api/fields/${id}`, { signal });
      return fieldDto.parse(data);
    },
    enabled: id.length > 0,
    staleTime: FIVE_MINUTES,
  });
}

/**
 * `POST /api/fields` — create a new field. The API responds with `{ id }`
 * (201). On success we invalidate only the list — no existing detail
 * entries can possibly be affected by an insert.
 *
 * Callers typically navigate to `/fields/$id` with the returned id; that
 * navigation will trigger `useField(id)` which (after the list
 * invalidation refresh) will hit the freshly-warm cache.
 */
export function useCreateField(): UseMutationResult<{ id: string }, Error, CreateFieldDto> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: CreateFieldDto) =>
      apiFetch<{ id: string }>('/api/fields', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(variables),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fieldsKeys.list() });
    },
  });
}

/**
 * `PATCH /api/fields/:id` — update metadata fields. Geometry is immutable
 * for v2 (see `updateFieldDto` JSDoc in `packages/shared`).
 *
 * On success we hand the returned row to `setQueryData` so the detail
 * query has the new value immediately, then invalidate only the list.
 * Invalidating the detail key on top would force an instant refetch and
 * undo the `setQueryData` benefit.
 *
 * Note: `mutate({})` is type-valid (Zod `.refine()` does not narrow the
 * inferred TS type) but the API will respond 400. Form callers should
 * always pass at least one populated field.
 */
export function useUpdateField(id: string): UseMutationResult<FieldDto, Error, UpdateFieldDto> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (variables: UpdateFieldDto) => {
      const data = await apiFetch<unknown>(`/api/fields/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(variables),
      });
      return fieldDto.parse(data);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(fieldsKeys.detail(id), updated);
      void queryClient.invalidateQueries({ queryKey: fieldsKeys.list() });
    },
  });
}

/**
 * `DELETE /api/fields/:id` — hard delete. The DB cascades to derived
 * caches (cached_scenes / cached_ndvi_stats).
 *
 * On success we drop the detail entry from cache so a stale row can't be
 * served if the user navigates back to the deleted UUID, then refresh
 * the list. Callers are responsible for navigating away from a detail
 * page they just deleted.
 */
export function useDeleteField(id: string): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiFetch<null>(`/api/fields/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: fieldsKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: fieldsKeys.list() });
    },
  });
}
