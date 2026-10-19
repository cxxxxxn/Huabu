// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getInkSigilStrokes,
  projectInkResourceBindings,
} from '@huabu/shared/canvas-engine';

import {
  bindPendingInkSigil,
  cancelInkSigilDetection,
  dismissInkSigil,
  notifyInkSigilStrokeCommitted,
  reopenInkSigil,
  resetInkSigilSession,
  useInkSigilStore,
  validatePendingInkSigil,
} from './inkSigilStore';
import { useToolStore } from './toolStore';

import type { CanvasCommand } from '@huabu/shared';
import type { Node } from '@xyflow/react';

const mocks = vi.hoisted(() => ({
  state: { canvasId: 'space', nodes: [] as Node[], executeCommands: vi.fn() },
  save: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('./canvasStore', () => ({
  default: { getState: () => mocks.state },
  saveCanvasForSubmission: mocks.save,
}));
vi.mock('@/components/Common/Toast', () => ({ toast: mocks.toast }));

function populate() {
  mocks.state.nodes = [
    {
      id: 'ink',
      type: 'sketch',
      position: { x: 0, y: 0 },
      style: { width: 40, height: 40 },
      data: {
        initialSize: { width: 40, height: 40 },
        strokes: [
          [
            [10, 0],
            [10, 40],
          ],
          [
            [30, 0],
            [30, 40],
          ],
          [
            [0, 10],
            [40, 10],
          ],
          [
            [0, 30],
            [40, 30],
          ],
        ].map((points, i) => ({
          id: `s${i}`,
          points,
          size: 2,
          color: 'black',
          createdAt: i * 500,
        })),
      },
    },
    {
      id: 'pdf',
      type: 'pdf',
      position: { x: 500, y: 0 },
      data: { label: 'Paper' },
    },
  ];
}
function commitHash() {
  for (let i = 0; i < 4; i++) notifyInkSigilStrokeCommitted(`s${i}`);
}
beforeEach(() => {
  vi.useFakeTimers();
  resetInkSigilSession();
  mocks.state.canvasId = 'space';
  populate();
  mocks.save.mockReset().mockResolvedValue(undefined);
  mocks.toast.mockReset();
  mocks.state.executeCommands
    .mockReset()
    .mockImplementation((commands: CanvasCommand[]) => {
      for (const command of commands) {
        if (command.type !== 'MERGE_NODE_DATA') continue;
        for (const patch of command.patches) {
          const node = mocks.state.nodes.find(
            (entry) => entry.id === patch.nodeId,
          );
          if (node) node.data = { ...node.data, ...patch.patch };
        }
      }
    });
  useToolStore.setState({ pendingNodeType: 'sketch' });
});
afterEach(() => {
  resetInkSigilSession();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('local Sigil detection and persistence', () => {
  it('publishes only after a complete quiet window and never scans historical Ink', () => {
    vi.advanceTimersByTime(5000);
    expect(useInkSigilStore.getState().pending).toBeNull();
    commitHash();
    vi.advanceTimersByTime(399);
    expect(useInkSigilStore.getState().pending).toBeNull();
    vi.advanceTimersByTime(1);
    expect(useInkSigilStore.getState().pending?.strokeIds).toEqual([
      's0',
      's1',
      's2',
      's3',
    ]);
  });
  it('ignores an older saved disabled Sigil preference', async () => {
    const original = useToolStore.getState();
    try {
      localStorage.setItem(
        'huabu-sketch-tools',
        JSON.stringify({
          version: 3,
          state: { inkSigilEnabled: false },
        }),
      );
      await useToolStore.persist.rehydrate();
      useToolStore.getState().setPendingNodeType('sketch');
      commitHash();
      vi.advanceTimersByTime(400);
      expect(useInkSigilStore.getState().pending).not.toBeNull();
      const stored = JSON.parse(
        localStorage.getItem('huabu-sketch-tools') ?? '{}',
      );
      expect(stored.state).not.toHaveProperty('inkSigilEnabled');
    } finally {
      useToolStore.setState(original, true);
    }
  });
  it('cancels publication on a new down, Canvas switch, or tool switch', () => {
    commitHash();
    cancelInkSigilDetection();
    vi.advanceTimersByTime(400);
    expect(useInkSigilStore.getState().pending).toBeNull();
    commitHash();
    mocks.state.canvasId = 'other';
    vi.advanceTimersByTime(400);
    expect(useInkSigilStore.getState().pending).toBeNull();
    useToolStore.setState({ pendingNodeType: null });
    commitHash();
    vi.advanceTimersByTime(400);
    expect(useInkSigilStore.getState().pending).toBeNull();
  });
  it('saves one binding on the first stroke and cancelled reselection preserves it', async () => {
    commitHash();
    vi.advanceTimersByTime(400);
    await bindPendingInkSigil('pdf');
    const sources = getInkSigilStrokes(mocks.state.nodes);
    expect(
      sources.filter((source) => source.stroke.resourceBinding),
    ).toHaveLength(1);
    expect(sources[0].stroke.resourceBinding?.targetNodeId).toBe('pdf');
    expect(mocks.save).toHaveBeenCalledWith('space');
    reopenInkSigil(projectInkResourceBindings(mocks.state.nodes)[0]);
    dismissInkSigil();
    expect(
      getInkSigilStrokes(mocks.state.nodes)[0].stroke.resourceBinding
        ?.targetNodeId,
    ).toBe('pdf');
  });
  it('closes immediately and allows another choice while persistence is pending', async () => {
    const releases: Array<() => void> = [];
    mocks.save.mockImplementation(
      () => new Promise<void>((resolve) => releases.push(resolve)),
    );
    commitHash();
    vi.advanceTimersByTime(400);
    const first = bindPendingInkSigil('pdf');
    expect(useInkSigilStore.getState().pending).toBeNull();
    expect(useInkSigilStore.getState().saving).toBe(true);
    expect(projectInkResourceBindings(mocks.state.nodes)[0].target?.id).toBe(
      'pdf',
    );
    reopenInkSigil(projectInkResourceBindings(mocks.state.nodes)[0]);
    const second = bindPendingInkSigil('pdf');
    expect(useInkSigilStore.getState().pending).toBeNull();
    expect(mocks.save).toHaveBeenCalledTimes(2);
    releases[0]();
    await first;
    expect(useInkSigilStore.getState().saving).toBe(true);
    releases[1]();
    await second;
    expect(useInkSigilStore.getState().saving).toBe(false);
  });

  it.each(['dismiss', 'reopen', 'switch-canvas'] as const)(
    'does not reopen an old failed selection after %s',
    async (action) => {
      commitHash();
      vi.advanceTimersByTime(400);
      mocks.save.mockRejectedValueOnce(new Error('disk full'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const save = bindPendingInkSigil('pdf');
      expect(useInkSigilStore.getState().pending).toBeNull();
      if (action === 'dismiss') dismissInkSigil();
      if (action === 'reopen')
        reopenInkSigil(projectInkResourceBindings(mocks.state.nodes)[0]);
      if (action === 'switch-canvas') mocks.state.canvasId = 'other';
      const pending = useInkSigilStore.getState().pending;
      await save;
      expect(useInkSigilStore.getState().pending).toBe(pending);
      expect(mocks.toast).toHaveBeenCalled();
    },
  );
  it('removes the reference without deleting strokes', async () => {
    commitHash();
    vi.advanceTimersByTime(400);
    await bindPendingInkSigil('pdf');
    reopenInkSigil(projectInkResourceBindings(mocks.state.nodes)[0]);
    await bindPendingInkSigil(null);
    expect(projectInkResourceBindings(mocks.state.nodes)).toEqual([]);
    expect(getInkSigilStrokes(mocks.state.nodes)).toHaveLength(4);
  });
  it('rejects stale geometry and surfaces a failed save for retry', async () => {
    commitHash();
    vi.advanceTimersByTime(400);
    const sources = getInkSigilStrokes(mocks.state.nodes);
    sources[1].stroke.points[0][0] += 4;
    expect(validatePendingInkSigil()).toBe(false);
    await bindPendingInkSigil('pdf');
    expect(mocks.state.executeCommands).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalled();
    populate();
    commitHash();
    vi.advanceTimersByTime(400);
    mocks.save.mockRejectedValueOnce(new Error('disk full'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await bindPendingInkSigil('pdf');
    expect(useInkSigilStore.getState().pending).not.toBeNull();
    expect(useInkSigilStore.getState().pending?.bindingId).toBe(
      projectInkResourceBindings(mocks.state.nodes)[0].binding.id,
    );
    expect(validatePendingInkSigil()).toBe(true);
    expect(useInkSigilStore.getState().saving).toBe(false);
    await bindPendingInkSigil('pdf');
    expect(useInkSigilStore.getState().pending).toBeNull();
  });
});
