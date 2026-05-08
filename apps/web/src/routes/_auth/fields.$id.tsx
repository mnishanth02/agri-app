import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/fields/$id')({
  component: FieldDetailPlaceholder,
});

function FieldDetailPlaceholder() {
  const { id } = Route.useParams();
  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="text-2xl font-semibold">Field detail placeholder: {id}</h1>
    </main>
  );
}
