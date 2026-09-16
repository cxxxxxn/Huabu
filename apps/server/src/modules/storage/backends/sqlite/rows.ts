// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { SQLITE_WORLD_COLLISION_KEY } from './database.js';
import {
  decodeSpaceRow,
  SPACE_COLUMNS,
  stringifyJson,
  validateCanvasFile,
} from '../sql/codecs.js';

import type { CanvasFile } from '../../../canvas/persistence-types.js';
import type { PersistedSpace } from '../sql/codecs.js';
import type { DatabaseSync } from 'node:sqlite';

/**
 * Read one Space, scoped to the Workspace that owns it.
 *
 * The Workspace predicate is not an optimization. `canvas_id` is unique across
 * the whole database, so without it a handle resolved in one Workspace would
 * answer for a Space in another — which is exactly the confusion the Disk
 * adapters prevent by binding to a workspace path.
 */
export function readSpaceRow(
  database: DatabaseSync,
  workspaceId: string,
  canvasId: string,
): PersistedSpace | null {
  const row = database
    .prepare(
      `SELECT ${SPACE_COLUMNS}
       FROM spaces
       WHERE workspace_id = ? AND canvas_id = ?`,
    )
    .get(workspaceId, canvasId);
  return row === undefined ? null : decodeSpaceRow(row);
}

/** Whether the named Space exists in this Workspace. */
export function spaceRowExists(
  database: DatabaseSync,
  workspaceId: string,
  canvasId: string,
): boolean {
  return (
    database
      .prepare(
        `SELECT 1 AS present
         FROM spaces
         WHERE workspace_id = ? AND canvas_id = ?`,
      )
      .get(workspaceId, canvasId)?.['present'] === 1
  );
}

/** Collision keys already taken in one Workspace, for name allocation. */
export function occupiedCollisionKeys(
  database: DatabaseSync,
  workspaceId: string,
): string[] {
  return database
    .prepare('SELECT collision_key FROM spaces WHERE workspace_id = ?')
    .all(workspaceId)
    .map((row) => row['collision_key'])
    .filter((value): value is string => typeof value === 'string');
}

export function insertSpaceRow(
  database: DatabaseSync,
  workspaceId: string,
  record: CanvasFile,
  collisionKey: string,
  isWorld = false,
): void {
  validateCanvasFile(record, record.canvasId);
  database
    .prepare(
      `INSERT INTO spaces (
        canvas_id, workspace_id, title, collision_key, version, state_json,
        created_at, updated_at, is_world
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.canvasId,
      workspaceId,
      record.title,
      isWorld ? SQLITE_WORLD_COLLISION_KEY : collisionKey,
      record.version,
      stringifyJson(record.state, `Space ${record.canvasId} state`),
      record.createdAt,
      record.updatedAt,
      isWorld ? 1 : 0,
    );
}

export function updateSpaceRow(
  database: DatabaseSync,
  workspaceId: string,
  record: CanvasFile,
  expectedVersion: number,
): number {
  validateCanvasFile(record, record.canvasId);
  const result = database
    .prepare(
      `UPDATE spaces
       SET version = ?, state_json = ?, updated_at = ?
       WHERE workspace_id = ? AND canvas_id = ? AND version = ?`,
    )
    .run(
      record.version,
      stringifyJson(record.state, `Space ${record.canvasId} state`),
      record.updatedAt,
      workspaceId,
      record.canvasId,
      expectedVersion,
    );
  return Number(result.changes);
}
