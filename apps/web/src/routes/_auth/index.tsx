import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { apiFetch } from '@/lib/api';

interface HealthResponse {
  ok: boolean;
}

export const Route = createFileRoute('/_auth/')({
  component: Dashboard,
});

function Dashboard() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/api/health'),
  });

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-3xl font-semibold">Dashboard placeholder</h1>
      <section className="rounded-md border border-border bg-card px-4 py-3 text-sm">
        {isLoading ? 'Checking API…' : null}
        {isError ? `API error: ${error instanceof Error ? error.message : 'unknown'}` : null}
        {data ? `API health → ok: ${data.ok ? 'true' : 'false'}` : null}
      </section>
    </main>
  );
}
