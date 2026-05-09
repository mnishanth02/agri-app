import { z } from 'zod';

const optionalString = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}, z.string().min(1).optional());

const schema = z.object({
  VITE_API_BASE_URL: z.string().trim().url(),
  VITE_ESRI_API_KEY: optionalString,
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
