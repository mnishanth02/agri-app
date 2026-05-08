import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth')({
  component: AuthLayout,
});

function AuthLayout() {
  // TODO Module 0.8: gate with Clerk `useAuth()` and redirect to `/sign-in` when signed out.
  return <Outlet />;
}
