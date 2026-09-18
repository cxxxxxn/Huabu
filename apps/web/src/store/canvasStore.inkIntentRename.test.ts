// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { putNodeContent } from '@/api/canvas';

import useCanvasStore from './canvasStore';

import type * as CanvasApi from '@/api/canvas';

vi.mock('@/api/canvas', async (importActual) => {
  const actual = await importActual<typeof CanvasApi>();
  return { ...actual, putNodeContent: vi.fn() };
});

describe('Ink Question user rename ownership', () => {
  beforeEach(() => {
    vi.mocked(putNodeContent).mockResolvedValue({
      nodeId: 'question-1',
      label: 'New ink request',
      rev: 'rev-1',
    });
  });

  it('clears pending inferred naming even for an unchanged user label', async () => {
    useCanvasStore.getState()._setStateNoAutosave({
      canvasId: 'canvas-1',
      nodes: [
        {
          id: 'question-1',
          type: 'question',
          position: { x: 0, y: 0 },
          data: {
            content: '',
            label: 'New ink request',
            pendingInkIntentLabel: true,
          },
        },
      ],
      edges: [],
    });

    await expect(
      useCanvasStore
        .getState()
        .tryRename('node', 'question-1', 'New ink request'),
    ).resolves.toBe(true);

    expect(useCanvasStore.getState().nodes[0]?.data).toMatchObject({
      label: 'New ink request',
      labelSource: 'user',
      pendingInkIntentLabel: false,
    });
    expect(putNodeContent).toHaveBeenCalledOnce();
  });
});
