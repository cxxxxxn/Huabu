// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { runRfs } from '../src/rfs.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
async function server(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
) {
  const app = createServer(handler);
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => {
    app.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      app.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = app.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected bound port');
  return {
    HUABU_RFS_URL: `http://127.0.0.1:${address.port}/rfs/space`,
    AGENTLET_TOKEN: 'private-token',
    HUABU_THREAD_ID: 'host-thread',
  };
}
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'huabu-rfs-test-'));
  cleanup.push(() => rm(path, { recursive: true, force: true }));
  return path;
}
function output(onChunk?: (chunk: Buffer) => void) {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      onChunk?.(chunk);
      callback();
    },
  });
  return {
    stream,
    bytes: () => Buffer.concat(chunks),
    text: () => Buffer.concat(chunks).toString(),
  };
}
async function bytes(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function call(
  args: string[],
  env: NodeJS.ProcessEnv,
  stdin: Buffer = Buffer.alloc(0),
  extra: Parameters<typeof runRfs>[1] = {},
) {
  const stdout = output();
  const stderr = output();
  const code = await runRfs(args, {
    env,
    stdout: stdout.stream,
    stderr: stderr.stream,
    stdin: Readable.from([stdin]),
    ...extra,
  });
  return { code, stdout: stdout.bytes(), stderr: stderr.text() };
}

describe('optional raw RFS client', () => {
  it.each([
    [['get-skill', 'service-config'], '/skill/service-config'],
    [['agent', 'profiles'], '/agent/profiles'],
  ])(
    'reads the exact authenticated catalogue/Skill endpoint',
    async (args, path) => {
      const env = await server((request, response) => {
        expect(request.url).toBe(`/rfs/space${path}`);
        expect(request.headers.authorization).toBe('Bearer private-token');
        response.end('raw content');
      });
      const result = await call(args, env);
      expect(result.code).toBe(0);
      expect(result.stdout.toString()).toBe('raw content');
    },
  );

  it('interrupts pending stdin before sending any mutation', async () => {
    let count = 0;
    const env = await server((_request, response) => {
      count++;
      response.end();
    });
    const controller = new AbortController();
    const stderr = output();
    const stdin = new PassThrough();
    const pending = runRfs(['execute', '--json-file', '-'], {
      env,
      stdin,
      stdout: output().stream,
      stderr: stderr.stream,
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toBe(130);
    expect(count).toBe(0);
    expect(stdin.destroyed).toBe(true);
    expect(stderr.text()).not.toContain('Remote outcome may be unknown');
  });
  it.each(['query', 'execute'])(
    'forwards %s JSON bytes and unknown result fields without interpreting business outcomes',
    async (command) => {
      const original = ' \n{"type":"FUTURE","unknown":true}\n';
      const reply =
        '{"results":[{"applied":false,"reason":"conflict"}],"future":[1,2]}';
      const env = await server((request, response) => {
        expect(request.url).toBe(`/rfs/space/${command}`);
        expect(request.headers.authorization).toBe('Bearer private-token');
        expect(request.headers['x-huabu-host-thread-id']).toBe(
          command === 'execute' ? 'host-thread' : undefined,
        );
        void bytes(request).then((body) => {
          expect(body.toString()).toBe(original);
          response.end(reply);
        });
      });
      const result = await call(
        [command, '--json-file', '-'],
        env,
        Buffer.from(original),
      );
      expect(result.code).toBe(0);
      expect(result.stdout.toString()).toBe(reply);
    },
  );

  it.each([
    ['query', '--json', '{}', '--json-file', '-'],
    ['query', '--text', 'x'],
    ['query', '--output', 'x', '--json', '{}'],
    ['execute'],
    ['agent', 'create', '--text', 'x', '--no-start'],
    ['agent', 'create', 'extra', '--json', '{}'],
    ['agent', 'prompt', '--text', 'x'],
    ['agent', 'prompt', 't', '--text', 'x', '--no-start'],
    ['agent', 'profiles', '--json', '{}'],
    ['download', '../file'],
    ['download', 'nodes//file'],
    ['upload', 'a/b', '--file', '-'],
    ['upload', 'a'],
    ['capabilities'],
  ])('rejects invalid input locally: %j', async (...args) => {
    let count = 0;
    const env = await server((_request, response) => {
      count++;
      response.end();
    });
    const result = await call(args, env);
    expect(result.code).toBe(1);
    expect(result.stderr).not.toBe('');
    expect(count).toBe(0);
  });

  it.each(['json', 'text', 'json-file', 'text-file'])(
    'forwards Agent %s input unchanged',
    async (source) => {
      const content = source.startsWith('json')
        ? ' \n{"prompt":"x","future":42}\n'
        : 'hello\r\nworld\n';
      const env = await server((request, response) => {
        expect(request.url).toBe('/rfs/space/agent');
        expect(request.headers['content-type']).toBe(
          source.startsWith('json') ? 'application/json' : 'text/plain',
        );
        expect(request.headers['x-huabu-host-thread-id']).toBe('host-thread');
        void bytes(request).then((body) => {
          expect(body.toString()).toBe(content);
          response.end(
            'event: error\ndata: {"message":"business failure"}\n\n',
          );
        });
      });
      const result = await call(
        [
          'agent',
          'create',
          `--${source}`,
          source.endsWith('file') ? '-' : content,
        ],
        env,
        Buffer.from(content),
      );
      expect(result.code).toBe(0);
      expect(result.stdout.toString()).toContain('event: error');
    },
  );

  it('uses JSON create-only header without rewriting body and reads actual files', async () => {
    const file = join(await directory(), 'body.json');
    const original = '{"future":1,"prompt":"Server should validate this"}\n';
    await writeFile(file, original);
    const env = await server((request, response) => {
      expect(request.headers['x-huabu-agent-start']).toBe('false');
      void bytes(request).then((body) => {
        expect(body.toString()).toBe(original);
        response.end('{"nodeId":"n"}');
      });
    });
    expect(
      (await call(['agent', 'create', '--no-start', '--json-file', file], env))
        .code,
    ).toBe(0);
  });

  it('streams raw SSE before EOF and does not require done/end events', async () => {
    let first!: () => void;
    const observed = new Promise<void>((resolve) => {
      first = resolve;
    });
    let finish!: () => void;
    const env = await server((request, response) => {
      expect(request.url).toBe('/rfs/space/agent/a%20b%252F/prompt');
      expect(request.headers['x-huabu-host-thread-id']).toBeUndefined();
      response.setHeader('content-type', 'text/event-stream');
      response.write(': heartbeat\n\nevent: custom\ndata: {"unknown":1}\n\n');
      finish = () => response.end('data: last\n\n');
    });
    const stdout = output(() => first());
    let settled = false;
    const promise = runRfs(['agent', 'prompt', 'a b%2F', '--text', 'hello'], {
      env,
      stdout: stdout.stream,
      stderr: output().stream,
    }).then((code) => {
      settled = true;
      return code;
    });
    await observed;
    expect(settled).toBe(false);
    expect(stdout.text()).toBe(
      ': heartbeat\n\nevent: custom\ndata: {"unknown":1}\n\n',
    );
    finish();
    expect(await promise).toBe(0);
    expect(stdout.text()).toContain('data: last');
  });

  it('streams binary file/stdin uploads with exactly-once encoding', async () => {
    const payload = Buffer.from([0, 255, 10, 13, 128, 42]);
    const file = join(await directory(), 'upload.bin');
    await writeFile(file, payload);
    const env = await server((request, response) => {
      expect(request.url).toBe('/rfs/space/upload/a%20%2520.bin');
      void bytes(request).then((body) => {
        expect(body).toEqual(payload);
        response.end('{"unknown":"untouched"}');
      });
    });
    for (const source of [file, '-']) {
      const result = await call(
        ['upload', 'a %20.bin', '--file', source],
        env,
        payload,
      );
      expect(result.code).toBe(0);
      expect(result.stdout.toString()).toBe('{"unknown":"untouched"}');
    }
  });

  it('replaces only a complete download, dumps metadata, and preserves cached target on 304', async () => {
    const folder = await directory();
    const target = join(folder, 'body');
    const headers = join(folder, 'headers');
    await writeFile(target, 'old');
    const env = await server((request, response) => {
      expect(request.url).toBe('/rfs/space/download/nodes/a%20%2520.md');
      response.setHeader('etag', '"revision"');
      response.setHeader('x-huabu-node-id', 'node-1');
      if (request.headers['if-none-match']) {
        response.writeHead(304);
        response.end();
      } else response.end(Buffer.from([0, 255, 10]));
    });
    const args = [
      'download',
      'nodes/a %20.md',
      '--output',
      target,
      '--dump-header',
      headers,
    ];
    expect((await call(args, env)).code).toBe(0);
    expect(await readFile(target)).toEqual(Buffer.from([0, 255, 10]));
    expect(await readFile(headers, 'utf8')).toContain('etag: "revision"');
    expect(await readFile(headers, 'utf8')).toContain(
      'x-huabu-node-id: node-1',
    );
    expect(
      (await call([...args, '--if-none-match', '"revision"'], env)).code,
    ).toBe(0);
    expect(await readFile(target)).toEqual(Buffer.from([0, 255, 10]));
    expect(await readFile(headers, 'utf8')).toContain('HTTP 304');
    expect(await readdir(folder)).toEqual(['body', 'headers']);
  });

  it('preserves target on truncated transport and reports error bodies only on stdout', async () => {
    const folder = await directory();
    const target = join(folder, 'body');
    await writeFile(target, 'old');
    let partial = true;
    const env = await server((_request, response) => {
      if (partial) {
        response.setHeader('content-length', '100');
        response.write('partial');
        setTimeout(() => response.destroy(), 10);
      } else {
        response.writeHead(403);
        response.end('raw HTTP error');
      }
    });
    const args = ['download', 'nodes/a', '--output', target];
    expect((await call(args, env)).code).toBe(1);
    expect(await readFile(target, 'utf8')).toBe('old');
    partial = false;
    const result = await call(args, env);
    expect(result.code).toBe(1);
    expect(result.stdout.toString()).toBe('raw HTTP error');
    expect(await readFile(target, 'utf8')).toBe('old');
    expect(await readdir(folder)).toEqual(['body']);
  });

  it('does not follow redirects or forward credentials to another server', async () => {
    let redirected = 0;
    const target = await server((_request, response) => {
      redirected++;
      response.end('bad');
    });
    const env = await server((_request, response) => {
      response.writeHead(302, { location: target.HUABU_RFS_URL });
      response.end('redirect body');
    });
    const result = await call(['get-skill'], env);
    expect(result.code).toBe(1);
    expect(result.stdout.toString()).toBe('redirect body');
    expect(redirected).toBe(0);
  });

  it.each([
    [['query', '--help'], '/capabilities'],
    [['query', '--help', 'QUERY'], '/capabilities/queries/QUERY'],
    [['execute', '--help', 'CMD'], '/capabilities/commands/CMD'],
    [['agent', '--help'], '/skill/agents'],
  ])('combines local/live help at the exact endpoint', async (args, path) => {
    const env = await server((request, response) => {
      expect(request.url).toBe(`/rfs/space${path}`);
      response.end('live contract');
    });
    const result = await call(args, env);
    expect(result.code).toBe(0);
    expect(result.stdout.toString()).toContain('Huabu RFS');
    expect(result.stdout.toString()).toContain(`GET ${path}\nlive contract`);
  });

  it('marks absent/auth-failed/timed-out live help without changing help exit status', async () => {
    let stall = false;
    const env = await server((_request, response) => {
      if (!stall) {
        response.writeHead(401);
        response.end('denied');
      }
    });
    for (const current of [{}, env]) {
      const result = await call(['--help'], current);
      expect(result.code).toBe(0);
      expect(result.stderr).toContain('Live Server contract unavailable');
      expect(result.stdout.toString()).not.toContain('denied');
    }
    stall = true;
    const result = await call(['--help'], env, Buffer.alloc(0), {
      helpTimeoutMs: 20,
    });
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('Live Server contract unavailable');
  });

  it('rejects unsafe header/env and missing input files before issuing requests', async () => {
    let count = 0;
    const env = await server((_request, response) => {
      count++;
      response.end();
    });
    for (const changed of [
      { ...env, HUABU_THREAD_ID: 'unsafe\r\nheader' },
      { ...env, AGENTLET_TOKEN: 'private\nsecret' },
      { ...env, HUABU_RFS_URL: 'ftp://example.test' },
    ])
      expect((await call(['execute', '--json', '{}'], changed)).code).toBe(1);
    expect(
      (
        await call(
          ['upload', 'x', '--file', '/nonexistent-huabu-rfs-file'],
          env,
        )
      ).code,
    ).toBe(1);
    expect(count).toBe(0);
  });

  it('warns for absent correlation but continues, and reports ambiguous network mutations', async () => {
    const env = await server((_request, response) => {
      response.end('okay');
    });
    delete (env as NodeJS.ProcessEnv).HUABU_THREAD_ID;
    const result = await call(['execute', '--json', '{}'], env);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('proceeding without host-thread');
    const dropped = await server((request) => {
      request.socket.destroy();
    });
    const unknown = await call(['execute', '--json', '{}'], dropped);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('Remote outcome may be unknown');
    expect(unknown.stderr).not.toContain('private-token');
  });

  it('aborts local SSE delivery without pretending to cancel remote work', async () => {
    let first!: () => void;
    const observed = new Promise<void>((resolve) => {
      first = resolve;
    });
    const env = await server((_request, response) => {
      response.write(': running\n\n');
    });
    const controller = new AbortController();
    const stdout = output(() => first());
    const stderr = output();
    const pending = runRfs(['agent', 'prompt', 't', '--text', 'hello'], {
      env,
      stdout: stdout.stream,
      stderr: stderr.stream,
      signal: controller.signal,
    });
    await observed;
    controller.abort();
    expect(await pending).toBe(130);
    expect(stderr.text()).toContain('does not cancel remote work');
    expect(stderr.text()).toContain('Remote outcome may be unknown');
  });
});
