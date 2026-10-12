// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildHuabuBootstrapEnv,
  resolveRuntimeArtifacts,
} from '@huabu/client-runtime';
/**
 * Resolve the absolute path to the agentlet daemon entry script.
 *
 * This is L1 (host) deployment-layout knowledge: the generic
 * `@agenetes/agentlet-host` package must not embed Huabu's bundle
 * layout, so the host resolves the entry here and passes the absolute
 * path down via `mountAgenetes({ daemonEntryPath })`.
 *
 * Returns `null` when no candidate exists — the supervisor then
 * surfaces a permanent error and the bridge stays disabled.
 *
 * Resolution order:
 *   1. `HUABU_AGENTLET_DAEMON_PATH` env var — explicit override.
 *   2. `<bundleDir>/agentlet/index.js` — packaged Electron layout
 *      (tsup copies the daemon bundle next to `server.js`).
 *   3. `<repoRoot>/external/agentlet/packages/local/dist/index.js`
 *      — monorepo dev layout (relative to this source file).
 *
 * The first existing path wins.
 */
export function resolveDaemonEntry(): string | null {
  return resolveDaemonRuntime().artifacts.daemonEntry;
}

export function resolveDaemonRuntime() {
  const here = dirname(fileURLToPath(import.meta.url));
  const artifacts = resolveRuntimeArtifacts({
    daemonOverride: process.env.HUABU_AGENTLET_DAEMON_PATH,
    bundleDir: here,
    repoRoot: resolve(here, '../../../../../..'),
  });
  return { artifacts, bootstrapEnv: buildHuabuBootstrapEnv(artifacts) };
}
