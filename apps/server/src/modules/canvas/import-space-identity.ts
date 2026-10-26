// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import { createId } from '@huabu/shared';

import { safeJoin, sanitizeId } from '../../utils/fs.js';
import {
  parseFrontmatter,
  toFrontmatter,
} from '../../utils/markdown-frontmatter.js';

import type { CanvasFile } from './persistence-types.js';

const NODE_REFERENCE =
  /^(id|ids|parentId|source|target|before|after)$|(?:^node|Node|^frame|Frame|^edge|Edge)Ids?$/;
const SPACE_REFERENCE = /(?:^canvas|Canvas|^space|Space)Ids?$/;

/** Re-key the public bundle in staging, before any imported Space is visible. */
export async function remapImportedSpace(
  directory: string,
  record: CanvasFile,
  canvasId: string,
): Promise<CanvasFile> {
  const identities = new Map<string, string>();
  for (const [kind, entries] of [
    ['node', record.state.nodes],
    ['edge', record.state.edges],
  ] as const) {
    for (const entry of entries) {
      if (
        !entry ||
        typeof entry !== 'object' ||
        !('id' in entry) ||
        typeof entry.id !== 'string' ||
        !entry.id ||
        identities.has(entry.id)
      ) {
        throw new Error('Invalid or duplicate identity in imported Space');
      }
      identities.set(entry.id, createId(kind));
    }
  }

  const oldCanvas = encodeURIComponent(
    sanitizeId(record.canvasId, 'sourceCanvasId'),
  );
  const newCanvas = encodeURIComponent(canvasId);
  const nodesDirectory = safeJoin(directory, 'nodes');
  function rewriteLinks(text: string): string {
    return text
      .split(`/api/canvas/${oldCanvas}/artifact/`)
      .join(`/api/canvas/${newCanvas}/artifact/`)
      .replace(
        new RegExp(`/canvas/${oldCanvas}\\?node=([a-zA-Z0-9_-]+)`, 'g'),
        (_match, nodeId: string) =>
          `/canvas/${newCanvas}?node=${identities.get(nodeId) ?? nodeId}`,
      );
  }
  function rewriteToolOutput(text: string): string {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      // Tool output may legitimately be plain text rather than a JSON envelope.
      if (error instanceof SyntaxError) return rewriteLinks(text);
      throw error;
    }
    const envelope =
      parsed !== null &&
      typeof parsed === 'object' &&
      'tool' in parsed &&
      typeof parsed.tool === 'string' &&
      'status' in parsed &&
      (parsed.status === 'success' || parsed.status === 'error');
    const snapshots =
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every(
        (item: unknown) =>
          item !== null &&
          typeof item === 'object' &&
          'src' in item &&
          typeof item.src === 'string' &&
          'width' in item &&
          typeof item.width === 'number' &&
          'height' in item &&
          typeof item.height === 'number' &&
          'originNodeIds' in item &&
          Array.isArray(item.originNodeIds) &&
          item.originNodeIds.every((id: unknown) => typeof id === 'string'),
      );
    return envelope || snapshots
      ? JSON.stringify(rewrite(parsed))
      : rewriteLinks(text);
  }
  function rewrite(value: unknown, field = '', parent = ''): unknown {
    if (typeof value === 'string') {
      if (field === 'rawOutput') return rewriteToolOutput(value);
      if (
        NODE_REFERENCE.test(field) ||
        (parent === 'selection' && field === 'selectedIds')
      )
        return identities.get(value) ?? rewriteLinks(value);
      if (
        (SPACE_REFERENCE.test(field) ||
          (parent === 'namespace' && field === 'name')) &&
        value === record.canvasId
      )
        return canvasId;
      return rewriteLinks(value);
    }
    if (Array.isArray(value))
      return value.map((item) => rewrite(item, field, parent));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          /^(nodes|edges)$|ByNodeId$/.test(field)
            ? (identities.get(key) ?? key)
            : key,
          rewrite(item, key, field),
        ]),
      );
    }
    return value;
  }

  async function rewriteFiles(root: string, markdown: boolean): Promise<void> {
    if (!existsSync(root)) return;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const filename = safeJoin(root, entry.name);
      if (entry.isDirectory()) {
        await rewriteFiles(filename, markdown);
      } else if (entry.isFile() && /\.(json|jsonl|md)$/.test(entry.name)) {
        if (entry.name.endsWith('.md') && !markdown) continue;
        const raw = await readFile(filename, 'utf8');
        let updated: string;
        if (entry.name.endsWith('.md')) {
          const { meta, content } = parseFrontmatter(raw, { strict: true });
          const mapped = Object.fromEntries(
            Object.entries(meta).map(([key, value]) => [
              key,
              rewrite(value, key),
            ]),
          );
          if (root === nodesDirectory) {
            const id =
              typeof meta.id === 'string' && meta.id
                ? meta.id
                : entry.name.replace(/\.md$/, '');
            const importedId = identities.get(id);
            if (importedId) mapped.id = importedId;
          }
          updated = Object.keys(mapped).length
            ? `${toFrontmatter(mapped)}\n${rewriteLinks(content)}`
            : rewriteLinks(content);
        } else if (entry.name.endsWith('.jsonl')) {
          updated = raw
            .split('\n')
            .map((line) =>
              line.trim() ? JSON.stringify(rewrite(JSON.parse(line))) : line,
            )
            .join('\n');
        } else {
          updated = JSON.stringify(rewrite(JSON.parse(raw)));
        }
        if (updated !== raw) await writeFile(filename, updated);
      } else if (entry.isSymbolicLink()) {
        throw new Error(
          'Symbolic links are not supported in imported Space records',
        );
      }
    }
  }

  await rewriteFiles(nodesDirectory, true);
  await rewriteFiles(safeJoin(directory, '.history'), false);
  await rewriteFiles(safeJoin(directory, '.memory'), true);
  await rewriteFiles(
    safeJoin(directory, '.ext', 'huabu.recentconversation'),
    false,
  );

  // Bundle v2 carries Agenetes Tier-2 turns in SQLite as well as legacy JSONL.
  const turnsPath = safeJoin(directory, '.history', 'chat_v2', 'turns.sqlite');
  if (existsSync(turnsPath)) {
    const database = new DatabaseSync(turnsPath);
    try {
      database.exec('BEGIN');
      const update = database.prepare(
        'UPDATE turns SET turn_json = ? WHERE thread_id = ? AND ordinal = ?',
      );
      for (const row of database
        .prepare('SELECT thread_id, ordinal, turn_json FROM turns')
        .all()) {
        if (
          typeof row.turn_json !== 'string' ||
          typeof row.thread_id !== 'string' ||
          (typeof row.ordinal !== 'number' && typeof row.ordinal !== 'bigint')
        ) {
          throw new Error('Invalid imported turn');
        }
        const updated = JSON.stringify(rewrite(JSON.parse(row.turn_json)));
        if (updated !== row.turn_json) {
          update.run(updated, row.thread_id, row.ordinal);
        }
      }
      database.exec('COMMIT');
    } finally {
      database.close();
    }
  }

  return {
    ...record,
    canvasId,
    state: {
      ...Object.fromEntries(
        Object.entries(record.state).map(([key, value]) => [
          key,
          rewrite(value, key),
        ]),
      ),
      nodes: record.state.nodes.map((node) => rewrite(node)),
      edges: record.state.edges.map((edge) => rewrite(edge)),
    },
  };
}
