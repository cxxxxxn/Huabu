// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  stringifyJson,
  validateCanvasFile,
  validateNodeContent,
} from './codecs.js';
import { sanitizeId } from '../../../../utils/fs.js';

import type { CanvasFile } from '../../../canvas/persistence-types.js';
import type {
  NodePutResult,
  SpaceNodeMutation,
  SpaceWriteInput,
  SpaceWriteResult,
} from '../../ports/structured.js';

export function mutationError(
  mutation: SpaceNodeMutation,
  result: NodePutResult,
): Error {
  const prefix = `Space write failed for node ${JSON.stringify(mutation.nodeId)}`;
  if (result.ok) return new Error(`${prefix}: unexpected success result`);
  switch (result.reason) {
    case 'not-found':
      return new Error(`${prefix}: Space does not exist`);
    case 'revision-conflict':
      return new Error(`${prefix}: unexpected revision conflict`);
    case 'label-conflict':
      return new Error(
        `${prefix}: label conflicts with node ${JSON.stringify(result.conflictingNodeId)}`,
      );
    case 'duplicate-node':
      return new Error(`${prefix}: duplicate persisted node`);
    case 'write-suppressed':
      return new Error(`${prefix}: write is suppressed after deletion`);
  }
}

export function validateInput(canvasId: string, input: SpaceWriteInput): void {
  if (!Number.isFinite(input.expectedVersion)) {
    throw new TypeError('expectedVersion must be a finite number');
  }
  validateCanvasFile(input.nextRecord, canvasId);
  if (input.nextRecord.version !== input.expectedVersion + 1) {
    throw new Error(
      `SpaceWrite(${canvasId}) expected nextRecord.version ` +
        `${input.expectedVersion + 1}, received ${input.nextRecord.version}`,
    );
  }
  if (
    input.allowCreate === true &&
    (input.nodeMutations.length > 0 || input.delta !== undefined)
  ) {
    throw new Error(
      'allowCreate is valid only for a record-only structural write',
    );
  }
  if (
    input.delta !== undefined &&
    input.delta.version !== input.nextRecord.version
  ) {
    throw new Error(
      'delta.version must equal the committed Space record version',
    );
  }
  if (input.delta !== undefined) {
    stringifyJson(input.delta, `Space ${JSON.stringify(canvasId)} delta`);
  }
  for (const mutation of input.nodeMutations) {
    sanitizeId(mutation.nodeId, 'nodeId');
    if (mutation.kind === 'put') {
      validateNodeContent(mutation.record, mutation.nodeId);
    }
  }
}

/** Check persisted state inside the caller's transaction, before any mutation. */
export function checkWritePreconditions(
  canvasId: string,
  current: CanvasFile | null,
  input: SpaceWriteInput,
): Extract<SpaceWriteResult, { ok: false }> | null {
  if (current === null) {
    if (!input.allowCreate) return { ok: false, reason: 'not-found' };
    if (input.expectedVersion !== 0) {
      throw new Error(`SpaceWrite(${canvasId}) can create only from version 0`);
    }
    return null;
  }
  if (current.version !== input.expectedVersion) {
    return {
      ok: false,
      reason: 'version-conflict',
      actualVersion: current.version,
    };
  }
  if (input.nextRecord.createdAt !== current.createdAt) {
    throw new Error(`SpaceWrite(${canvasId}) refusing to change createdAt`);
  }
  if (input.nextRecord.title !== current.title) {
    throw new Error(
      `SpaceWrite(${canvasId}) cannot change title; ` +
        'use SpaceRepository.rename first',
    );
  }
  return null;
}
