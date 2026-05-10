/**
 * Module 3.1 — manual smoke artifact for the Zustand stores.
 *
 * **NOT MOUNTED IN ANY ROUTE.** This component exists purely so a developer
 * can drop `<StoreScratch />` into a temporary route to verify by eye that:
 *
 * 1. Selectors return the expected slices from each store.
 * 2. Updating an unrelated slice does **not** re-render a consumer that
 *    selected a different slice (`console.count` will not increment).
 * 3. Multi-value selectors wrapped in `useShallow` only re-render when at
 *    least one of the picked values changes.
 *
 * To use:
 *
 * ```tsx
 * // (temporary) some route file
 * import { StoreScratch } from '@/stores/__scratch__/StoreScratch';
 * export const Route = createFileRoute('/_dev/store-scratch')({
 *   component: StoreScratch,
 * });
 * ```
 *
 * Open the page, click the buttons, watch the dev console. Each row's render
 * counter should only increment when its own slice changes. Remove the
 * temporary route afterwards — this file should never ship in a route.
 *
 * A non-React runtime check using `useFieldStore.subscribe` with a manual
 * equality function lives next to this file (`verify.mts`). That exercises
 * the same primitive (`equalityFn` + selector) that
 * `useSyncExternalStoreWithSelector` uses under the hood, so passing it is a
 * strong indicator that the React selectors will isolate correctly too.
 */

import { useShallow } from 'zustand/react/shallow';
import { useFieldStore } from '@/stores/useFieldStore';
import { useUiStore } from '@/stores/useUiStore';

const DEMO_POLYGON: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [77.5, 12.9],
      [77.6, 12.9],
      [77.6, 13.0],
      [77.5, 13.0],
      [77.5, 12.9],
    ],
  ],
};

function DraftValidRow() {
  // Single primitive — referential equality is fine, no useShallow needed.
  const draftValid = useFieldStore((s) => s.draftValid);
  console.count('[scratch] DraftValidRow render');
  return <span>draftValid: {String(draftValid)}</span>;
}

function DraftSliceRow() {
  // Multiple values — wrap in useShallow so we re-render only when one of
  // these three actually changes (not on every unrelated store update).
  const { draftPolygon, draftValid, draftAreaHectares } = useFieldStore(
    useShallow((s) => ({
      draftPolygon: s.draftPolygon,
      draftValid: s.draftValid,
      draftAreaHectares: s.draftAreaHectares,
    })),
  );
  console.count('[scratch] DraftSliceRow render');
  return (
    <span>
      polygon: {draftPolygon ? 'set' : 'null'} · valid: {String(draftValid)} · area:{' '}
      {draftAreaHectares ?? 'null'}
    </span>
  );
}

function CurrentFieldRow() {
  const currentFieldId = useFieldStore((s) => s.currentFieldId);
  console.count('[scratch] CurrentFieldRow render');
  return <span>currentFieldId: {currentFieldId ?? 'null'}</span>;
}

function SelectedIndexRow() {
  const selectedIndex = useUiStore((s) => s.selectedIndex);
  console.count('[scratch] SelectedIndexRow render');
  return <span>selectedIndex: {selectedIndex}</span>;
}

function NdviOpacityRow() {
  const ndviOpacity = useUiStore((s) => s.ndviOpacity);
  console.count('[scratch] NdviOpacityRow render');
  return <span>ndviOpacity: {ndviOpacity}</span>;
}

export function StoreScratch() {
  const setDraftPolygon = useFieldStore((s) => s.setDraftPolygon);
  const setDraftValidation = useFieldStore((s) => s.setDraftValidation);
  const clearDraft = useFieldStore((s) => s.clearDraft);
  const setCurrentField = useFieldStore((s) => s.setCurrentField);
  const setSelectedIndex = useUiStore((s) => s.setSelectedIndex);
  const setNdviOpacity = useUiStore((s) => s.setNdviOpacity);

  return (
    <div style={{ padding: 16, fontFamily: 'monospace', display: 'grid', gap: 8 }}>
      <h2>Module 3.1 store scratch</h2>
      <DraftValidRow />
      <DraftSliceRow />
      <CurrentFieldRow />
      <SelectedIndexRow />
      <NdviOpacityRow />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        <button type="button" onClick={() => setDraftPolygon(DEMO_POLYGON)}>
          set draft polygon
        </button>
        <button
          type="button"
          onClick={() => setDraftValidation({ areaHectares: 12.34, valid: true, errors: [] })}
        >
          mark draft valid
        </button>
        <button
          type="button"
          onClick={() =>
            setDraftValidation({
              areaHectares: 0.05,
              valid: false,
              errors: ['too small'],
            })
          }
        >
          mark draft invalid
        </button>
        <button type="button" onClick={() => clearDraft()}>
          clear draft
        </button>
        <button type="button" onClick={() => setCurrentField(crypto.randomUUID())}>
          set currentFieldId (should NOT re-render draft rows)
        </button>
        <button type="button" onClick={() => setSelectedIndex('EVI')}>
          selectedIndex → EVI
        </button>
        <button type="button" onClick={() => setNdviOpacity(Math.random())}>
          random ndviOpacity (should NOT re-render selectedIndex row)
        </button>
      </div>
    </div>
  );
}
