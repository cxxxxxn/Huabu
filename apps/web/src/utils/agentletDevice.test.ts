// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';

import { resolveConnectedDevice } from './agentletDevice';

import type { ConnectedAgentletDevice } from '@huabu/shared';

const device = (
  agentletId: string,
  hostname: string,
): ConnectedAgentletDevice => ({
  agentletId,
  hostname,
  displayName: `${hostname}: linux x64`,
  version: '1.0',
  connectedAt: '2026-10-15T00:00:00Z',
  profileCount: 1,
});

describe('resolveConnectedDevice', () => {
  it('prefers the exact ID over legacy hostname matches', () => {
    const exact = device('target', 'host');
    expect(
      resolveConnectedDevice('target', [device('other', 'target'), exact]),
    ).toBe(exact);
  });

  it('resolves only an unambiguous legacy hostname', () => {
    const match = device('first', 'legacy');
    expect(resolveConnectedDevice('legacy', [match])).toBe(match);
    expect(
      resolveConnectedDevice('legacy', [match, device('second', 'legacy')]),
    ).toBeUndefined();
    expect(resolveConnectedDevice('missing', [match])).toBeUndefined();
  });
});
