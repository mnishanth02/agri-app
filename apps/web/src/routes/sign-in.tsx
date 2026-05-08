import { useClerk } from '@clerk/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { AuthShell } from '@/components/auth/AuthShell';
import { OAuthButton } from '@/components/auth/OAuthButton';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { mapClerkError } from '@/lib/clerk-errors';

// --- Route config ---

const inAppPath = z.string().refine((v) => v.startsWith('/') && !v.startsWith('//'), {
  message: 'redirect must be an in-app path starting with `/`',
});

const signInSearchSchema = z.object({
  redirect: inAppPath.optional(),
});

export const Route = createFileRoute('/sign-in')({
  validateSearch: signInSearchSchema,
  beforeLoad: ({ context, search }) => {
    if (context.auth.isSignedIn) {
      throw redirect({ to: search.redirect ?? '/' });
    }
  },
  component: SignInPage,
});

// --- Form schema ---

const signInSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean(),
});

type SignInValues = z.infer<typeof signInSchema>;

// --- Page ---

function SignInPage() {
  const search = Route.useSearch();
  const clerk = useClerk();
  const navigate = useNavigate();
  const [loading, setLoading] = React.useState(false);

  const savedEmail =
    typeof window !== 'undefined' ? (localStorage.getItem('viz:lastEmail') ?? '') : '';

  const form = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: {
      email: savedEmail,
      password: '',
      rememberMe: !!savedEmail,
    },
  });

  const onSubmit = async (values: SignInValues) => {
    setLoading(true);

    try {
      const result = await clerk.client.signIn.create({
        identifier: values.email,
        password: values.password,
      });

      if (result.status === 'complete') {
        if (values.rememberMe) {
          localStorage.setItem('viz:lastEmail', values.email);
        } else {
          localStorage.removeItem('viz:lastEmail');
        }

        await clerk.setActive({ session: result.createdSessionId });
        void navigate({ to: search.redirect ?? '/' });
        return;
      }

      form.setError('root', {
        message: `Sign-in returned status "${result.status}". Please try again or contact support.`,
      });
    } catch (err) {
      mapClerkError(err, form.setError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      heading="Welcome back"
      subheading="Sign in to your account to continue"
      tagline="Monitor your fields with confidence"
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input placeholder="you@example.com" autoComplete="email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between">
                  <FormLabel>Password</FormLabel>
                  <Link
                    to="/forgot-password"
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Forgot password?
                  </Link>
                </div>
                <FormControl>
                  <PasswordInput
                    placeholder="••••••••"
                    autoComplete="current-password"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="rememberMe"
            render={({ field }) => (
              <FormItem>
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={field.value}
                    onChange={field.onChange}
                    className="size-4 rounded border-input accent-primary"
                  />
                  <span className="text-muted-foreground">Remember me</span>
                </label>
              </FormItem>
            )}
          />

          {form.formState.errors.root && (
            <p className="text-sm text-destructive">{form.formState.errors.root.message}</p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            Sign in
          </Button>
        </form>
      </Form>

      {/* Divider */}
      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
        </div>
      </div>

      {/* OAuth */}
      <OAuthButton redirectUrlComplete={search.redirect ?? '/'} />

      {/* Footer */}
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{' '}
        <Link to="/sign-up" className="font-medium text-foreground hover:underline">
          Sign up
        </Link>
      </p>
    </AuthShell>
  );
}
