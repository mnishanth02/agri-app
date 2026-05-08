import { SignIn } from '@clerk/react';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';

// Constrain `redirect` to in-app absolute paths only. This is defense-in-depth: TanStack
// Router currently treats `to` as a typed route path so external URLs like
// `https://evil.com` won't actually exit the SPA, but we make the safety property explicit
// here so it survives future refactors. Rejects empty strings, protocol/host URLs, and
// protocol-relative `//host` paths.
const inAppPath = z.string().refine((v) => v.startsWith('/') && !v.startsWith('//'), {
  message: 'redirect must be an in-app path starting with `/`',
});

const signInSearchSchema = z.object({
  redirect: inAppPath.optional(),
});

export const Route = createFileRoute('/sign-in')({
  validateSearch: signInSearchSchema,
  beforeLoad: ({ context, search }) => {
    // If the user is already signed in, send them to the app (or back to where they came from).
    if (context.auth.isSignedIn) {
      throw redirect({ to: search.redirect ?? '/' });
    }
  },
  component: SignInPage,
});

function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <SignIn routing="hash" signUpUrl="/sign-in" />
    </main>
  );
}
