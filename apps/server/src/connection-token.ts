// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { randomBytes } from 'node:crypto';

import { getDaemonAuth } from '@agenetes/agentlet-host';
import { parse } from 'dotenv';

import { getExternalAgentRuntimeConfig } from './modules/agent/acp/runtime-config.js';
import {
  normalizePublicOrigin,
  resolveConfiguredPublicOrigin,
} from './modules/security/public-origin.js';

import type {
  AgentletConnectionCommandResponse,
  AgentletConnectionCommandRequest,
  ConnectionTokenSource,
} from '@huabu/shared';

/**
 * The global connection token used to authenticate the embedded
 * agentlet transport (L2 `@agenetes/agentlet-host`) and every agent
 * reachback that reuses it (e.g. the `/api/rfs/*` bearer gate).
 *
 * This is L1-owned config injected downward via `mountAgenetes()`.
 * Unlike the previous per-fork mint, it is stable for the lifetime of
 * the server process, so agent reachback credentials survive an
 * agentlet daemon restart.
 *
 * The environment/generated choice is captured at first use during module
 * composition. Persisted overrides are deliberately ignored and retained.
 */
let generatedToken: string | null = null;
let activeToken: string | null = null;
let activeSource: ConnectionTokenSource | null = null;

function getGeneratedToken(): string {
  generatedToken ??= randomBytes(32).toString('hex');
  return generatedToken;
}

function getEnvironmentToken(): string | null {
  return process.env.HUABU_CONNECTION_TOKEN?.trim() || null;
}

function resolveFallback(): {
  token: string;
  source: ConnectionTokenSource;
} {
  const environment = getEnvironmentToken();
  return environment
    ? { token: environment, source: 'environment' }
    : { token: getGeneratedToken(), source: 'generated' };
}

export function getConnectionToken(): string {
  if (activeToken) return activeToken;
  const fallback = resolveFallback();
  activeToken = fallback.token;
  activeSource = fallback.source;
  return activeToken;
}

export function initializeConnectionToken(): void {
  getDaemonAuth().setDaemonToken(getConnectionToken());
}

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

export class InvalidAgentletConnectionOriginError extends Error {}
export class InvalidAgentletConnectionEnvFileError extends Error {}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function dotenvValue(key: string, value: string): string {
  for (const quote of ["'", '`', '"', '']) {
    if (quote && value.includes(quote)) continue;
    const line = `${key}=${quote}${value}${quote}\n`;
    if (parse(line)[key] === value) return line;
  }
  throw new InvalidAgentletConnectionEnvFileError(
    'This credential cannot be represented safely in a dotenv file; use Copy connection command instead',
  );
}

export function buildAgentletConnectionCommand(
  request: AgentletConnectionCommandRequest,
): AgentletConnectionCommandResponse {
  let normalizedOrigin: string;
  try {
    const browserOrigin = normalizePublicOrigin(request.origin);
    normalizedOrigin = resolveConfiguredPublicOrigin() ?? browserOrigin;
  } catch {
    throw new InvalidAgentletConnectionOriginError(
      'Origin must be an HTTP(S) origin without a path',
    );
  }
  const origin = new URL(normalizedOrigin);
  const insecure = origin.protocol === 'http:';
  const token = getConnectionToken();
  let content: string;
  if (request.format === 'env-file') {
    content =
      dotenvValue('HUABU_PUBLIC_ORIGIN', normalizedOrigin) +
      dotenvValue('HUABU_CONNECTION_TOKEN', token);
  } else if (request.shell === 'posix') {
    const maxAgents = getExternalAgentRuntimeConfig().maxAgents;
    content = `HUABU_PUBLIC_ORIGIN=${quotePosix(normalizedOrigin)} HUABU_CONNECTION_TOKEN=${quotePosix(token)} pnpm start:daemon --max-agents ${maxAgents}`;
  } else {
    const maxAgents = getExternalAgentRuntimeConfig().maxAgents;
    content = [
      '& {',
      "  $huabuPreviousOrigin = [Environment]::GetEnvironmentVariable('HUABU_PUBLIC_ORIGIN', 'Process')",
      "  $huabuPreviousToken = [Environment]::GetEnvironmentVariable('HUABU_CONNECTION_TOKEN', 'Process')",
      '  try {',
      `    $env:HUABU_PUBLIC_ORIGIN = ${quotePowerShell(normalizedOrigin)}`,
      `    $env:HUABU_CONNECTION_TOKEN = ${quotePowerShell(token)}`,
      `    pnpm start:daemon --max-agents ${maxAgents}`,
      '  } finally {',
      "    [Environment]::SetEnvironmentVariable('HUABU_PUBLIC_ORIGIN', $huabuPreviousOrigin, 'Process')",
      "    [Environment]::SetEnvironmentVariable('HUABU_CONNECTION_TOKEN', $huabuPreviousToken, 'Process')",
      '  }',
      '}',
    ].join('\n');
  }
  return {
    content,
    source: activeSource ?? 'generated',
    warnings: [
      ...(isLoopbackHostname(origin.hostname) ? (['loopback'] as const) : []),
      ...(insecure ? (['insecure'] as const) : []),
    ],
  };
}

export function _resetConnectionTokenForTests(): void {
  generatedToken = null;
  activeToken = null;
  activeSource = null;
}
