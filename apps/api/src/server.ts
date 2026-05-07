import sensible from '@fastify/sensible';
import Fastify from 'fastify';

import { env } from './env.js';
import { registerCors } from './plugins/cors.js';
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
  await app.register(healthRoutes, { prefix: '/api' });

  return app;
}

async function main(): Promise<void> {
  const app = await buildServer();
  try {
    const address = await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info(`viz-crop api listening at ${address}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
