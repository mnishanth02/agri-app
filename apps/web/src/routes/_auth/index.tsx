import { createFileRoute, Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';

import { EmptyState } from '@/components/dashboard/EmptyState';
import { FieldList } from '@/components/dashboard/FieldList';
import { Button } from '@/components/ui/button';
import { useFieldList } from '@/hooks/useFields';
import { ApiError } from '@/lib/api';

export const Route = createFileRoute('/_auth/')({
  component: Dashboard,
});

/**
 * Dashboard — Module 1.8.
 *
 * Render priority (per plan-1.8.md rubber-duck pass, finding #6):
 *
 * 1. Initial load (no data, loading)        → skeleton grid
 * 2. Data exists, empty                      → EmptyState
 * 3. Data exists, populated                  → FieldList (always preferred
 *                                               over the error panel — a
 *                                               background refetch failure
 *                                               must NOT replace usable rows)
 * 4. No data, error                          → blocking error panel
 * 5. Data exists + background refetch error → list + small inline warning
 */
function Dashboard() {
  const { data, isLoading, isError, error, isFetching } = useFieldList();

  const hasData = data !== undefined;
  const isEmpty = hasData && data.length === 0;
  const showSkeleton = !hasData && isLoading;
  const showBlockingError = !hasData && isError;
  const showInlineErrorBadge = hasData && isError;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Your fields</h1>
          <p className="text-sm text-muted-foreground">
            Polygons you have drawn for satellite analysis.
          </p>
        </div>

        {hasData && data.length > 0 ? (
          <Button asChild>
            <Link to="/fields/new">
              <PlusIcon className="size-4" aria-hidden="true" />
              Add field
            </Link>
          </Button>
        ) : null}
      </header>

      {showInlineErrorBadge ? (
        <output className="rounded-md border border-amber-500/30 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-200">
          Could not refresh field list — showing the last successful load.
          {isFetching ? ' Retrying…' : null}
        </output>
      ) : null}

      {showSkeleton ? <DashboardSkeleton /> : null}

      {showBlockingError ? (
        <section className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <p className="font-medium">Could not load fields.</p>
          <p className="mt-1 font-mono text-xs">
            {error instanceof ApiError
              ? `${error.status} ${error.statusText} — ${error.message}`
              : error.message}
          </p>
        </section>
      ) : null}

      {hasData && isEmpty ? <EmptyState /> : null}

      {hasData && data.length > 0 ? <FieldList fields={data} /> : null}
    </div>
  );
}

/**
 * Three-card pulse placeholder shown during the first load. Inline rather
 * than a separate `Skeleton` primitive — only used here in Phase 1.
 */
function DashboardSkeleton() {
  return (
    <ul
      data-slot="dashboard-skeleton"
      aria-label="Loading fields"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      {[0, 1, 2].map((index) => (
        <li
          key={index}
          className="flex h-44 flex-col gap-3 rounded-xl border border-border bg-card p-6"
        >
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
          <div className="mt-auto h-3 w-1/2 animate-pulse rounded bg-muted" />
        </li>
      ))}
    </ul>
  );
}
