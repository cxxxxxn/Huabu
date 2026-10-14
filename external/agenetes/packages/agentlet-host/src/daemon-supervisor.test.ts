import {
  mkdtempSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { getDaemonAuth, _resetDaemonAuthForTests } from './daemon-auth.js';
import {
  filterHostNamespacedEnv,
  getDaemonSupervisor,
  _resetDaemonSupervisorForTests,
} from './daemon-supervisor.js';

describe('filterHostNamespacedEnv', () => {
  const base = {
    PATH: '/usr/bin',
    HOME: '/home/agent',
    HUABU_SECRET_KEY: 'super-secret',
    HUABU_DATA_DIR: '/data',
    HUABU_RFS_URL: 'http://127.0.0.1:3001/api/rfs/c1',
  } satisfies NodeJS.ProcessEnv;

  it('drops every host-namespaced var when the allowlist is empty', () => {
    const out = filterHostNamespacedEnv(base, 'HUABU_', []);
    expect(out).toEqual({ PATH: '/usr/bin', HOME: '/home/agent' });
  });

  describe('embedded launch bootstrap', () => {
    it('forks with immutable opaque host bootstrap and keeps the credential out of argv', async () => {
      const directory = mkdtempSync(join(tmpdir(), 'agenetes-supervisor-'));
      const entry = join(directory, 'daemon.cjs');
      const result = join(directory, 'launch.json');
      writeFileSync(
        entry,
        `require('node:fs').writeFileSync(${JSON.stringify(result)}, JSON.stringify({ argv: process.argv.slice(2), token: process.env.AGENTLET_TOKEN, secret: process.env.HUABU_SECRET_KEY }));`,
      );
      const app = Fastify();
      _resetDaemonSupervisorForTests();
      _resetDaemonAuthForTests();
      getDaemonAuth().setDaemonToken('host-token');
      vi.stubEnv('HUABU_SECRET_KEY', 'must-not-inherit');
      vi.stubEnv('AGENTLET_TOKEN', 'wrong-token');
      const bootstrapEnv = { HOST_ENTRY: ' opaque entry=a=b ' };
      try {
        getDaemonSupervisor().attach(app, {
          daemonEntryPath: entry,
          dataDir: directory,
          bootstrapEnv,
          hostEnvPrefix: 'HUABU_',
          hostEnvAllowlist: [],
        });
        bootstrapEnv.HOST_ENTRY = 'changed';
        await app.listen({ port: 0, host: '127.0.0.1' });
        const deadline = Date.now() + 5000;
        while (!existsSync(result)) {
          if (Date.now() >= deadline)
            throw new Error('Supervisor child did not start');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        const launch = JSON.parse(readFileSync(result, 'utf8'));
        expect(launch.token).toBe('host-token');
        expect(launch.secret).toBeUndefined();
        expect(launch.argv).toContain('HOST_ENTRY= opaque entry=a=b ');
        expect(launch.argv).not.toContain('--token');
        expect(launch.argv).not.toContain('host-token');
        const address = app.server.address();
        if (!address || typeof address === 'string')
          throw new Error('Missing bound test port');
        expect(launch.argv).toContain(
          `ws://127.0.0.1:${address.port}/api/acp/agent`,
        );
      } finally {
        await app.close();
        _resetDaemonSupervisorForTests();
        _resetDaemonAuthForTests();
        vi.unstubAllEnvs();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  });

  it('keeps only allow-listed host-namespaced vars', () => {
    const out = filterHostNamespacedEnv(base, 'HUABU_', ['HUABU_RFS_URL']);
    expect(out).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/agent',
      HUABU_RFS_URL: 'http://127.0.0.1:3001/api/rfs/c1',
    });
  });

  it('is a no-op passthrough when no prefix is given', () => {
    const out = filterHostNamespacedEnv(base, undefined, undefined);
    expect(out).toEqual(base);
  });

  it('preserves non-namespaced OS/toolchain vars verbatim', () => {
    const out = filterHostNamespacedEnv(
      { PATH: '/usr/bin', LANG: 'en_US.UTF-8', TMPDIR: '/tmp', HUABU_X: 'y' },
      'HUABU_',
      [],
    );
    expect(out).toEqual({
      PATH: '/usr/bin',
      LANG: 'en_US.UTF-8',
      TMPDIR: '/tmp',
    });
  });

  it('skips undefined values without emitting the key', () => {
    const out = filterHostNamespacedEnv(
      { PATH: '/usr/bin', MAYBE: undefined },
      'HUABU_',
      [],
    );
    expect(out).toEqual({ PATH: '/usr/bin' });
    expect('MAYBE' in out).toBe(false);
  });

  it('does not mutate the input environment', () => {
    const input = { HUABU_SECRET_KEY: 's', PATH: '/usr/bin' };
    filterHostNamespacedEnv(input, 'HUABU_', []);
    expect(input).toEqual({ HUABU_SECRET_KEY: 's', PATH: '/usr/bin' });
  });
});
