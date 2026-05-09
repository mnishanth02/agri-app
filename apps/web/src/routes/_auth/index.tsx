import { createFileRoute } from '@tanstack/react-router';
import { useFieldList } from '@/hooks/useFields';
import { ApiError } from '@/lib/api';

export const Route = createFileRoute('/_auth/')({
  component: Dashboard,
});

/**
 * Module 1.7 scratch dashboard — proves `useFieldList()` round-trips a real
 * authenticated request through `apiFetch` → Fastify → PostGIS and renders
 * the user's fields. Module 1.8 will replace this with the real dashboard
 * (EmptyState / FieldList / FieldCard).
 */
function Dashboard() {
  const { data, isLoading, isError, error } = useFieldList();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Your fields</h1>
        <p className="text-sm text-muted-foreground">
          Scratch dashboard for Module 1.7 — full UI ships in Module 1.8.
        </p>
      </header>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading fields…</p> : null}

      {isError ? (
        <section className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <p className="font-medium">Could not load fields.</p>
          <p className="mt-1 font-mono text-xs">
            {error instanceof ApiError
              ? `${error.status} ${error.statusText} — ${error.message}`
              : error.message}
          </p>
        </section>
      ) : null}

      {data && data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No fields yet. Add your first plot once Module 1.8 lands.
        </p>
      ) : null}

      {data && data.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
          {data.map((field) => (
            <li key={field.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div className="flex flex-col">
                <span className="font-medium">{field.name}</span>
                <span className="text-xs text-muted-foreground">
                  {field.cropType} · {field.season}
                </span>
              </div>
              <span className="font-mono text-xs text-muted-foreground">
                {field.areaHectares !== null ? `${field.areaHectares.toFixed(2)} ha` : '— ha'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
