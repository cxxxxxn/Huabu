// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const usage = `Huabu RFS (optional Node client)
  get-skill [skillId]
  query   --json STRING | --json-file PATH|-
  execute --json STRING | --json-file PATH|-
  download LOGICAL_PATH [--output PATH] [--dump-header PATH] [--if-none-match ETAG]
  upload NAME --file PATH|-
  agent profiles
  agent create [--no-start] INPUT
  agent prompt THREAD_ID INPUT
INPUT: exactly one of --text STRING, --json STRING, --text-file PATH|-, --json-file PATH|-
Use --help; query/execute --help TYPE loads that operation's current contract.
Required environment: HUABU_RFS_URL, AGENTLET_TOKEN.
execute/agent create correlate HUABU_THREAD_ID when set.
Response bodies and SSE are raw; exit 0 means HTTP success/normal EOF, not business success.
No redirects, retries, reconnects or remote cancellation. Inspect business results yourself.
`;

const options = {
  help: { type: 'boolean', short: 'h' },
  json: { type: 'string' },
  'json-file': { type: 'string' },
  text: { type: 'string' },
  'text-file': { type: 'string' },
  file: { type: 'string' },
  output: { type: 'string' },
  'dump-header': { type: 'string' },
  'if-none-match': { type: 'string' },
  'no-start': { type: 'boolean' },
} as const;
type Values = ReturnType<typeof parseCli>['values'];
function parseCli(args: string[]) {
  return parseArgs({ args, options, allowPositionals: true, strict: true });
}

function segment(value: string | undefined): string {
  if (!value || value === '.' || value === '..' || /[\\/\0]/.test(value))
    throw new Error(
      'Expected one nonempty logical path segment, not a URL or traversal',
    );
  return encodeURIComponent(value);
}
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
function allow(values: Values, permitted: string[]) {
  for (const name of Object.keys(values))
    if (name !== 'help' && !permitted.includes(name))
      throw new Error(`Unsupported option --${name} for this command`);
}
async function input(
  values: Values,
  stdin: Readable,
  jsonOnly: boolean,
  signal: AbortSignal,
) {
  const names = ['json', 'json-file', 'text', 'text-file'] as const;
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
  const bytes = name.endsWith('-file')
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
) {
  async function* bytes() {
    if (!response.body) return;
    const reader = response.body.getReader();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) return;
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
  try {
    const { values, positionals } = parseCli(args);
    const [command, ...rest] = positionals;
    const commands = [
      'get-skill',
      'query',
      'execute',
      'download',
      'upload',
      'agent',
    ];
    if (command && !commands.includes(command))
      throw new Error(`Unknown command ${command}`);
    if (!command || values.help) {
      stdout.write(usage);
      let path = '/skill';
      if (command === 'query' || command === 'execute') {
        if (rest.length > 1)
          throw new Error('Help accepts at most one operation type');
        path = rest[0]
          ? `/capabilities/${command === 'query' ? 'queries' : 'commands'}/${segment(rest[0])}`
          : '/capabilities';
      } else if (command === 'agent') path = '/skill/agents';
      try {
        const config = connection(env);
        const response = await fetch(`${config.base}${path}`, {
          headers: config.headers,
          redirect: 'manual',
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(io.helpTimeoutMs ?? 3000),
          ]),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const contract = await response.text();
        stdout.write(`\nLive Server contract - GET ${path}\n${contract}\n`);
      } catch (error) {
        diagnostic(
          `Live Server contract unavailable: ${error instanceof Error ? error.message : String(error)}. Local usage only.`,
        );
      }
      return 0;
    }
    const config = connection(env);
    const headers: Record<string, string> = { ...config.headers };
    let path: string;
    let method = 'GET';
    let body: RequestInit['body'];
    let duplex: 'half' | undefined;
    if (command === 'get-skill') {
      allow(values, []);
      if (rest.length > 1)
        throw new Error('get-skill accepts at most one skill ID');
      path = rest[0] ? `/skill/${segment(rest[0])}` : '/skill';
    } else if (command === 'query' || command === 'execute') {
      allow(values, ['json', 'json-file']);
      if (rest.length)
        throw new Error(`${command} takes no positional arguments`);
      const source = await input(values, stdin, true, signal);
      body = new Uint8Array(source.bytes);
      headers['Content-Type'] = source.contentType;
      path = `/${command}`;
      method = 'POST';
      mutation = command === 'execute';
    } else if (command === 'download') {
      allow(values, ['output', 'dump-header', 'if-none-match']);
      const [logicalPath] = rest;
      if (rest.length !== 1 || logicalPath === undefined)
        throw new Error('download requires one logical path');
      path = `/download/${logicalPath.split('/').map(segment).join('/')}`;
      if (values['if-none-match'] !== undefined)
        headers['If-None-Match'] = header(
          values['if-none-match'],
          '--if-none-match',
        );
      if (values.output === '' || values['dump-header'] === '')
        throw new Error('Output paths must be nonempty');
      if (
        values.output &&
        values['dump-header'] &&
        resolve(values.output) === resolve(values['dump-header'])
      )
        throw new Error('--output and --dump-header must use different paths');
    } else if (command === 'upload') {
      allow(values, ['file']);
      if (rest.length !== 1 || values.file === undefined || values.file === '')
        throw new Error('upload requires one name and --file PATH|-');
      path = `/upload/${segment(rest[0])}`;
      uploadStream =
        values.file === '-' ? stdin : createReadStream(values.file);
      if (values.file !== '-') await once(uploadStream, 'open');
      body = streamBody(uploadStream);
      duplex = 'half';
      headers['Content-Type'] = 'application/octet-stream';
      method = 'POST';
      mutation = true;
    } else {
      const [operation, threadId] = rest;
      if (operation === 'profiles') {
        allow(values, []);
        if (rest.length !== 1)
          throw new Error('agent profiles takes no further arguments');
        path = '/agent/profiles';
      } else if (operation === 'create' || operation === 'prompt') {
        allow(values, [
          'json',
          'json-file',
          'text',
          'text-file',
          ...(operation === 'create' ? ['no-start'] : []),
        ]);
        if (rest.length !== (operation === 'create' ? 1 : 2))
          throw new Error(
            'agent create takes no thread ID; agent prompt requires one',
          );
        const source = await input(
          values,
          stdin,
          values['no-start'] === true,
          signal,
        );
        body = new Uint8Array(source.bytes);
        headers['Content-Type'] = source.contentType;
        if (values['no-start']) headers['X-Huabu-Agent-Start'] = 'false';
        path =
          operation === 'create'
            ? '/agent'
            : `/agent/${segment(threadId)}/prompt`;
        method = 'POST';
        mutation = true;
      } else throw new Error('agent requires profiles, create or prompt');
    }
    if (
      command === 'execute' ||
      (command === 'agent' && rest[0] === 'create')
    ) {
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
    sent = true;
    const init: RequestInit & { duplex?: 'half' } = {
      method,
      headers,
      body,
      duplex,
      redirect: 'manual',
      signal,
    };
    const response = await fetch(`${config.base}${path}`, init);
    if (command === 'download' && values['dump-header']) {
      const lines = [
        `HTTP ${response.status} ${response.statusText}`,
        ...Array.from(response.headers, ([key, value]) => `${key}: ${value}`),
        '',
        '',
      ];
      await writeFile(values['dump-header'], lines.join('\r\n'));
    }
    if (command === 'download' && response.status === 304) return 0;
    if (response.ok && command === 'download' && values.output) {
      const target = resolve(values.output);
      temporary = await mkdtemp(join(dirname(target), '.huabu-rfs-'));
      await deliver(
        response,
        createWriteStream(join(temporary, 'body'), { flags: 'wx' }),
        true,
      );
      await rename(join(temporary, 'body'), target);
    } else await deliver(response, stdout, false);
    if (!response.ok)
      diagnostic(`HTTP ${response.status}; response body is on stdout.`);
    return response.ok ? 0 : 1;
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
