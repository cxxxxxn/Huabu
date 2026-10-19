// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the absolute path of the data directory.
 *
 * Two runtime layouts:
 *   ─ Source (tsx): no HUABU_DATA_DIR env var, so fall back to
 *     `apps/server/data/`, independent of the caller's working directory.
 *   ─ Bundled (Electron): the desktop main process injects
 *     `HUABU_DATA_DIR` pointing into the user's Electron `userData`
 *     directory, which is writable post-install.
 */
export function getDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.HUABU_DATA_DIR
    ? resolve(env.HUABU_DATA_DIR)
    : fileURLToPath(new URL('../data/', import.meta.url));
}
