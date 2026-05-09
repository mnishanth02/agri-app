import { clerkPlugin } from '@clerk/fastify';
import sensible from '@fastify/sensible';
import Fastify from 'fastify';

import { env } from './env.js';
import { registerCors } from './plugins/cors.js';
import { dbPlugin } from './plugins/db.js';
import { fieldRoutes } from './routes/fields.js';
import { healthRoutes } from './routes/health.js';

const isDev = env.NODE_ENV === 'development';

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: isDev ? 'debug' : 'info',
      ...(isDev
        ? {
            transport: {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
            },
          }
        : {}),
    },
    disableRequestLogging: false,
  });

  await app.register(sensible);
  await registerCors(app);

  // Database first — routes registered later (including the auth-protected ones)
  // can rely on `app.db` for queries. The plugin closes the pg pool on app.close.
  await app.register(dbPlugin);

  // Register Clerk auth plugin globally so `getAuth(request)` works in any route.
  // The plugin attaches a request.auth object with isAuthenticated/userId/sessionId
  // based on the incoming Authorization: Bearer <jwt> header. Routes opt INTO
  // protection via `requireUser` preHandler — no route is auto-gated.
  await app.register(clerkPlugin, {
    secretKey: env.CLERK_SECRET_KEY,
  });

  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(fieldRoutes, { prefix: '/api' });

  return app;
}
