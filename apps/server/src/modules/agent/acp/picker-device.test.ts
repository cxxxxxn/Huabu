// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readPickerDeviceId } from './picker-device.js';

const mocks = vi.hoisted(() => ({ readFile: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile }));

beforeEach(() => {
  mocks.readFile.mockReset();
});

describe('readPickerDeviceId', () => {
  it('reads the persisted UUID without creating or rewriting an identity', async () => {
    const deviceId = '5fb8bd24-57f5-4a2e-811a-4620b10bbbd4';
    mocks.readFile.mockResolvedValue(JSON.stringify({ version: 1, deviceId }));
    await expect(readPickerDeviceId()).resolves.toBe(deviceId);
    expect(mocks.readFile).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]\.agentlet[\\/]device\.json$/),
      'utf8',
    );
  });

  it('leaves an unprovisioned machine without a picker identity', async () => {
    mocks.readFile.mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
    );
    await expect(readPickerDeviceId()).resolves.toBeNull();
  });

  it.each([
    'invalid JSON',
    '{"version":1,"deviceId":"hostname"}',
    '{"version":2,"deviceId":"5fb8bd24-57f5-4a2e-811a-4620b10bbbd4"}',
  ])('reports invalid identity data: %s', async (contents) => {
    mocks.readFile.mockResolvedValue(contents);
    await expect(readPickerDeviceId()).rejects.toThrow();
  });

  it('reports unreadable identity files', async () => {
    mocks.readFile.mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'EACCES' }),
    );
    await expect(readPickerDeviceId()).rejects.toThrow('denied');
  });
});
