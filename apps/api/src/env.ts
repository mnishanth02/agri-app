import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  ALLOWED_ORIGINS: z
    .string()
    .min(1, 'ALLOWED_ORIGINS is required')
    .transform((raw, ctx) => {
      const origins = raw
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);
      if (origins.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'ALLOWED_ORIGINS must contain at least one non-empty origin',
        });
        return z.NEVER;
      }
      return origins;
    }),
  EOSDA_API_KEY: z.string().min(1, 'EOSDA_API_KEY is required (Module 4.1)'),
  CLERK_SECRET_KEY: z
    .string()
    .min(1, 'CLERK_SECRET_KEY is required (Module 0.8)')
    .regex(/^sk_(test|live)_/, 'CLERK_SECRET_KEY must start with sk_test_ or sk_live_'),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env: Env = parsed.data;

export const allowedOrigins: string[] = env.ALLOWED_ORIGINS;
