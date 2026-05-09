/**
 * Module 3.1 — `useFieldStore` (Zustand).
 *
 * Holds the **ephemeral draft state** that the create-field flow populates as
 * the user draws a polygon on the map (Module 3.2's `useFieldDrawing` will
 * write into it; Module 3.5's `CreateFieldForm` reads from it). Once a field
 * is persisted via `useCreateField` and the user navigates to `/fields/$id`,
 * the draft is cleared and the persisted geometry is sourced from
 * `useField(id)` instead — the analysis screen never reads `draftPolygon`.
 *
 * `currentFieldId` is the only non-draft slice and is provided for any
 * cross-route component (e.g., a future TopBar selector) that needs to know
 * which field the user is viewing without prop drilling. Callers that already
 * have access to `useField(id)` should prefer that hook.
 *
 * ## Why split `FieldStoreState` and `FieldStoreActions`?
 *
 * Consumers should only re-render for slices they actually read. Splitting
 * the state and actions types lets a selector return strongly typed slices
 * (e.g., `(s) => s.draftValid`) without dragging the action signatures into
 * the inferred return type. It also makes the public surface obvious at a
 * glance and keeps `useShallow` selectors easy to express.
 *
 * ## Why no middleware?
 *
 * The draft is **deliberately ephemeral** — closing the tab, refreshing, or
 * navigating away should drop it. Persistence (`zustand/middleware/persist`)
 * would resurrect stale geometry on reload and would complicate clearing on
 * route changes. Devtools middleware is unnecessary at this size; the React
 * DevTools already show selector values inline. `subscribeWithSelector` is
 * also unnecessary: Zustand v5's plain `subscribe(listener)` only accepts a
 * full-state listener, so the verification harness in `__scratch__/verify.mts`
 * subscribes to the whole store and applies the selector + equality check
 * manually — exactly mirroring what `useSyncExternalStoreWithSelector`
 * (used by Zustand's React hook + `useShallow`) does at runtime.
 *
 * ## Canonical consumer pattern (selectors + `useShallow`)
 *
 * ```ts
 * // Single value — no useShallow needed; referential equality is fine for primitives.
 * const draftValid = useFieldStore((s) => s.draftValid);
 *
 * // Multiple values — wrap in useShallow so the consumer only re-renders
 * // when at least one of the picked values actually changes.
 * import { useShallow } from 'zustand/react/shallow';
 * const { draftPolygon, draftValid, draftAreaHectares } = useFieldStore(
 *   useShallow((s) => ({
 *     draftPolygon: s.draftPolygon,
 *     draftValid: s.draftValid,
 *     draftAreaHectares: s.draftAreaHectares,
 *   })),
 * );
 *
 * // Actions are stable references — pull them once, pass them around.
 * const setDraftPolygon = useFieldStore((s) => s.setDraftPolygon);
 * ```
 */

import { create } from 'zustand';

/**
 * Draft / current-field slices. Action signatures live on
 * `FieldStoreActions` so consumers can write selectors that return only
 * state-shaped objects without picking up function refs.
 */
export type FieldStoreState = {
  draftPolygon: GeoJSON.Polygon | null;
  draftAreaHectares: number | null;
  draftValid: boolean;
  draftErrors: string[];
  currentFieldId: string | null;
};

/** Args accepted by {@link FieldStoreActions.setDraftGeometry}. */
export type DraftGeometryUpdate = {
  polygon: GeoJSON.Polygon;
  areaHectares: number | null;
  valid: boolean;
  errors: string[];
};

export type FieldStoreActions = {
  /**
   * Set or clear the draft polygon **without touching validation slices**.
   *
   * - When called with a `GeoJSON.Polygon`, only `draftPolygon` is updated.
   *   Use this when validation will be supplied separately (rare). For the
   *   common Terra Draw case where polygon and validation come from the
   *   same `change`/`finish` event, prefer {@link FieldStoreActions.setDraftGeometry}
   *   so the consumer only re-renders once per draw tick.
   * - When called with `null`, the entire draft slice is reset (polygon,
   *   area, valid flag, errors) so a manual "discard" is one call from the
   *   `<DrawControl />` toolbar without orphaning stale validation state.
   *
   * `currentFieldId` is never touched by this action.
   */
  setDraftPolygon: (polygon: GeoJSON.Polygon | null) => void;
  /**
   * Atomically replace the derived validation slice. Always written together
   * because `useFieldDrawing` computes all three values from the same Terra
   * Draw `change`/`finish` event — splitting them into separate setters
   * would cause two intermediate re-renders per draw event.
   */
  setDraftValidation: (args: {
    areaHectares: number | null;
    valid: boolean;
    errors: string[];
  }) => void;
  /**
   * Atomically replace the polygon **and** validation slice in a single
   * `set()` call. This is the action `useFieldDrawing` (Module 3.2) should
   * call from Terra Draw `change`/`finish` handlers: writing polygon +
   * validation together avoids the transient state where consumers reading
   * `{ draftPolygon, draftValid, draftAreaHectares }` would otherwise
   * observe a fresh polygon paired with stale validation between two
   * sequential setter calls.
   *
   * `currentFieldId` is not affected.
   */
  setDraftGeometry: (update: DraftGeometryUpdate) => void;
  /**
   * Reset every draft slice to its initial value. Does **not** touch
   * `currentFieldId` — that has its own setter (`setCurrentField`) because
   * the lifetime of the active field is unrelated to the draft lifecycle
   * (e.g., the user can navigate to `/fields/$id` from the dashboard
   * without ever opening `/fields/new`).
   */
  clearDraft: () => void;
  setCurrentField: (id: string | null) => void;
};

export type FieldStore = FieldStoreState & FieldStoreActions;

const INITIAL_STATE: FieldStoreState = {
  draftPolygon: null,
  draftAreaHectares: null,
  draftValid: false,
  draftErrors: [],
  currentFieldId: null,
};

export const useFieldStore = create<FieldStore>()((set) => ({
  ...INITIAL_STATE,
  setDraftPolygon: (polygon) => {
    if (polygon === null) {
      set({
        draftPolygon: null,
        draftAreaHectares: null,
        draftValid: false,
        draftErrors: [],
      });
      return;
    }
    set({ draftPolygon: polygon });
  },
  setDraftValidation: ({ areaHectares, valid, errors }) =>
    set({
      draftAreaHectares: areaHectares,
      draftValid: valid,
      draftErrors: errors,
    }),
  setDraftGeometry: ({ polygon, areaHectares, valid, errors }) =>
    set({
      draftPolygon: polygon,
      draftAreaHectares: areaHectares,
      draftValid: valid,
      draftErrors: errors,
    }),
  clearDraft: () =>
    set({
      draftPolygon: null,
      draftAreaHectares: null,
      draftValid: false,
      draftErrors: [],
    }),
  setCurrentField: (id) => set({ currentFieldId: id }),
}));
