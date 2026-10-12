// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { constants } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { parse } from 'dotenv';

import {
  buildDaemonChildEnv,
  buildHuabuBootstrapEnv,
  resolveRuntimeArtifacts,
} from './bootstrap.js';
import { normalizePublicOrigin } from './public-origin.js';

const CONNECTION_KEYS = new Set([
  'HUABU_PUBLIC_ORIGIN',
  'HUABU_CONNECTION_TOKEN',
]);

export function parseConnectionEnvFile(
  text: string,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  if (text.includes('\0')) throw new Error('Environment file contains NUL');
  const result: Record<string, string> = {};
  const seen = new Set<string>();
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    let statement = lines[index] ?? '';
    if (!statement.trim() || statement.trimStart().startsWith('#')) continue;
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      statement,
    );
    if (!match)
      throw new Error(`Invalid environment assignment at line ${index + 1}`);
    const key = match[1];
    const value = match[2] ?? '';
    if (!key) throw new Error('Invalid environment key');
    const canonical = platform === 'win32' ? key.toUpperCase() : key;
    if (seen.has(canonical))
      throw new Error(`Duplicate environment key: ${key}`);
    seen.add(canonical);
    const quote = value[0];
    if (quote === '"' || quote === "'" || quote === '`') {
      let quoted = value;
      let closing = -1;
      while (closing < 0) {
        for (let offset = 1; offset < quoted.length; offset++) {
          if (quoted[offset] !== quote) continue;
          let slashes = 0;
          for (
            let before = offset - 1;
            before >= 0 && quoted[before] === '\\';
            before--
          )
            slashes++;
          if (slashes % 2 === 0) {
            closing = offset;
            break;
          }
        }
        if (closing < 0) {
          index++;
          if (index >= lines.length)
            throw new Error(`Unclosed environment value for ${key}`);
          quoted += `\n${lines[index]}`;
          statement += `\n${lines[index]}`;
        }
      }
      const trailing = quoted.slice(closing + 1).trim();
      if (trailing && !trailing.startsWith('#'))
        throw new Error(`Invalid environment value for ${key}`);
    }
    const parsed = parse(statement);
    if (!Object.hasOwn(parsed, key))
      throw new Error(`Invalid environment value for ${key}`);
    if (CONNECTION_KEYS.has(canonical)) {
      result[canonical] = parsed[key] ?? '';
    }
  }
  return result;
}

export function readConnectionConfig(options: {
  repoRoot: string;
  envFile?: string;
  inherited?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): { origin: string; token: string } {
  const platform = options.platform ?? process.platform;
  if (options.envFile !== undefined && !options.envFile.trim())
    throw new Error('--env-file requires a non-empty path');
  const path = options.envFile
    ? resolve(options.envFile)
    : resolve(options.repoRoot, '.env');
  let fileEnv: Record<string, string> = {};
  try {
    fileEnv = parseConnectionEnvFile(readFileSync(path, 'utf8'), platform);
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT' &&
        !options.envFile
      )
    )
      throw error;
  }
  const inherited: Record<string, string | undefined> = {};
  if (!options.envFile) {
    for (const [key, value] of Object.entries(
      options.inherited ?? process.env,
    )) {
      const canonical = platform === 'win32' ? key.toUpperCase() : key;
      if (!CONNECTION_KEYS.has(canonical)) continue;
      if (Object.hasOwn(inherited, canonical))
        throw new Error(`Duplicate environment key: ${canonical}`);
      inherited[canonical] = value;
    }
  }
  const connection = { ...fileEnv, ...inherited };
  const token = connection.HUABU_CONNECTION_TOKEN;
  const origin = connection.HUABU_PUBLIC_ORIGIN;
  if (!origin?.trim())
    throw new Error('huabu-daemon requires HUABU_PUBLIC_ORIGIN');
  if (!token?.trim())
    throw new Error('huabu-daemon requires HUABU_CONNECTION_TOKEN');
  return { origin: normalizePublicOrigin(origin), token };
}

export function parseDaemonArgs(argv: string[]) {
  return parseArgs({
    args: argv[0] === '--' ? argv.slice(1) : argv,
    options: {
      help: { type: 'boolean', short: 'h' },
      'env-file': { type: 'string' },
      'max-agents': { type: 'string' },
      'agentlet-id': { type: 'string' },
      'reconnect-max': { type: 'string' },
      'buffer-limit': { type: 'string' },
      heartbeat: { type: 'string' },
      'log-level': { type: 'string' },
      'log-file': { type: 'string' },
    },
    allowPositionals: false,
    strict: true,
  }).values;
}

export async function runDaemon(
  argv = process.argv.slice(2),
  repoRoot = fileURLToPath(new URL('../../../', import.meta.url)),
): Promise<number> {
  const options = parseDaemonArgs(argv);
  if (options.help) {
    process.stdout.write(
      'Usage: pnpm start:daemon [--env-file <path>] [Agentlet operational options]\nConnection: HUABU_PUBLIC_ORIGIN and HUABU_CONNECTION_TOKEN, via process env or dotenv.\nOptions: --max-agents, --agentlet-id, --reconnect-max, --buffer-limit, --heartbeat, --log-level, --log-file.\n',
    );
    return 0;
  }
  const { origin, token } = readConnectionConfig({
    repoRoot,
    envFile: options['env-file'],
  });
  const server = new URL('/api/acp/agent', origin);
  const insecure = server.protocol === 'http:';
  server.protocol = insecure ? 'ws:' : 'wss:';
  const artifacts = resolveRuntimeArtifacts({ repoRoot });
  if (!artifacts.daemonEntry || !artifacts.serviceSdkEntry)
    throw new Error(
      'Missing built Agentlet/client-runtime artifacts; run pnpm start:daemon from a prepared checkout',
    );
  const bootstrap = buildHuabuBootstrapEnv(artifacts);
  const args = [
    'daemon',
    '--server',
    server.href,
    ...(insecure ? ['--allow-insecure'] : []),
    ...Object.entries(bootstrap).flatMap(([key, value]) => [
      '--env-inject',
      `${key}=${value}`,
    ]),
  ];
  for (const [key, value] of Object.entries(options)) {
    if (key === 'env-file' || key === 'help' || typeof value !== 'string')
      continue;
    args.push(`--${key}`, value);
  }
  if (insecure)
    process.stderr.write(
      'Warning: HTTP/WS sends the connection credential without TLS.\n',
    );
  const child = spawn(process.execPath, [artifacts.daemonEntry, ...args], {
    env: buildDaemonChildEnv(process.env, token),
    stdio: 'inherit',
    shell: false,
  });
  const interrupt = () => {
    child.kill('SIGINT');
  };
  const terminate = () => {
    child.kill('SIGTERM');
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    return await new Promise<number>((complete, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) =>
        complete(signal ? 128 + constants.signals[signal] : (code ?? 1)),
      );
    });
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  runDaemon()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
