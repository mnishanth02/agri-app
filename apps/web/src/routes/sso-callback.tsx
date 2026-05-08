import { AuthenticateWithRedirectCallback } from '@clerk/react';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/sso-callback')({
  component: SsoCallbackPage,
});

function SsoCallbackPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="text-sm text-muted-foreground">Completing sign-in…</p>
      <AuthenticateWithRedirectCallback />
    </div>
  );
}
