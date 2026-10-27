// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import canvasRoutes from './canvas.route.js';
import { createChildSpace } from './space-hierarchy.js';
import { setRequestIdentity } from '../identity/request.js';
import {
  createSpace,
  getStructuredStore,
  resetStorageCache,
} from '../storage/index.js';
import { setWorkspacePath } from '../workspace.js';

import type { ResourceAccess } from '../identity/service.js';

let tmp: string;
beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'huabu-member-spaces-'));
  setWorkspacePath(tmp);
  resetStorageCache();
  await createSpace('root', 'Private parent');
});
afterEach(() => {
  resetStorageCache();
  rmSync(tmp, { recursive: true, force: true });
});

async function host(access: ResourceAccess) {
  const app = fastify();
  app.addHook('onRequest', async (request) => {
    setRequestIdentity(request, {
      principal: { principalId: 'carol', kind: 'user' },
      member: true,
      owner: false,
      access,
    });
  });
  await app.register(canvasRoutes, { prefix: '/canvas' });
  return app;
}

describe('a member’s Spaces', () => {
  it('lists a readable child of an unreadable parent as a root', async () => {
    const child = await createChildSpace('root', 'Mine');
    const app = await host({
      can: async (_level, { id }) => id === child.canvasId,
      claim: async () => {},
    });
    const listed = (await app.inject('/canvas')).json().canvases;
    await app.close();
    expect(listed).toEqual([
      expect.objectContaining({
        canvasId: child.canvasId,
        parentSpaceId: null,
      }),
    ]);
    // Only the response changes.
    expect(
      (await getStructuredStore().spaces().list()).find(
        (item) => item.canvasId === child.canvasId,
      )?.parentSpaceId,
    ).toBe('root');
  });

  it('leaves no Space behind when its ownership cannot be recorded', async () => {
    const app = await host({
      can: async () => true,
      claim: async () => {
        throw new Error('grant store unavailable');
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/canvas',
      payload: { title: 'Unclaimed' },
    });
    await app.close();
    expect(response.statusCode).toBe(500);
    expect(
      (await getStructuredStore().spaces().list()).map((item) => item.title),
    ).toEqual(['Private parent']);
  });
});
