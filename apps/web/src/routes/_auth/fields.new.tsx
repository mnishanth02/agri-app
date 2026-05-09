import { createFileRoute } from '@tanstack/react-router';

import { BasemapLayer } from '@/components/map/BasemapLayer';
import { MapView } from '@/components/map/MapView';
import { CreateLayout } from '@/layouts/CreateLayout';

const KARNATAKA_CENTER: [number, number] = [75.7139, 15.3173];
const KARNATAKA_ZOOM = 8;

export const Route = createFileRoute('/_auth/fields/new')({
  component: NewFieldPage,
});

function NewFieldPage() {
  return (
    <CreateLayout
      mapSlot={
        <MapView center={KARNATAKA_CENTER} zoom={KARNATAKA_ZOOM} className="h-full w-full">
          <BasemapLayer />
        </MapView>
      }
      formSlot={<NewFieldFormPlaceholder />}
    />
  );
}

function NewFieldFormPlaceholder() {
  return (
    <div className="flex flex-col gap-2 p-6">
      <h1 className="font-semibold text-xl tracking-tight">New field</h1>
      <p className="text-muted-foreground text-sm">
        The drawing tool and field-details form land in Phase 3 — for now this route renders the
        Karnataka basemap so the create flow can be navigated end-to-end.
      </p>
    </div>
  );
}
