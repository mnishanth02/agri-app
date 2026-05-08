import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/sign-in')({
  component: SignInPlaceholder,
});

function SignInPlaceholder() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="text-2xl font-semibold">Sign-in placeholder</h1>
    </main>
  );
}
