// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

const deviceIdentitySchema = z.object({
  version: z.literal(1),
  deviceId: z.uuid(),
});

/** Observe the local filesystem identity without provisioning an Agentlet. */
export async function readPickerDeviceId(): Promise<string | null> {
  try {
    const contents = await readFile(
      join(homedir(), '.agentlet', 'device.json'),
      'utf8',
    );
    const parsed = deviceIdentitySchema.safeParse(JSON.parse(contents));
    if (!parsed.success)
      throw new Error('Invalid local Agentlet device identity');
    return parsed.data.deviceId;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return null;
    throw error;
  }
}
