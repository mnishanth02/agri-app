import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/fields/$id')({
  component: FieldDetailPlaceholder,
});

function FieldDetailPlaceholder() {
  const { id } = Route.useParams();
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-center gap-2 px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">Field detail placeholder</h1>
      <p className="text-sm text-muted-foreground">
        Field id: <span className="font-mono text-xs">{id}</span>
      </p>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        Analysis screens land in Phase 5 — for now this route exists so the FieldCard "Open" link
        and the rename/delete flow round-trips work.
      </p>
    </div>
  );
}
