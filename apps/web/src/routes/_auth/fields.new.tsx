import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/fields/new')({
  component: NewFieldPlaceholder,
});

function NewFieldPlaceholder() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-center gap-2 px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">New field placeholder</h1>
      <p className="text-sm text-muted-foreground">
        The drawing tool lands in Phase 3 — for now this route exists so dashboard navigation works.
      </p>
    </div>
  );
}
