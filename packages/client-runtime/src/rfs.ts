// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

import { CommanderError } from 'commander';

import { serviceParamsSchema } from '@huabu/shared/service-package';

import {
  createRfsProgram,
  segment,
  type InputOptions,
  type DownloadOptions,
} from './rfs-cli.js';
import { installServicePackage } from './rfs-service.js';

function header(value: string, name: string): string {
  if (!value || /[^\x20-\x7e\x80-\xff]/.test(value))
    throw new Error(`${name} is not a safe HTTP header value`);
  return value;
}
function connection(env: NodeJS.ProcessEnv) {
  if (!env.HUABU_RFS_URL || !env.AGENTLET_TOKEN)
    throw new Error('HUABU_RFS_URL and AGENTLET_TOKEN are required');
  let url: URL;
  try {
    url = new URL(env.HUABU_RFS_URL);
  } catch {
    throw new Error('HUABU_RFS_URL must be an HTTP(S) base URL');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      'HUABU_RFS_URL must be an HTTP(S) base URL without credentials, query or fragment',
    );
  return {
    base: url.href.replace(/\/+$/, ''),
    headers: {
      Authorization: header(`Bearer ${env.AGENTLET_TOKEN}`, 'AGENTLET_TOKEN'),
    },
  };
}
async function input(
  values: InputOptions,
  stdin: Readable,
  jsonOnly: boolean,
  signal: AbortSignal,
) {
  const names = ['json', 'jsonFile', 'text', 'textFile'] as const;
  const selected = names.filter((name) => values[name] !== undefined);
  const [name] = selected;
  if (selected.length !== 1 || name === undefined)
    throw new Error(
      'Provide exactly one input: --json, --json-file, --text or --text-file',
    );
  if (jsonOnly && !name.startsWith('json'))
    throw new Error('This command requires a JSON input source');
  const value = values[name];
  if (value === undefined) throw new Error('Input source is missing');
  const bytes = name.endsWith('File')
    ? value === '-'
      ? await collect(stdin, signal)
      : await readFile(value)
    : Buffer.from(value);
  return {
    bytes,
    contentType: name.startsWith('json') ? 'application/json' : 'text/plain',
  };
}
async function collect(stream: Readable, signal: AbortSignal): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await pipeline(
    stream,
    new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }),
    { signal },
  );
  return Buffer.concat(chunks);
}
async function deliver(
  response: Response,
  destination: Writable,
  end: boolean,
  maximumBytes = Infinity,
) {
  async function* bytes() {
    if (!response.body) return;
    const reader = response.body.getReader();
    let received = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) return;
        received += result.value.byteLength;
        if (received > maximumBytes)
          throw new Error('Service archive exceeds download size limit');
        yield result.value;
      }
    } finally {
      try {
        await reader.cancel();
      } finally {
        reader.releaseLock();
      }
    }
  }
  await pipeline(Readable.from(bytes()), destination, { end });
}
function streamBody(source: Readable): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(controller) {
      const result = await iterator.next();
      if (result.done) controller.close();
      else if (typeof result.value === 'string')
        controller.enqueue(new Uint8Array(Buffer.from(result.value)));
      else if (result.value instanceof Uint8Array)
        controller.enqueue(new Uint8Array(result.value));
      else throw new Error('Upload input must contain bytes');
    },
    async cancel() {
      source.destroy();
      await iterator.return?.();
    },
  });
}

export interface RfsIO {
  env?: NodeJS.ProcessEnv;
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
  signal?: AbortSignal;
  helpTimeoutMs?: number;
}

export async function runRfs(args: string[], io: RfsIO = {}): Promise<number> {
  const env = io.env ?? process.env;
  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const controller = new AbortController();
  const signal = io.signal
    ? AbortSignal.any([io.signal, controller.signal])
    : controller.signal;
  let mutation = false;
  let sent = false;
  let uploadStream: Readable | undefined;
  let temporary: string | undefined;
  const diagnostic = (message: string) =>
    stderr.write(`huabu-rfs: ${message}\n`);
  let code = 0;
  interface Request {
    path: string;
    method?: string;
    body?: RequestInit['body'];
    duplex?: 'half';
    headers?: Record<string, string>;
    mutation?: boolean;
    correlate?: boolean;
    download?: DownloadOptions;
    usage?: string;
    service?: { id: string; folder: string };
  }
  async function send(request: Request) {
    const config = connection(env);
    const headers: Record<string, string> = {
      ...config.headers,
      ...request.headers,
    };
    if (request.correlate) {
      if (env.HUABU_THREAD_ID !== undefined)
        headers['X-Huabu-Host-Thread-Id'] = header(
          env.HUABU_THREAD_ID,
          'HUABU_THREAD_ID',
        );
      else
        diagnostic(
          'HUABU_THREAD_ID is absent; proceeding without host-thread correlation.',
        );
    }
    mutation = request.mutation === true;
    sent = true;
    const init: RequestInit & { duplex?: 'half' } = {
      method: request.method ?? 'GET',
      headers,
      body: request.body,
      duplex: request.duplex,
      redirect: 'manual',
      signal,
    };
    const response = await fetch(`${config.base}${request.path}`, init);
    const download = request.download;
    if (download?.dumpHeader) {
      const lines = [
        `HTTP ${response.status} ${response.statusText}`,
        ...Array.from(response.headers, ([key, value]) => `${key}: ${value}`),
        '',
        '',
      ];
      await writeFile(download.dumpHeader, lines.join('\r\n'));
    }
    if (download && response.status === 304) return;
    if (response.ok && request.service) {
      const target = await installServicePackage(
        request.service.id,
        request.service.folder,
        (file, limit) =>
          deliver(
            response,
            createWriteStream(file, { flags: 'wx', mode: 0o600 }),
            true,
            limit,
          ),
        signal,
      );
      stdout.write(`${target}\n`);
    } else if (response.ok && download?.output) {
      const target = resolve(download.output);
      temporary = await mkdtemp(join(dirname(target), '.huabu-rfs-'));
      await deliver(
        response,
        createWriteStream(join(temporary, 'body'), { flags: 'wx' }),
        true,
      );
      await rename(join(temporary, 'body'), target);
    } else {
      if (response.ok && request.usage) stdout.write(request.usage);
      await deliver(response, stdout, false);
    }
    if (!response.ok)
      diagnostic(`HTTP ${response.status}; response body is on stdout.`);
    code = response.ok ? 0 : 1;
  }
  async function post(
    path: string,
    options: InputOptions,
    jsonOnly: boolean,
    correlate = false,
  ) {
    const source = await input(
      options,
      stdin,
      jsonOnly || options.noStart === true,
      signal,
    );
    await send({
      path,
      method: 'POST',
      body: new Uint8Array(source.bytes),
      headers: {
        'Content-Type': source.contentType,
        ...(options.noStart ? { 'X-Huabu-Agent-Start': 'false' } : {}),
      },
      mutation: path !== '/query',
      correlate,
    });
  }
  function serviceId(id: string) {
    const parsed = serviceParamsSchema.safeParse({ serviceId: id });
    if (!parsed.success) throw new Error('Invalid Service id');
    return parsed.data.serviceId;
  }
  async function liveHelp() {
    const plan = cli.liveHelp();
    const config = (() => {
      try {
        return connection(env);
      } catch (error) {
        diagnostic(
          `Live Server contract unavailable: ${error instanceof Error ? error.message : String(error)}. Local usage only.`,
        );
        return undefined;
      }
    })();
    if (!config) return;
    const helpSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(io.helpTimeoutMs ?? 3000),
    ]);
    for (const path of [plan.guide, plan.capability].filter(
      (value): value is string => value !== undefined,
    )) {
      try {
        const response = await fetch(`${config.base}${path}`, {
          headers: config.headers,
          redirect: 'manual',
          signal: helpSignal,
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`HTTP ${response.status}`);
        }
        const text = await response.text();
        stdout.write(`\nLive Server contract - GET ${path}\n${text}\n`);
      } catch (error) {
        diagnostic(
          `Live Server contract unavailable (${path}): ${error instanceof Error ? error.message : String(error)}. Live help may be incomplete; local usage remains available.`,
        );
      }
    }
  }
  const cli = createRfsProgram(
    {
      rootHelp: async () => {
        cli.program.outputHelp();
        await liveHelp();
      },
      getSkill: (id, usage) =>
        send({
          path: id ? `/skill/${segment(id)}` : '/skill/rfs',
          usage: id ? undefined : usage,
        }),
      query: (options) => post('/query', options, true),
      execute: (options) => post('/execute', options, true, true),
      download: async (path, options) => {
        const url = `/download/${path.split('/').map(segment).join('/')}`;
        if (options.output === '' || options.dumpHeader === '')
          throw new Error('Output paths must be nonempty');
        if (
          options.output &&
          options.dumpHeader &&
          resolve(options.output) === resolve(options.dumpHeader)
        )
          throw new Error(
            '--output and --dump-header must use different paths',
          );
        await send({
          path: url,
          download: options,
          headers:
            options.ifNoneMatch === undefined
              ? undefined
              : {
                  'If-None-Match': header(
                    options.ifNoneMatch,
                    '--if-none-match',
                  ),
                },
        });
      },
      upload: async (name, file) => {
        const path = `/upload/${segment(name)}`;
        if (!file) throw new Error('Upload file path must be nonempty');
        uploadStream = file === '-' ? stdin : createReadStream(file);
        if (file !== '-') await once(uploadStream, 'open');
        await send({
          path,
          method: 'POST',
          body: streamBody(uploadStream),
          duplex: 'half',
          headers: { 'Content-Type': 'application/octet-stream' },
          mutation: true,
        });
      },
      profiles: () => send({ path: '/agent/profiles' }),
      create: (options) => post('/agent', options, false, true),
      prompt: (thread, options) =>
        post(`/agent/${segment(thread)}/prompt`, options, false),
      services: () => send({ path: '/services' }),
      serviceSkill: (id) => send({ path: `/services/${serviceId(id)}/skill` }),
      serviceManifest: (id) =>
        send({ path: `/services/${serviceId(id)}/manifest` }),
      serviceDownload: async (id, folder) => {
        if (!folder) throw new Error('--out-folder must be nonempty');
        const validId = serviceId(id);
        await send({
          path: `/download/services/${validId}.zip`,
          service: { id: validId, folder },
        });
      },
    },
    (text) => {
      stdout.write(text);
    },
  );
  try {
    try {
      await cli.program.parseAsync(args, { from: 'user' });
    } catch (error) {
      if (
        !(error instanceof CommanderError) ||
        error.code !== 'commander.helpDisplayed'
      )
        throw error;
      await liveHelp();
    }
    return code;
  } catch (error) {
    controller.abort();
    diagnostic(
      signal.aborted && io.signal?.aborted
        ? 'Local delivery interrupted; this does not cancel remote work.'
        : error instanceof Error
          ? error.message
          : String(error),
    );
    if (mutation && sent)
      diagnostic(
        'Remote outcome may be unknown. Inspect state before any further mutation; do not blindly resend.',
      );
    return io.signal?.aborted ? 130 : 1;
  } finally {
    if (uploadStream && uploadStream !== stdin) uploadStream.destroy();
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  process.exitCode = await runRfs(process.argv.slice(2), {
    signal: controller.signal,
  });
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
