import { useClerk } from '@clerk/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { AuthShell } from '@/components/auth/AuthShell';
import { OAuthButton } from '@/components/auth/OAuthButton';
import { OtpInput } from '@/components/auth/OtpInput';
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

const signUpSearchSchema = z.object({
  redirect: inAppPath.optional(),
});

export const Route = createFileRoute('/sign-up')({
  validateSearch: signUpSearchSchema,
  beforeLoad: ({ context, search }) => {
    if (context.auth.isSignedIn) {
      throw redirect({ to: search.redirect ?? '/' });
    }
  },
  component: SignUpPage,
});

// --- Form schemas ---

const credentialsSchema = z
  .object({
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    email: z.string().min(1, 'Email is required').email('Enter a valid email'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Confirm your password'),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type CredentialsValues = z.infer<typeof credentialsSchema>;

// --- Page ---

function SignUpPage() {
  const search = Route.useSearch();
  const clerk = useClerk();
  const navigate = useNavigate();
  const [step, setStep] = React.useState<'credentials' | 'verify'>('credentials');
  const [loading, setLoading] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [verifyError, setVerifyError] = React.useState('');

  const form = useForm<CredentialsValues>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  });

  const onCredentialsSubmit = async (values: CredentialsValues) => {
    setLoading(true);

    try {
      const signUpAttempt = await clerk.client.signUp.create({
        firstName: values.firstName,
        lastName: values.lastName,
        emailAddress: values.email,
        password: values.password,
      });

      await signUpAttempt.prepareEmailAddressVerification({ strategy: 'email_code' });
      setStep('verify');
    } catch (err) {
      const clerkErr = err as {
        errors?: Array<{ code?: string; message?: string; longMessage?: string }>;
      };
      const code = clerkErr?.errors?.[0]?.code;

      if (code === 'form_identifier_exists') {
        form.setError('email', {
          message: 'An account with this email already exists. Try signing in instead.',
        });
        setLoading(false);
        return;
      }

      mapClerkError(err, form.setError);
    } finally {
      setLoading(false);
    }
  };

  const onVerify = async () => {
    setLoading(true);
    setVerifyError('');

    try {
      // Guard: if signUp is gone (e.g. cookie cleared), restart the flow
      if (!clerk.client.signUp.id) {
        setVerifyError('Your sign-up session expired. Please re-enter your details.');
        setStep('credentials');
        setLoading(false);
        return;
      }

      const result = await clerk.client.signUp.attemptEmailAddressVerification({ code });

      if (result.status === 'complete') {
        await clerk.setActive({ session: result.createdSessionId });
        void navigate({ to: search.redirect ?? '/' });
      }
    } catch (err) {
      const clerkErr = err as { errors?: Array<{ message: string }> };
      setVerifyError(clerkErr?.errors?.[0]?.message ?? 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const onResend = async () => {
    try {
      if (!clerk.client.signUp.id) {
        setVerifyError('Your sign-up session expired. Please re-enter your details.');
        setStep('credentials');
        return;
      }
      await clerk.client.signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
    } catch {
      // silently fail — user can retry
    }
  };

  return (
    <AuthShell
      heading={step === 'credentials' ? 'Create an account' : 'Verify your email'}
      subheading={
        step === 'credentials'
          ? 'Start mapping your fields in minutes'
          : `We sent a 6-digit code to ${form.getValues('email')}`
      }
      tagline="Start mapping your first field in minutes"
    >
      {step === 'credentials' && (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onCredentialsSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First name</FormLabel>
                      <FormControl>
                        <Input placeholder="John" autoComplete="given-name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last name</FormLabel>
                      <FormControl>
                        <Input placeholder="Doe" autoComplete="family-name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

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
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <PasswordInput
                        placeholder="••••••••"
                        autoComplete="new-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm password</FormLabel>
                    <FormControl>
                      <PasswordInput
                        placeholder="••••••••"
                        autoComplete="new-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="size-4 animate-spin" />}
                Create account
              </Button>

              {form.formState.errors.root && (
                <p className="text-sm text-destructive">{form.formState.errors.root.message}</p>
              )}

              {/* Clerk Smart CAPTCHA mount point (required by Clerk for custom sign-up flows) */}
              {/* biome-ignore lint/correctness/useUniqueElementIds: Clerk requires this literal id */}
              <div id="clerk-captcha" />
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

          <OAuthButton redirectUrlComplete={search.redirect ?? '/'} />

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link to="/sign-in" className="font-medium text-foreground hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      )}

      {step === 'verify' && (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
          <div className="space-y-4">
            <OtpInput value={code} onChange={setCode} onResend={onResend} disabled={loading} />

            {verifyError && <p className="text-sm text-destructive">{verifyError}</p>}

            <Button
              type="button"
              className="w-full"
              disabled={loading || code.length < 6}
              onClick={onVerify}
            >
              {loading && <Loader2 className="size-4 animate-spin" />}
              Verify email
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => setStep('credentials')}
            >
              Back
            </Button>
          </div>
        </div>
      )}
    </AuthShell>
  );
}
