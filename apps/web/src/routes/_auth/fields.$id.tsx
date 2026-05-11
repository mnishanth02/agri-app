import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useField } from '@/hooks/useFields';
import { AnalysisLayout } from '@/layouts/AnalysisLayout';
import { ApiError } from '@/lib/api';

export const Route = createFileRoute('/_auth/fields/$id')({
  component: FieldDetailPage,
});

/**
 * Module 5.1 — `/fields/:id` route shell.
 *
 * Owns data fetching for a single field and dispatches to one of three
 * render states:
 *
 *   1. **Loading** (`isLoading`, no cached data): a subtle full-bleed
 *      skeleton sized to the same `100dvh` viewport as `<AnalysisLayout>`
 *      so the actual map mounts in place without any layout shift. (The
 *      `_auth` header is gated off on this route — see Module 5.7 in
 *      `docs/ui-ux-redesign-v2.md` § 5.A.)
 *   2. **404** (`error instanceof ApiError && error.status === 404`):
 *      redirect to `/`. The redirect runs from a `useEffect` rather than
 *      during render because TanStack Router's `useNavigate()` hook (like
 *      React Router's) cannot be called during the render phase — calling
 *      `navigate(...)` synchronously would either no-op or warn about a
 *      setState-during-render. The component returns `null` while the
 *      effect is queued so a flash of broken UI doesn't appear.
 *   3. **Other errors**: render an inline error panel (mirrors the
 *      dashboard's blocking-error pattern). We deliberately do **not**
 *      redirect on non-404 errors — the user would lose context for a
 *      recoverable failure.
 *   4. **Success**: render `<AnalysisLayout field={data} />`.
 */
function FieldDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useField(id);

  const is404 = isError && error instanceof ApiError && error.status === 404;

  useEffect(() => {
    if (is404) {
      // Surface why we're bouncing the user — without this they land on
      // the dashboard with no explanation. Sonner is mounted in the
      // root route so this works from any descendant.
      toast.error('Field not found', {
        description: 'It may have been deleted or the link is incorrect.',
      });
      void navigate({ to: '/' });
    }
  }, [is404, navigate]);

  if (is404) return null;

  if (isError) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-16 sm:px-6 lg:px-8">
        <section className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <p className="font-medium">Could not load field.</p>
          <p className="mt-1 font-mono text-xs">
            {error instanceof ApiError
              ? `${error.status} ${error.statusText} — ${error.message}`
              : error.message}
          </p>
        </section>
        <Button asChild variant="outline" className="self-start">
          <Link to="/">← Back to your fields</Link>
        </Button>
      </div>
    );
  }

  if (isLoading || !data) {
    return <FieldDetailSkeleton />;
  }

  return <AnalysisLayout field={data} />;
}

/**
 * Subtle skeleton matching `<AnalysisLayout>`'s viewport box so the map
 * mounts in place without layout shift. Background is `bg-black` to match
 * the eventual map canvas background — avoids a flash from light skeleton →
 * black void → satellite tiles. Three faint ghost rectangles trace where
 * the TopBar / RightSidebar / BottomDock shells will sit so the layout
 * mounts in roughly the same shape it will end up in. `motion-safe:` on
 * `animate-pulse` respects `prefers-reduced-motion`.
 */
function FieldDetailSkeleton() {
  return (
    <output
      aria-busy="true"
      aria-label="Loading field…"
      className="relative block h-dvh w-full overflow-hidden bg-black"
    >
      <span className="pointer-events-none absolute inset-0">
        <span className="absolute top-3 left-1/2 block h-9 w-64 -translate-x-1/2 rounded-md bg-white/5 motion-safe:animate-pulse" />
        <span className="absolute top-1/2 right-3 block h-40 w-12 -translate-y-1/2 rounded-md bg-white/5 motion-safe:animate-pulse" />
        <span className="absolute bottom-3 left-1/2 block h-12 w-72 -translate-x-1/2 rounded-md bg-white/5 motion-safe:animate-pulse" />
      </span>
    </output>
  );
}
