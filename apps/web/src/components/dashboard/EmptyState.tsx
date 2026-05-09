import { Link } from '@tanstack/react-router';
import { PlusIcon, SproutIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Dashboard empty state. Shown by `/_auth/` when the signed-in user has no
 * fields yet (per `docs/plan.md` §3 line 49 — "large 'Add your first plot'
 * panel with a `+` button → `/fields/new`").
 *
 * Intentionally bare of imagery in Phase 1; Phase 2 may add an illustration.
 */
export function EmptyState() {
  return (
    <section
      data-slot="dashboard-empty-state"
      className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center"
    >
      <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
        <SproutIcon className="size-8" aria-hidden="true" />
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Add your first plot</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Draw a polygon over your field on the map and we will pull in satellite imagery and crop
          health metrics.
        </p>
      </div>

      <Button asChild size="lg" className="mt-2">
        <Link to="/fields/new">
          <PlusIcon className="size-4" aria-hidden="true" />
          Add field
        </Link>
      </Button>
    </section>
  );
}
