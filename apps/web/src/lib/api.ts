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

export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const url = buildUrl(path);
  const headers = new Headers(init?.headers);
  if (!headers.has('accept')) {
    headers.set('accept', 'application/json');
  }

  // TODO Module 0.8: inject Clerk JWT here as `Authorization: Bearer <token>`.

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
    throw new ApiError(`Request to ${url} failed with ${response.status} ${response.statusText}`, {
      status: response.status,
      statusText: response.statusText,
      body: parsed,
      url,
    });
  }

  return parsed as T;
}
