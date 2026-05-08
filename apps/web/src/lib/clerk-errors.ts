import type { UseFormSetError } from 'react-hook-form';
import { toast } from 'sonner';

interface ClerkError {
  errors?: Array<{
    code: string;
    message: string;
    longMessage?: string;
    meta?: { paramName?: string };
  }>;
}

// Maps Clerk error codes to react-hook-form field names.
// Only codes triggered by our flows (email/password sign-in/up, Google OAuth, password reset).
const fieldMap: Record<string, string> = {
  form_identifier_not_found: 'email',
  form_identifier_exists: 'email',
  form_password_incorrect: 'password',
  form_password_pwned: 'password',
  form_password_length_too_short: 'password',
  form_password_not_strong_enough: 'password',
  form_code_incorrect: 'code',
  verification_failed: 'code',
  verification_expired: 'code',
};

/**
 * Route Clerk API errors to react-hook-form field errors where possible,
 * falling through to a toast for unknown errors.
 */
export function mapClerkError(
  err: unknown,
  // biome-ignore lint/suspicious/noExplicitAny: react-hook-form generic
  setError?: UseFormSetError<any>,
): void {
  const clerkErr = err as ClerkError;
  const errors = clerkErr?.errors;

  if (!errors?.length) {
    toast.error('Something went wrong. Please try again.');
    return;
  }

  let handled = false;

  for (const e of errors) {
    const fieldName = fieldMap[e.code] ?? e.meta?.paramName;
    if (fieldName && setError) {
      setError(fieldName, { message: e.longMessage ?? e.message });
      handled = true;
    }
  }

  if (!handled) {
    const firstError = errors[0];
    if (firstError) {
      toast.error(firstError.longMessage ?? firstError.message);
    }
  }
}

/**
 * Extract a human-readable message from a Clerk error, with a fallback.
 */
export function getClerkErrorMessage(err: unknown, fallback: string): string {
  const clerkErr = err as ClerkError;
  const first = clerkErr?.errors?.[0];
  return first?.longMessage ?? first?.message ?? fallback;
}
