import { env } from '@/env';

export interface ApiErrorPayload {
  status: number;
  statusText: string;
  body: unknown;
  url: string;
}

export class ApiError extends Error implements ApiErrorPayload {
  status: number;
  statusText: string;
  body: unknown;
  url: string;

  constructor(message: string, payload: ApiErrorPayload) {
    super(message);
    this.name = 'ApiError';
    this.status = payload.status;
    this.statusText = payload.statusText;
    this.body = payload.body;
    this.url = payload.url;
  }
}

function buildUrl(path: string): string {
  const base = env.VITE_API_BASE_URL.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

// Minimal shape of the global Clerk instance we depend on. The full type lives in
// `@clerk/clerk-js`, but we only need `session.getToken()` here so we keep it local.
interface ClerkGlobal {
  session?: { getToken: (options?: { template?: string }) => Promise<string | null> } | null;
}

declare global {
  interface Window {
    Clerk?: ClerkGlobal;
  }
}

async function getAuthToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const session = window.Clerk?.session;
  if (!session) return null;
  try {
    return await session.getToken();
  } catch {
    return null;
  }
}

export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const url = buildUrl(path);
  const headers = new Headers(init?.headers);
  if (!headers.has('accept')) {
    headers.set('accept', 'application/json');
  }

  const token = await getAuthToken();
  if (token && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, { ...init, headers });

  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const serverMessage =
      parsed &&
      typeof parsed === 'object' &&
      'message' in parsed &&
      typeof parsed.message === 'string'
        ? parsed.message
        : null;
    const message = serverMessage
      ? `Request to ${url} failed with ${response.status}: ${serverMessage}`
      : `Request to ${url} failed with ${response.status} ${response.statusText}`;
    throw new ApiError(message, {
      status: response.status,
      statusText: response.statusText,
      body: parsed,
      url,
    });
  }

  return parsed as T;
}
