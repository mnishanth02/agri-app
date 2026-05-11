import { UserButton } from '@clerk/react';
import { createFileRoute, Link, Outlet, redirect, useMatches } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth')({
  beforeLoad: ({ context, location }) => {
    if (!context.auth.isSignedIn) {
      throw redirect({
        to: '/sign-in',
        search: { redirect: location.href },
      });
    }
  },
  component: AuthLayout,
});

/**
 * Module 5.7 — `/fields/$id` is the only `_auth` child that opts out of the
 * global header so the analysis canvas can claim the full viewport (the
 * map otherwise loses 3.5 rem to a header that only repeats dashboard
 * data). Every other authed route still renders the brand + sign-out
 * menu. See `docs/ui-ux-redesign-v2.md` § 5.A.1.
 */
const HEADERLESS_ROUTE_IDS: ReadonlySet<string> = new Set(['/_auth/fields/$id']);

function AuthLayout() {
  const matches = useMatches();
  const isHeaderlessRoute = matches.some((m) => HEADERLESS_ROUTE_IDS.has(m.routeId));

  if (isHeaderlessRoute) {
    return <Outlet />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-6 text-primary"
              aria-hidden="true"
            >
              <title>viz-crop logo</title>
              <path d="M12 2a8 8 0 0 0-8 8c0 6 8 12 8 12s8-6 8-12a8 8 0 0 0-8-8z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span className="font-semibold tracking-tight">viz-crop</span>
          </Link>

          <UserButton
            appearance={{
              elements: {
                avatarBox: 'size-8',
              },
            }}
          />
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
