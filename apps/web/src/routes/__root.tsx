import type { useAuth } from '@clerk/react';
import type { QueryClient } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

export interface RouterContext {
  queryClient: QueryClient;
  auth: ReturnType<typeof useAuth>;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

function RootComponent() {
  // Single app-wide TooltipProvider. Radix requires every <Tooltip>
  // descendant to have a Provider somewhere above it in the React tree
  // — without this, any component that imports `Tooltip` and is
  // rendered outside one of the (now-removed) shell-local Providers
  // throws "`Tooltip` must be used within `TooltipProvider`" on its
  // first render. Mounting it at the root removes that footgun for
  // every future Tooltip caller.
  //
  // `delayDuration={300}` matches the value previously used by every
  // shell-local Provider (TopBar, RightSidebar, BottomBar's old impl,
  // MapOverlays) so the tooltip-open timing stays unchanged.
  return (
    <TooltipProvider delayDuration={300}>
      <Outlet />
      <Toaster richColors position="top-right" />
      {import.meta.env.DEV ? (
        <>
          <TanStackRouterDevtools position="bottom-right" />
          <ReactQueryDevtools buttonPosition="bottom-left" />
        </>
      ) : null}
    </TooltipProvider>
  );
}
