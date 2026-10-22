// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { agentletConnectionCredentialsSchema } from '@huabu/shared';

export {
  buildDaemonChildEnv,
  buildHuabuBootstrapEnv,
  resolveRuntimeArtifacts,
} from './bootstrap.js';

export async function fetchDesktopAgentCredential(
  origin: string,
  fetchImpl: typeof fetch,
): Promise<readonly [token: string, maxAgents: number]> {
  const response = await fetchImpl(
    new URL('/api/acp/connection-credentials', origin),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Device authorization failed (HTTP ${response.status}). Sign in to the server and try again.`,
    );
  }
  const parsed = agentletConnectionCredentialsSchema.safeParse(
    await response.json(),
  );
  if (!parsed.success) {
    throw new Error(
      'The server returned invalid device connection credentials.',
    );
  }
  return [parsed.data.token, parsed.data.maxAgents];
}
