// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildDaemonChildEnv,
  buildHuabuBootstrapEnv,
  resolveRuntimeArtifacts,
} from '../src/bootstrap.js';
import {
  parseConnectionEnvFile,
  parseDaemonArgs,
  readConnectionConfig,
  runDaemon,
} from '../src/daemon.js';

const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function root() {
  const directory = mkdtempSync(join(tmpdir(), 'huabu-runtime spaced-'));
  directories.push(directory);
  return directory;
}

describe('connection configuration', () => {
  it('accepts direct env without a file and normalizes the canonical origin', () => {
    expect(
      readConnectionConfig({
        repoRoot: root(),
        inherited: {
          HUABU_PUBLIC_ORIGIN: 'https://example.test/',
          HUABU_CONNECTION_TOKEN: 'token',
        },
      }),
    ).toEqual({ origin: 'https://example.test', token: 'token' });
  });

  it('uses shell overrides for default dotenv but isolates an explicit file', () => {
    const repoRoot = root();
    const file = join(repoRoot, '.env');
    writeFileSync(
      file,
      'HUABU_PUBLIC_ORIGIN=https://file.test\nHUABU_CONNECTION_TOKEN=file-token\n',
    );
    const inherited = {
      HUABU_PUBLIC_ORIGIN: 'https://shell.test',
      HUABU_CONNECTION_TOKEN: 'shell-token',
    };
    expect(readConnectionConfig({ repoRoot, inherited })).toEqual({
      origin: 'https://shell.test',
      token: 'shell-token',
    });
    expect(
      readConnectionConfig({ repoRoot, inherited, envFile: file }),
    ).toEqual({ origin: 'https://file.test', token: 'file-token' });
    writeFileSync(file, 'HUABU_PUBLIC_ORIGIN=https://file.test\n');
    expect(() =>
      readConnectionConfig({ repoRoot, inherited, envFile: file }),
    ).toThrow('HUABU_CONNECTION_TOKEN');
    expect(() =>
      readConnectionConfig({
        repoRoot,
        inherited,
        envFile: join(repoRoot, 'missing'),
      }),
    ).toThrow('ENOENT');
    expect(() =>
      readConnectionConfig({ repoRoot, inherited, envFile: '' }),
    ).toThrow('--env-file requires');
  });

  it('parses dotenv as data, filters unrelated fields and preserves opaque credential values', () => {
    expect(
      parseConnectionEnvFile(
        '# comment\nexport HUABU_PUBLIC_ORIGIN="https://example.test/" # origin\nHUABU_CONNECTION_TOKEN="a=b ${HOME}"\nOTHER=`line\nmore`\n',
      ),
    ).toEqual({
      HUABU_PUBLIC_ORIGIN: 'https://example.test/',
      HUABU_CONNECTION_TOKEN: 'a=b ${HOME}',
    });
  });

  it.each([
    'HUABU_CONNECTION_TOKEN=secret\nHUABU_CONNECTION_TOKEN=other',
    'HUABU_CONNECTION_TOKEN="secret',
    'HUABU_CONNECTION_TOKEN="secret"extra',
    'malformed secret',
    'HUABU_CONNECTION_TOKEN=secret\0',
  ])('rejects malformed files without exposing credential values', (text) => {
    expect(() => parseConnectionEnvFile(text)).toThrow();
    try {
      parseConnectionEnvFile(text);
    } catch (error) {
      expect(String(error)).not.toContain('secret');
    }
  });

  it('rejects Windows case collisions in files and inherited connection input', () => {
    expect(() =>
      parseConnectionEnvFile(
        'HUABU_CONNECTION_TOKEN=a\nhuabu_connection_token=b',
        'win32',
      ),
    ).toThrow('Duplicate');
    expect(() =>
      readConnectionConfig({
        repoRoot: root(),
        platform: 'win32',
        inherited: {
          HUABU_PUBLIC_ORIGIN: 'https://host.test',
          HUABU_CONNECTION_TOKEN: 'a',
          huabu_connection_token: 'b',
        },
      }),
    ).toThrow('Duplicate');
  });

  it.each([
    'https://host.test/path',
    'https://user:password@host.test',
    'wss://host.test',
    'https://host.test?query',
    'https://host.test#fragment',
  ])('rejects non-origin configuration %s', (origin) => {
    expect(() =>
      readConnectionConfig({
        repoRoot: root(),
        inherited: {
          HUABU_PUBLIC_ORIGIN: origin,
          HUABU_CONNECTION_TOKEN: 'token',
        },
      }),
    ).toThrow('HUABU_PUBLIC_ORIGIN');
  });

  it.each(['--server', '--token', '--env-inject', '--allow-insecure'])(
    'does not permit protected launch override %s',
    (option) => {
      expect(() => parseDaemonArgs([option, 'value'])).toThrow();
    },
  );
});

describe('device-local runtime bootstrap', () => {
  it('forwards termination to its actual child and removes signal listeners', async () => {
    const repoRoot = root();
    mkdirSync(join(repoRoot, 'packages/client-runtime/dist'), {
      recursive: true,
    });
    mkdirSync(join(repoRoot, 'external/agentlet/packages/local/dist'), {
      recursive: true,
    });
    writeFileSync(
      join(repoRoot, 'packages/client-runtime/dist/service-sdk.js'),
      'export {};',
    );
    const ready = join(repoRoot, 'ready');
    writeFileSync(
      join(repoRoot, 'external/agentlet/packages/local/dist/index.js'),
      `process.on('SIGTERM', () => process.exit(9)); require('node:fs').writeFileSync(${JSON.stringify(ready)}, 'ready'); setTimeout(() => process.exit(66), 5000);`,
    );
    vi.stubEnv('HUABU_PUBLIC_ORIGIN', 'https://host.test');
    vi.stubEnv('HUABU_CONNECTION_TOKEN', 'token');
    const initial = process.listeners('SIGTERM');
    const running = runDaemon([], repoRoot);
    const handler = process
      .listeners('SIGTERM')
      .find((listener) => !initial.includes(listener));
    if (!handler) throw new Error('Missing source launcher signal handler');
    try {
      const deadline = Date.now() + 3000;
      while (!existsSync(ready)) {
        if (Date.now() >= deadline)
          throw new Error('Source launcher child did not start');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      handler('SIGTERM');
      expect(await running).toBe(9);
      expect(process.listeners('SIGTERM')).toEqual(initial);
    } finally {
      handler('SIGTERM');
      await running;
    }
  });
  it('only advertises actual artifacts and never provides Node coordinates', () => {
    const repoRoot = root();
    mkdirSync(join(repoRoot, 'packages/client-runtime/dist'), {
      recursive: true,
    });
    const sdk = join(repoRoot, 'packages/client-runtime/dist/service-sdk.js');
    writeFileSync(sdk, 'export {};');
    const artifacts = resolveRuntimeArtifacts({ repoRoot });
    expect(artifacts).toEqual({
      daemonEntry: null,
      serviceSdkEntry: sdk,
      rfsEntry: null,
    });
    const env = buildHuabuBootstrapEnv(artifacts);
    expect(env).toEqual({ HUABU_SERVICE_SDK_URL: pathToFileURL(sdk).href });
    expect(Object.isFrozen(env)).toBe(true);
    expect(
      buildHuabuBootstrapEnv({
        daemonEntry: null,
        serviceSdkEntry: null,
        rfsEntry: null,
      }),
    ).toEqual({});
  });

  it('prefers self-contained bundle layout and supports explicit daemon overrides', () => {
    const bundleDir = root();
    mkdirSync(join(bundleDir, 'agentlet'));
    mkdirSync(join(bundleDir, 'client-runtime'));
    for (const file of [
      'agentlet/index.js',
      'client-runtime/service-sdk.js',
      'client-runtime/rfs.js',
    ])
      writeFileSync(join(bundleDir, file), 'export {};');
    const artifacts = resolveRuntimeArtifacts({ bundleDir });
    expect(buildHuabuBootstrapEnv(artifacts)).toEqual({
      HUABU_SERVICE_SDK_URL: pathToFileURL(
        join(bundleDir, 'client-runtime/service-sdk.js'),
      ).href,
      HUABU_RFS_ENTRY: join(bundleDir, 'client-runtime/rfs.js'),
    });
    const override = join(bundleDir, 'override.js');
    writeFileSync(override, 'export {};');
    expect(
      resolveRuntimeArtifacts({ bundleDir, daemonOverride: override })
        .daemonEntry,
    ).toBe(override);
  });

  it('filters deployment namespace and authoritative token variants before child launch', () => {
    const inherited = {
      PATH: '/tools',
      HUABU_SECRET_KEY: 'secret',
      huabu_connection_token: 'secret',
      Agentlet_Token: 'old',
    };
    expect(buildDaemonChildEnv(inherited, 'new', 'win32')).toEqual({
      PATH: '/tools',
      AGENTLET_TOKEN: 'new',
    });
    expect(inherited.Agentlet_Token).toBe('old');
  });

  it.each([
    ['https://host.test', 'wss://host.test/api/acp/agent', false],
    ['http://host.test:1234', 'ws://host.test:1234/api/acp/agent', true],
  ])(
    'launches an actual child for %s with token only in env and propagates exit',
    async (origin, endpoint, insecure) => {
      const repoRoot = root();
      mkdirSync(join(repoRoot, 'packages/client-runtime/dist'), {
        recursive: true,
      });
      mkdirSync(join(repoRoot, 'external/agentlet/packages/local/dist'), {
        recursive: true,
      });
      writeFileSync(
        join(repoRoot, 'packages/client-runtime/dist/service-sdk.js'),
        'export {};',
      );
      const output = join(repoRoot, 'child.json');
      writeFileSync(
        join(repoRoot, 'external/agentlet/packages/local/dist/index.js'),
        `require('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({argv:process.argv.slice(2),token:process.env.AGENTLET_TOKEN,secret:process.env.HUABU_SECRET_KEY})); process.exit(7);`,
      );
      const envFile = join(repoRoot, 'connection.env');
      writeFileSync(
        envFile,
        `HUABU_PUBLIC_ORIGIN=${origin}\nHUABU_CONNECTION_TOKEN=child-secret\n`,
      );
      vi.stubEnv('HUABU_SECRET_KEY', 'must-not-inherit');
      expect(
        await runDaemon(
          ['--', '--env-file', envFile, '--max-agents', '4'],
          repoRoot,
        ),
      ).toBe(7);
      const result = JSON.parse(readFileSync(output, 'utf8'));
      expect(result.token).toBe('child-secret');
      expect(result.secret).toBeUndefined();
      expect(result.argv.slice(0, 3)).toEqual(['daemon', '--server', endpoint]);
      expect(result.argv.includes('--allow-insecure')).toBe(insecure);
      expect(result.argv).not.toContain('child-secret');
      expect(result.argv).not.toContain('--token');
      expect(result.argv).not.toContain('HUABU_NODE_EXECUTABLE');
      expect(result.argv.slice(-2)).toEqual(['--max-agents', '4']);
    },
  );
});
