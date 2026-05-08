import { getAuth } from '@clerk/fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Fastify preHandler that requires a valid Clerk session.
 *
 * Use as `{ preHandler: requireUser }` on any route that should be gated.
 * Throws a 401 (via `@fastify/sensible` httpErrors) when the request has
 * no valid Clerk session token.
 */
export async function requireUser(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const { isAuthenticated, userId } = getAuth(request);
  if (!isAuthenticated || !userId) {
    throw request.server.httpErrors.unauthorized('Authentication required');
  }
}
