// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it, vi } from 'vitest';

import { fetchDesktopAgentCredential } from '../src/desktop.js';

describe('desktop device credential exchange', () => {
  it('uses the authenticated fetch implementation and never follows redirects', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ token: 'secret', maxAgents: 3 }));
    expect(
      await fetchDesktopAgentCredential('https://huabu.test', request),
    ).toEqual(['secret', 3]);
    expect(request).toHaveBeenCalledWith(
      new URL('https://huabu.test/api/acp/connection-credentials'),
      expect.objectContaining({
        method: 'POST',
        body: '{}',
        redirect: 'error',
      }),
    );
  });
  it.each([401, 403, 302, 503])(
    'surfaces HTTP %i without returning credentials',
    async (status) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status }));
      await expect(
        fetchDesktopAgentCredential('https://huabu.test', request),
      ).rejects.toThrow(`HTTP ${status}`);
    },
  );
  it.each([
    { token: '', maxAgents: 3 },
    { token: 'secret', maxAgents: 0 },
    { token: 'secret', maxAgents: 1.5 },
    { token: 'secret' },
  ])(
    'rejects malformed credential responses without exposing them',
    async (body) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(body));
      await expect(
        fetchDesktopAgentCredential('https://huabu.test', request),
      ).rejects.toThrow('invalid device connection credentials');
    },
  );
});
