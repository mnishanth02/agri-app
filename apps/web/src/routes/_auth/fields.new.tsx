import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';

import { CreateFieldForm } from '@/components/forms/CreateFieldForm';
import { BasemapLayer } from '@/components/map/BasemapLayer';
import { DrawControl } from '@/components/map/DrawControl';
import { FieldLayer } from '@/components/map/FieldLayer';
import { MapView } from '@/components/map/MapView';
import { CreateLayout } from '@/layouts/CreateLayout';
import { useFieldStore } from '@/stores/useFieldStore';

const KARNATAKA_CENTER: [number, number] = [75.7139, 15.3173];
const KARNATAKA_ZOOM = 8;

export const Route = createFileRoute('/_auth/fields/new')({
  component: NewFieldPage,
});

// Module 3.6 wiring contract: form state lives inside <CreateFieldForm /> (RHF) and
// draft geometry lives in useFieldStore. The map column and form column communicate
// only through the Zustand store — no form values are ever passed as props into
// <MapView /> or its children, so keystrokes never re-render the map subtree.
function NewFieldPage() {
  // Clear any leftover draft when the user leaves /fields/new without submitting.
  // `useFieldDrawing` deliberately preserves the committed draft on its own
  // cleanup (so style-swap rebuilds don't wipe valid drafts mid-session), so the
  // ephemeral draft contract documented on `useFieldStore` is enforced here at
  // the route level — the only place that knows the user has actually left the
  // create flow. Successful submits already call `clearDraft()` themselves, so
  // this cleanup is a no-op in that path.
  const clearDraft = useFieldStore((s) => s.clearDraft);
  useEffect(() => {
    return () => {
      clearDraft();
    };
  }, [clearDraft]);

  return (
    <CreateLayout
      mapSlot={
        <MapView center={KARNATAKA_CENTER} zoom={KARNATAKA_ZOOM} className="h-full w-full">
          <BasemapLayer />
          <FieldLayer />
          <DrawControl />
        </MapView>
      }
      formSlot={<CreateFieldForm />}
    />
  );
}
