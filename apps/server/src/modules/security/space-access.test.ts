// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  claimSpace,
  readableSpaces,
  registerSpaceAccess,
} from './space-access.js';
import { setRequestIdentity } from '../identity/request.js';

import type { FastifyInstance } from 'fastify';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

/** Carol may write `mine` and read `shared`; the header picks the owner flag. */
function host() {
  const claimed: string[] = [];
  const app = Fastify();
  apps.push(app);
  app.addHook('onRequest', async (request) => {
    setRequestIdentity(request, {
      principal: { principalId: 'carol', kind: 'user' },
      member: true,
      owner: request.headers['x-owner'] === 'yes',
      access: {
        can: async (level, { id }) =>
          id === 'mine' || (id === 'shared' && level === 'read'),
        claim: async ({ id }) => {
          claimed.push(id);
        },
      },
    });
  });
  registerSpaceAccess(app);
  const ok = async () => ({ ok: true });
  app.get('/api/canvas/:canvasId', ok);
  app.put('/api/canvas/:canvasId', ok);
  app.post(
    '/api/canvas/:canvasId/search',
    { config: { spaceAccess: 'read' } },
    ok,
  );
  app.get('/api/agent/history/:threadId', ok);
  app.post('/api/agent', ok);
  app.post('/api/canvas/:canvasId/move-selection', ok);
  app.patch('/api/canvas/:canvasId/parent', ok);
  app.post('/api/canvas/:canvasId/artifact/clone-from', ok);
  app.get('/api/canvas', async (request) =>
    readableSpaces(request, [
      { canvasId: 'other' },
      { canvasId: 'mine' },
      { canvasId: 'shared' },
    ]),
  );
  app.post('/api/canvas', async (request) => {
    await claimSpace(request, 'created');
    return {};
  });
  return { app, claimed };
}

describe('Space access', () => {
  it('reads and writes only the Spaces the identity provider allows', async () => {
    const { app } = host();
    const status = async (method: 'GET' | 'PUT', id: string) =>
      (
        await app.inject({
          method,
          url: `/api/canvas/${id}`,
          payload: method === 'PUT' ? {} : undefined,
        })
      ).statusCode;
    expect(await status('GET', 'mine')).toBe(200);
    expect(await status('PUT', 'mine')).toBe(200);
    expect(await status('GET', 'shared')).toBe(200);
    expect(await status('PUT', 'shared')).toBe(403);
    // An unreadable Space looks exactly like a missing one.
    const hidden = await app.inject('/api/canvas/other');
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toEqual({ message: 'Canvas not found' });
    // A route that declares itself read-only needs only read access.
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/canvas/shared/search',
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
  });

  it('finds the Space in the query or body, and refuses Space-less conversations to members', async () => {
    const { app } = host();
    const history = (query: string, owner = 'no') =>
      app.inject({
        url: `/api/agent/history/t1${query}`,
        headers: { 'x-owner': owner },
      });
    expect((await history('?canvasId=mine')).statusCode).toBe(200);
    expect((await history('?canvasId=other')).statusCode).toBe(404);
    expect((await history('')).statusCode).toBe(403);
    expect((await history('', 'yes')).statusCode).toBe(200);
    const submit = (payload: object) =>
      app.inject({ method: 'POST', url: '/api/agent', payload });
    expect(
      (await submit({ canvasId: 'mine', threadId: 't1' })).statusCode,
    ).toBe(200);
    expect((await submit({ canvasId: 'other' })).statusCode).toBe(404);
    expect((await submit({ threadId: 't1' })).statusCode).toBe(403);
  });

  it('also authorizes the other Space a request moves content to or from', async () => {
    const { app } = host();
    const post = (
      url: string,
      payload: object,
      method: 'POST' | 'PATCH' = 'POST',
    ) => app.inject({ method, url, payload });
    expect(
      (
        await post('/api/canvas/mine/move-selection', {
          destination: { kind: 'existing', canvasId: 'shared' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post('/api/canvas/mine/move-selection', {
          destination: { kind: 'new', title: 'New' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await post(
          '/api/canvas/mine/parent',
          { parentSpaceId: 'other' },
          'PATCH',
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await post('/api/canvas/mine/artifact/clone-from', {
          srcCanvasId: 'shared',
          srcKey: 'a.png',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await post('/api/canvas/mine/artifact/clone-from', {
          srcCanvasId: 'other',
          srcKey: 'a.png',
        })
      ).statusCode,
    ).toBe(404);
  });

  it('lists readable Spaces and claims created ones for the caller', async () => {
    const { app, claimed } = host();
    expect((await app.inject('/api/canvas')).json()).toEqual([
      { canvasId: 'mine' },
      { canvasId: 'shared' },
    ]);
    await app.inject({ method: 'POST', url: '/api/canvas', payload: {} });
    expect(claimed).toEqual(['created']);
  });
});
