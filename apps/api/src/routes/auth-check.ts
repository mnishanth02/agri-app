import { getAuth } from '@clerk/fastify';
import type { FastifyInstance } from 'fastify';

import { requireUser } from '../plugins/auth.js';

// TODO Phase 1 (Module 1.6): remove `/api/_auth-check` once `/api/fields` exists
// and exercises the auth wall via real business routes.
export async function authCheckRoutes(app: FastifyInstance): Promise<void> {
  app.get('/_auth-check', { preHandler: requireUser }, async (request) => {
    const { userId } = getAuth(request);
    return { userId };
  });
}
