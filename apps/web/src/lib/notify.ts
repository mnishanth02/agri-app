/**
 * Module 8.1 — Single helper for surfacing **server**-side errors as Sonner
 * toasts.
 *
 * Every `useQuery` / `useMutation` `onError` site that talks to our API
 * should funnel through {@link notifyError} so the user sees consistent
 * copy regardless of which hook (or which component) actually triggered
 * the request. Centralising the mapping also means we have exactly one
 * place to extend when the API grows new sentinel error codes (Module 7
 * already ships `STATS_TIMEOUT` / `NO_SCENES_FOR_RANGE` /
 * `EOSDA_BUDGET_EXCEEDED`).
 *
 * UI-only validation toasts — the geometry-error messages emitted from
 * `useFieldDrawing` — intentionally **bypass** this helper. They are not
 * server errors, the copy is task-specific (e.g. "Polygon must have at
 * least 3 vertices"), and routing them through `notifyError` would make
 * the helper's contract muddier without any benefit.
 */

import { toast } from 'sonner';
import { ApiError } from '@/lib/api';

export interface NotifyErrorOptions {
  /** Title shown when the helper cannot infer one. Defaults to "Something went wrong". */
  fallback?: string;
  /** Optional override title. Wins over both the inferred title and `fallback`. */
  title?: string;
}

interface ResolvedToast {
  title: string;
  description: string;
}

const DEFAULT_FALLBACK = 'Something went wrong';

/** Pull the `{ error: string }` sentinel code out of an `ApiError.body`, if present. */
function readErrorCode(body: unknown): string | null {
  if (body && typeof body === 'object' && 'error' in body) {
    const code = (body as { error: unknown }).error;
    if (typeof code === 'string') return code;
  }
  return null;
}

function resolveApiError(err: ApiError, opts?: NotifyErrorOptions): ResolvedToast {
  const code = readErrorCode(err.body);
  switch (code) {
    case 'STATS_TIMEOUT':
      return {
        title: 'Statistics took too long',
        description: 'Please try again in a moment.',
      };
    case 'NO_SCENES_FOR_RANGE':
      return {
        title: 'No imagery available',
        description: 'No Sentinel-2 scenes for this date range.',
      };
    case 'EOSDA_BUDGET_EXCEEDED':
      return {
        title: 'Daily satellite quota reached',
        description: 'Please try again tomorrow.',
      };
  }

  switch (err.status) {
    case 401:
      return { title: 'Not signed in', description: 'Please sign in again.' };
    case 403:
      return {
        title: 'Not allowed',
        description: "You don't have permission for this action.",
      };
    case 404:
      return {
        title: 'Not found',
        description: 'The requested item no longer exists.',
      };
    case 429:
      return {
        title: 'Too many requests',
        description: 'Please slow down and try again shortly.',
      };
    case 502:
    case 503:
    case 504:
      return {
        title: 'Service temporarily unavailable',
        description: 'An upstream service is having trouble. Please try again.',
      };
    default:
      return {
        title: opts?.title ?? opts?.fallback ?? DEFAULT_FALLBACK,
        description: `${err.status} ${err.statusText}`,
      };
  }
}

/**
 * Show a Sonner error toast for an arbitrary thrown value, mapping known
 * server error shapes to friendlier copy. See file header for scope.
 */
export function notifyError(err: unknown, opts?: NotifyErrorOptions): void {
  let resolved: ResolvedToast;

  if (err instanceof ApiError) {
    resolved = resolveApiError(err, opts);
  } else if (err instanceof Error) {
    resolved = {
      title: opts?.title ?? opts?.fallback ?? DEFAULT_FALLBACK,
      description: err.message,
    };
  } else {
    resolved = {
      title: opts?.title ?? opts?.fallback ?? DEFAULT_FALLBACK,
      description: String(err),
    };
  }

  // An explicit `opts.title` always wins — it lets callers override the
  // mapped copy when they have more context (e.g., "Could not delete
  // field" instead of the generic 404 copy).
  const title = opts?.title ?? resolved.title;
  toast.error(title, { description: resolved.description });
}
