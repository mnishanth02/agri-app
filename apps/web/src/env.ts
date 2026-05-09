import { z } from 'zod';

const ESRI_KEY_REQUIRED =
  'VITE_ESRI_API_KEY is required (Module 2.1) — get an API key from https://developers.arcgis.com and scope it to Basemaps.';

const requiredEsriKey = z.preprocess(
  (value) => (typeof value === 'string' ? value : ''),
  z.string().trim().min(1, ESRI_KEY_REQUIRED),
);

const schema = z.object({
  VITE_API_BASE_URL: z.string().trim().url(),
  VITE_ESRI_API_KEY: requiredEsriKey,
  VITE_CLERK_PUBLISHABLE_KEY: z
    .string()
    .trim()
    .min(1, 'VITE_CLERK_PUBLISHABLE_KEY is required (Module 0.8)')
    .regex(/^pk_(test|live)_/, 'VITE_CLERK_PUBLISHABLE_KEY must start with pk_test_ or pk_live_'),
});

export type WebEnv = z.infer<typeof schema>;

const parsed = schema.safeParse(import.meta.env);

if (!parsed.success) {
  console.error('Invalid web env:', z.treeifyError(parsed.error));
  throw new Error('Invalid web env. See VITE_* variables in apps/web/.env.example.');
}

export const env: WebEnv = parsed.data;
