import fastifyCors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

import { allowedOrigins } from '../env.js';

export async function registerCors(app: FastifyInstance): Promise<void> {
  await app.register(fastifyCors, {
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
}
