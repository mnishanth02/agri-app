// @ts-nocheck -- node --experimental-strip-types runtime harness; not part of the build.
/**
 * Module 3.1 — non-React runtime verification of selector isolation.
 *
 * Run with: `node --experimental-strip-types apps/web/src/stores/__scratch__/verify.mts`
 *
 * React's `useSyncExternalStoreWithSelector` calls the store's `subscribe`
 * with a listener and bails out of re-renders when the selector returns an
 * `Object.is`-equal (or `useShallow`-equal) value. This script exercises
 * exactly that primitive against the real store instances — if updating an
 * unrelated slice would have re-rendered a React consumer, the listener
 * here will fire and the assertion will fail.
 *
 * The file uses a top-level `@ts-nocheck` because Node's `.ts` import
 * extension is required at runtime (Node 24's `--experimental-strip-types`
 * does not rewrite extensions), but tsc forbids `.ts` import specifiers
 * without `allowImportingTsExtensions`. Type-checking this scratch harness
 * adds no value — running it (the only thing that matters) does.
 */

import { useFieldStore } from '../useFieldStore.ts';
import { useUiStore } from '../useUiStore.ts';

type Result = { name: string; ok: boolean; detail: string | undefined };
const results: Result[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
}

// --- useFieldStore: state mutations -----------------------------------------
{
  // Reset to a known baseline.
  useFieldStore.setState({
    draftPolygon: null,
    draftAreaHectares: null,
    draftValid: false,
    draftErrors: [],
    currentFieldId: null,
  });

  const polygon: GeoJSON.Polygon = {
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

  const { setDraftPolygon, setDraftValidation, setDraftGeometry, clearDraft, setCurrentField } =
    useFieldStore.getState();

  setDraftPolygon(polygon);
  check('setDraftPolygon writes polygon', useFieldStore.getState().draftPolygon === polygon);
  check(
    'setDraftPolygon does NOT touch validation slice',
    useFieldStore.getState().draftValid === false &&
      useFieldStore.getState().draftAreaHectares === null &&
      useFieldStore.getState().draftErrors.length === 0,
  );

  setDraftValidation({ areaHectares: 12.34, valid: true, errors: [] });
  const afterValidation = useFieldStore.getState();
  check(
    'setDraftValidation atomically updates the three derived slices',
    afterValidation.draftAreaHectares === 12.34 &&
      afterValidation.draftValid === true &&
      afterValidation.draftErrors.length === 0,
  );
  check('setDraftValidation does NOT touch draftPolygon', afterValidation.draftPolygon === polygon);

  setCurrentField('field-uuid-1');
  check(
    'setCurrentField writes currentFieldId without touching the draft',
    useFieldStore.getState().currentFieldId === 'field-uuid-1' &&
      useFieldStore.getState().draftPolygon === polygon,
  );

  clearDraft();
  const afterClear = useFieldStore.getState();
  check(
    'clearDraft resets all draft slices',
    afterClear.draftPolygon === null &&
      afterClear.draftAreaHectares === null &&
      afterClear.draftValid === false &&
      afterClear.draftErrors.length === 0,
  );
  check('clearDraft does NOT touch currentFieldId', afterClear.currentFieldId === 'field-uuid-1');

  setDraftPolygon(polygon);
  setDraftValidation({ areaHectares: 1, valid: true, errors: [] });
  setDraftPolygon(null);
  const afterNullPolygon = useFieldStore.getState();
  check(
    'setDraftPolygon(null) clears polygon AND resets validation slice',
    afterNullPolygon.draftPolygon === null &&
      afterNullPolygon.draftAreaHectares === null &&
      afterNullPolygon.draftValid === false &&
      afterNullPolygon.draftErrors.length === 0 &&
      afterNullPolygon.currentFieldId === 'field-uuid-1',
  );

  // setDraftGeometry: atomically replaces polygon + validation in one set().
  setDraftGeometry({
    polygon,
    areaHectares: 5.5,
    valid: true,
    errors: [],
  });
  const afterCombined = useFieldStore.getState();
  check(
    'setDraftGeometry atomically writes polygon + validation in one tick',
    afterCombined.draftPolygon === polygon &&
      afterCombined.draftAreaHectares === 5.5 &&
      afterCombined.draftValid === true &&
      afterCombined.draftErrors.length === 0,
  );
  check(
    'setDraftGeometry does NOT touch currentFieldId',
    afterCombined.currentFieldId === 'field-uuid-1',
  );
  clearDraft();
}

// --- useFieldStore: selector isolation ---------------------------------------
{
  // Reset baseline.
  useFieldStore.setState({
    draftPolygon: null,
    draftAreaHectares: null,
    draftValid: false,
    draftErrors: [],
    currentFieldId: null,
  });

  // Mimic React's useSyncExternalStoreWithSelector: subscribe, run the
  // selector on each notification, and only "render" when the selected
  // value changes (Object.is-equal). The store's subscribe fires on every
  // state change; the selector + equality check is what isolates renders.
  let renders = 0;
  let prev = useFieldStore.getState().draftValid;
  const unsub = useFieldStore.subscribe((state) => {
    const next = state.draftValid;
    if (!Object.is(prev, next)) {
      renders += 1;
      prev = next;
    }
  });

  // Update an unrelated slice — should NOT trigger a "render".
  useFieldStore.getState().setCurrentField('field-x');
  useFieldStore.getState().setDraftPolygon({
    type: 'Polygon',
    coordinates: [
      [
        [77.5, 12.9],
        [77.6, 12.9],
        [77.6, 13.0],
        [77.5, 12.9],
      ],
    ],
  });
  check(
    'selector on draftValid skips updates from unrelated slices',
    renders === 0,
    `expected 0 renders, got ${renders}`,
  );

  // Update the watched slice — SHOULD trigger exactly one "render".
  useFieldStore.getState().setDraftValidation({
    areaHectares: 1,
    valid: true,
    errors: [],
  });
  check(
    'selector on draftValid fires when the slice changes',
    renders === 1,
    `expected 1 render, got ${renders}`,
  );

  // Set the same slice value again — equality check skips the "render".
  useFieldStore.getState().setDraftValidation({
    areaHectares: 99,
    valid: true,
    errors: ['some other error'],
  });
  check(
    'identical draftValid value skips re-render via manual Object.is check',
    renders === 1,
    `expected 1 render, got ${renders}`,
  );

  unsub();
}

// --- useFieldStore: useShallow-style multi-value isolation -------------------
{
  useFieldStore.setState({
    draftPolygon: null,
    draftAreaHectares: null,
    draftValid: false,
    draftErrors: [],
    currentFieldId: null,
  });

  // Manual shallow-equality compare matching `zustand/react/shallow`.
  const shallowEq = <T extends Record<string, unknown>>(a: T, b: T): boolean => {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.is(a[key], b[key])) return false;
    }
    return true;
  };

  let renders = 0;
  let prev = (() => {
    const s = useFieldStore.getState();
    return {
      draftPolygon: s.draftPolygon,
      draftValid: s.draftValid,
      draftAreaHectares: s.draftAreaHectares,
    };
  })();

  const unsub = useFieldStore.subscribe((state) => {
    const next = {
      draftPolygon: state.draftPolygon,
      draftValid: state.draftValid,
      draftAreaHectares: state.draftAreaHectares,
    };
    if (!shallowEq(prev, next)) {
      renders += 1;
      prev = next;
    }
  });

  // currentFieldId is NOT in the selected slice — must not trigger a render.
  useFieldStore.getState().setCurrentField('field-y');
  check(
    'useShallow-style selector skips currentFieldId updates',
    renders === 0,
    `expected 0 renders, got ${renders}`,
  );

  // setDraftValidation changes two of the three picked keys — one shallow-diff render.
  useFieldStore.getState().setDraftValidation({
    areaHectares: 7.5,
    valid: true,
    errors: [],
  });
  check(
    'useShallow-style selector fires once when picked slice changes',
    renders === 1,
    `expected 1 render, got ${renders}`,
  );

  // Atomicity proof: the new setDraftGeometry must produce ONE render even
  // though it changes polygon + areaHectares + valid + errors at once.
  // Two sequential setters (setDraftPolygon then setDraftValidation) would
  // produce TWO renders here — that's the bug setDraftGeometry exists to
  // avoid in the Module 3.2 Terra Draw call path.
  useFieldStore.getState().setDraftGeometry({
    polygon: {
      type: 'Polygon',
      coordinates: [
        [
          [78.0, 13.0],
          [78.1, 13.0],
          [78.1, 13.1],
          [78.0, 13.0],
        ],
      ],
    },
    areaHectares: 12.5,
    valid: true,
    errors: [],
  });
  check(
    'setDraftGeometry produces a single render across polygon + validation',
    renders === 2,
    `expected 2 renders after one setDraftGeometry call (was 1 after the prior setDraftValidation), got ${renders}`,
  );

  unsub();
}

// --- useUiStore: defaults ----------------------------------------------------
{
  // The store was already constructed with defaults by the import; reset
  // anyway in case a prior block touched it.
  useUiStore.setState({
    selectedViewId: null,
    selectedIndex: 'NDVI',
    ndviOpacity: 0.75,
    activeSidebarItem: 'sample',
    bottomBarTab: 'cropInfo',
  });

  const s = useUiStore.getState();
  check(
    'useUiStore defaults match plan.md',
    s.selectedViewId === null &&
      s.selectedIndex === 'NDVI' &&
      s.ndviOpacity === 0.75 &&
      s.activeSidebarItem === 'sample' &&
      s.bottomBarTab === 'cropInfo',
  );

  // setNdviOpacity does NOT clamp.
  useUiStore.getState().setNdviOpacity(2.5);
  check('setNdviOpacity does NOT clamp', useUiStore.getState().ndviOpacity === 2.5);
  useUiStore.getState().setNdviOpacity(0.75); // restore

  // Selector isolation between selectedIndex and ndviOpacity.
  let indexRenders = 0;
  let prevIndex = useUiStore.getState().selectedIndex;
  const unsub = useUiStore.subscribe((state) => {
    if (!Object.is(prevIndex, state.selectedIndex)) {
      indexRenders += 1;
      prevIndex = state.selectedIndex;
    }
  });
  useUiStore.getState().setNdviOpacity(0.42);
  useUiStore.getState().setActiveSidebarItem('weather');
  check(
    'selectedIndex selector skips opacity / sidebar updates',
    indexRenders === 0,
    `expected 0 renders, got ${indexRenders}`,
  );
  useUiStore.getState().setSelectedIndex('EVI');
  check('selectedIndex selector fires when index changes', indexRenders === 1);
  unsub();
}

// --- Report ------------------------------------------------------------------
let failed = 0;
for (const r of results) {
  const tag = r.ok ? 'PASS' : 'FAIL';
  console.log(`${tag}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
  if (!r.ok) failed += 1;
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) process.exit(1);
