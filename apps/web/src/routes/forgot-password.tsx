import { useClerk } from '@clerk/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { AuthShell } from '@/components/auth/AuthShell';
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
export const Route = createFileRoute('/forgot-password')({
  beforeLoad: ({ context }) => {
    if (context.auth.isSignedIn) {
      throw redirect({ to: '/' });
    }
  },
  component: ForgotPasswordPage,
});

// --- Schemas ---

const requestSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email'),
});

type RequestValues = z.infer<typeof requestSchema>;

const resetSchema = z
  .object({
    code: z.string().min(6, 'Enter the 6-digit code'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Confirm your password'),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type ResetValues = z.infer<typeof resetSchema>;

// --- Page ---

function ForgotPasswordPage() {
  const clerk = useClerk();
  const navigate = useNavigate();
  const [step, setStep] = React.useState<'request' | 'reset'>('request');
  const [loading, setLoading] = React.useState(false);

  // Step 1: request code
  const requestForm = useForm<RequestValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: { email: '' },
  });

  const onRequest = async (values: RequestValues) => {
    setLoading(true);

    try {
      await clerk.client.signIn.create({
        strategy: 'reset_password_email_code',
        identifier: values.email,
      });
      setStep('reset');
    } catch (err) {
      mapClerkError(err, requestForm.setError);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: code + new password
  const resetForm = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { code: '', password: '', confirmPassword: '' },
  });

  const onReset = async (values: ResetValues) => {
    setLoading(true);

    try {
      const result = await clerk.client.signIn.attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code: values.code,
        password: values.password,
      });

      if (result.status === 'complete') {
        await clerk.setActive({ session: result.createdSessionId });
        void navigate({ to: '/' });
      }
    } catch (err) {
      mapClerkError(err, resetForm.setError);
    } finally {
      setLoading(false);
    }
  };

  const onResendCode = async () => {
    try {
      await clerk.client.signIn.create({
        strategy: 'reset_password_email_code',
        identifier: requestForm.getValues('email'),
      });
    } catch {
      // silently fail
    }
  };

  return (
    <AuthShell
      heading={step === 'request' ? 'Forgot password?' : 'Reset your password'}
      subheading={
        step === 'request'
          ? "No worries, we'll send you a reset code"
          : `Enter the code sent to ${requestForm.getValues('email')}`
      }
      tagline="Secure your account, protect your fields"
    >
      {step === 'request' && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
          <Form {...requestForm}>
            <form onSubmit={requestForm.handleSubmit(onRequest)} className="space-y-4">
              <FormField
                control={requestForm.control}
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

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="size-4 animate-spin" />}
                Send reset code
              </Button>
            </form>
          </Form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Remember your password?{' '}
            <Link to="/sign-in" className="font-medium text-foreground hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      )}

      {step === 'reset' && (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
          <Form {...resetForm}>
            <form onSubmit={resetForm.handleSubmit(onReset)} className="space-y-4">
              <FormField
                control={resetForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Verification code</FormLabel>
                    <FormControl>
                      <OtpInput
                        value={field.value}
                        onChange={field.onChange}
                        onResend={onResendCode}
                        disabled={loading}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={resetForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New password</FormLabel>
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
                control={resetForm.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm new password</FormLabel>
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
                Reset password
              </Button>

              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => setStep('request')}
              >
                Back
              </Button>
            </form>
          </Form>
        </div>
      )}
    </AuthShell>
  );
}
