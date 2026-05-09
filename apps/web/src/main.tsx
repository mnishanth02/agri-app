import { ClerkLoaded, ClerkLoading, ClerkProvider, useAuth } from '@clerk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { env } from './env';
import { routeTree } from './routeTree.gen';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

const router = createRouter({
  routeTree,
  context: {
    queryClient,
    // `auth` is injected at render time by <InnerApp /> via RouterProvider's
    // `context` prop. The non-null assertion is the documented pattern from
    // TanStack Router for context provided at render time — <ClerkLoaded>
    // gates the RouterProvider mount so by the time any beforeLoad runs,
    // `auth` will always be a real object.
    // biome-ignore lint/style/noNonNullAssertion: placeholder for render-time injection (see comment above)
    auth: undefined!,
  },
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found in index.html.');
}

function InnerApp() {
  const auth = useAuth();

  // When Clerk's auth state changes (sign-in, sign-out, token refresh), invalidate
  // the router so `_auth/route.tsx` `beforeLoad` re-evaluates the redirect rules.
  // `authKey` is a sentinel: the effect body intentionally doesn't read it — its
  // only purpose is to make this effect re-run when isLoaded/isSignedIn flip.
  const authKey = `${auth.isLoaded}:${auth.isSignedIn ?? 'unknown'}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: authKey is the sentinel that triggers invalidation; removing it would only run on mount
  useEffect(() => {
    void router.invalidate();
  }, [authKey]);

  return <RouterProvider router={router} context={{ queryClient, auth }} />;
}

createRoot(rootEl).render(
  <StrictMode>
    <ClerkProvider
      publishableKey={env.VITE_CLERK_PUBLISHABLE_KEY}
      afterSignOutUrl="/sign-in"
      // Route Clerk's internal navigations (post sign-out, OAuth callback,
      // user-profile links, etc.) through TanStack Router instead of letting
      // Clerk fall back to `window.location.href`. Without these, sign-out
      // triggers a hard page reload which causes a brief <ClerkLoading>
      // "Loading…" flash and a perceived double redirect to /sign-in.
      // Both `routerPush` and `routerReplace` must be provided together.
      routerPush={(to) => router.history.push(to)}
      routerReplace={(to) => router.history.replace(to)}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkLoading>
          <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        </ClerkLoading>
        <ClerkLoaded>
          <InnerApp />
        </ClerkLoaded>
      </QueryClientProvider>
    </ClerkProvider>
  </StrictMode>,
);
