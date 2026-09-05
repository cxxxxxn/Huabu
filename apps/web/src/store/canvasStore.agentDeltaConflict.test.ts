// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import useCanvasStore from './canvasStore';

import type { Delta } from '@huabu/shared/canvas-engine';
import type { Node } from '@xyflow/react';

function question(content: string, status: string): Node {
  return {
    id: 'question-1',
    type: 'question',
    position: { x: 0, y: 0 },
    data: { type: 'question', label: 'Question 1', content, status },
  };
}

const pendingEffects = {
  mutatedNodes: [],
  deletedNodeIds: [],
  contentEditedNodeIds: [],
  deferredFitFrameIds: [],
};

beforeEach(() => {
  vi.useFakeTimers();
  useCanvasStore.getState()._setStateNoAutosave({
    canvasId: 'canvas-1',
    nodes: [question('', 'idle')],
    edges: [],
    version: 1,
    isLoading: false,
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('agent delta conflict protection', () => {
  it('applies lifecycle-only changes without overwriting pending local content', () => {
    useCanvasStore
      .getState()
      .patchNodeSilent('question-1', { content: 'Pending prompt' });

    const delta: Delta = {
      type: 'REPLACE_NODE',
      prev: question('', 'idle'),
      next: question('', 'running'),
    };
    const skipped = useCanvasStore
      .getState()
      .applyDeltasFromAgent([delta], 2, pendingEffects);

    expect(skipped).toEqual([]);
    expect(useCanvasStore.getState().nodes[0]?.data).toMatchObject({
      content: 'Pending prompt',
      status: 'running',
    });
    expect(useCanvasStore.getState().version).toBe(2);
  });

  it('still skips a remote content change while local content is pending', () => {
    useCanvasStore
      .getState()
      .patchNodeSilent('question-1', { content: 'Pending prompt' });

    const delta: Delta = {
      type: 'REPLACE_NODE',
      prev: question('', 'idle'),
      next: question('Remote prompt', 'running'),
    };
    const skipped = useCanvasStore
      .getState()
      .applyDeltasFromAgent([delta], 2, pendingEffects);

    expect(skipped).toEqual(['question-1']);
    expect(useCanvasStore.getState().nodes[0]?.data).toMatchObject({
      content: 'Pending prompt',
      status: 'idle',
    });
    expect(useCanvasStore.getState().version).toBe(2);
  });
});