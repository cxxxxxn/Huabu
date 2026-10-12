// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from 'tsup';
import { describe, expect, it } from 'vitest';

import clientRuntimeConfig from '../../../packages/client-runtime/tsup.config.js';
import bundleConfig from '../tsup.config.js';

const configured =
  typeof bundleConfig === 'function' ? await bundleConfig({}) : bundleConfig;
const configurations = Array.isArray(configured) ? configured : [configured];

describe('server bundle runtime', () => {
  it('loads real Agentlet and client-runtime artifacts outside the workspace without node_modules', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'huabu-real-runtime-'));
    try {
      writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}');
      await build({
        ...configurations[1],
        config: false,
        entry: {
          index: path.resolve(
            '../../external/agentlet/packages/local/src/index.ts',
          ),
        },
        outDir: path.join(directory, 'agentlet'),
        onSuccess: undefined,
        silent: true,
      });
      const runtimeOptions =
        typeof clientRuntimeConfig === 'function'
          ? await clientRuntimeConfig({})
          : clientRuntimeConfig;
      if (Array.isArray(runtimeOptions))
        throw new Error('Expected one runtime build config');
      await build({
        ...runtimeOptions,
        config: false,
        entry: {
          'service-sdk': path.resolve(
            '../../packages/client-runtime/src/service-sdk.ts',
          ),
          daemon: path.resolve('../../packages/client-runtime/src/daemon.ts'),
          rfs: path.resolve('../../packages/client-runtime/src/rfs.ts'),
        },
        outDir: path.join(directory, 'client-runtime'),
        silent: true,
      });
      const daemonHelp = execFileSync(
        process.execPath,
        [path.join(directory, 'agentlet/index.js'), 'daemon', '--help'],
        { encoding: 'utf8' },
      );
      expect(daemonHelp).toContain('--env-inject');
      const hostHelp = execFileSync(
        process.execPath,
        [path.join(directory, 'client-runtime/daemon.js'), '--help'],
        { encoding: 'utf8' },
      );
      expect(hostHelp).toContain('pnpm start:daemon');
      const rfsHelp = execFileSync(
        process.execPath,
        [path.join(directory, 'client-runtime/rfs.js'), '--help'],
        {
          encoding: 'utf8',
          env: { ...process.env, HUABU_RFS_URL: '', AGENTLET_TOKEN: '' },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      expect(rfsHelp).toContain('Response bodies and SSE are raw');
      const sdkProbe = execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          'const sdk = await import(process.argv[1]); console.log(typeof sdk.leaseService, typeof sdk.withServiceContext)',
          pathToFileURL(path.join(directory, 'client-runtime/service-sdk.js'))
            .href,
        ],
        { encoding: 'utf8' },
      );
      expect(sdkProbe.trim()).toBe('function function');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it.each(configurations)(
    'loads prefix-only Node built-ins with the $outDir configuration',
    async (configuration) => {
      const directory = mkdtempSync(path.join(tmpdir(), 'huabu-bundle-test-'));
      try {
        const entry = path.join(directory, 'probe.ts');
        writeFileSync(
          entry,
          `import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const database = new DatabaseSync(':memory:');
writeFileSync(process.argv[2], JSON.stringify(database.prepare('SELECT 42 AS answer').get()));
database.close();
`,
        );
        const outDir = path.join(directory, 'dist');
        // Exercise the production bundler options with a small real entry.
        // Only redirect artifacts and omit production asset copying.
        await build({
          ...configuration,
          config: false,
          entry: { probe: entry },
          outDir,
          outExtension: () => ({ js: '.mjs' }),
          onSuccess: undefined,
          silent: true,
        });
        const resultFile = path.join(directory, 'result.json');
        execFileSync(
          process.execPath,
          [path.join(outDir, 'probe.mjs'), resultFile],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
        expect(JSON.parse(readFileSync(resultFile, 'utf8'))).toEqual({
          answer: 42,
        });
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
