// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { getRequestIdentity } from '../identity/request.js';
import { UNRESTRICTED_ACCESS } from '../identity/service.js';

import type { FastifyInstance, FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** A non-GET route that only reads the Space it names. */
    spaceAccess?: 'read';
  }
}

type Fields = Record<string, unknown> | undefined;

const id = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

/**
 * Authorize every Space a request names before its route runs.
 *
 * The Space is the `canvasId` route parameter, query field or body field,
 * whichever is present first; a route that moves content between Spaces also
 * names the other one in its body. A conversation outside any Space belongs
 * to nobody, so only an owner may address one. The identity provider decides
 * each check. Unrestricted callers, the local owner and the machine
 * credential, skip the guard entirely, so local mode is unchanged.
 */
export function registerSpaceAccess(app: FastifyInstance): void {
  app.addHook('preHandler', async (request, reply) => {
    if (request.routeOptions.config?.identity === 'route-owned') return;
    const identity = getRequestIdentity(request);
    // Credential-free routes were already admitted or refused by identity.
    if (!identity || !isRestrictedRequest(request)) return;

    const params = request.params as Fields;
    const query = request.query as Fields;
    const body =
      request.body && typeof request.body === 'object'
        ? (request.body as Record<string, unknown>)
        : undefined;
    const level =
      request.routeOptions.config?.spaceAccess ??
      (request.method === 'GET' || request.method === 'HEAD'
        ? 'read'
        : 'write');

    const checks: Array<['read' | 'write', string]> = [];
    const canvasId =
      id(params?.canvasId) ?? id(query?.canvasId) ?? id(body?.canvasId);
    if (canvasId) checks.push([level, canvasId]);
    else if (
      (id(params?.threadId) ?? id(query?.threadId) ?? id(body?.threadId)) &&
      !identity.owner
    ) {
      return reply.code(403).send({
        message: 'Conversations outside a Space require an owner',
        code: 'SPACE_ACCESS_REQUIRED',
      });
    }
    const destination = body?.destination as Fields;
    for (const [needed, value] of [
      ['write', body?.targetCanvasId],
      ['write', destination?.canvasId],
      ['write', body?.parentSpaceId],
      ['read', body?.srcCanvasId],
    ] as const) {
      const other = id(value);
      if (other) checks.push([needed, other]);
    }

    for (const [needed, spaceId] of checks) {
      const space = { type: 'space', id: spaceId } as const;
      if (await identity.access.can(needed, space)) continue;
      // Without read access the Space is indistinguishable from a missing one.
      if (needed === 'write' && (await identity.access.can('read', space)))
        return reply.code(403).send({
          message: 'Space is read-only for this principal',
          code: 'SPACE_ACCESS_REQUIRED',
        });
      return reply.code(404).send({ message: 'Canvas not found' });
    }
  });
}

/** Whether the caller's access is decided per Workspace and Space. */
export function isRestrictedRequest(request: FastifyRequest): boolean {
  const access = getRequestIdentity(request)?.access;
  return access !== undefined && access !== UNRESTRICTED_ACCESS;
}

/** Record the caller as owner of the Space it has just created. */
export async function claimSpace(
  request: FastifyRequest,
  canvasId: string,
): Promise<void> {
  await getRequestIdentity(request)?.access.claim({
    type: 'space',
    id: canvasId,
  });
}

/** Whether the caller may read the Space. */
export async function canReadSpace(
  request: FastifyRequest,
  canvasId: string,
): Promise<boolean> {
  return (
    (await getRequestIdentity(request)?.access.can('read', {
      type: 'space',
      id: canvasId,
    })) ?? false
  );
}

/** Keep only the Spaces the caller may read, in their original order. */
export async function readableSpaces<T extends { canvasId: string }>(
  request: FastifyRequest,
  spaces: readonly T[],
): Promise<T[]> {
  const access = getRequestIdentity(request)?.access;
  if (!access) return [];
  const readable = await Promise.all(
    spaces.map((space) =>
      access.can('read', { type: 'space', id: space.canvasId }),
    ),
  );
  return spaces.filter((_, index) => readable[index]);
}
