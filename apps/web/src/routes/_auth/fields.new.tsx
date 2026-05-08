import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/fields/new')({
  component: NewFieldPlaceholder,
});

function NewFieldPlaceholder() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="text-2xl font-semibold">New field placeholder</h1>
    </main>
  );
}
