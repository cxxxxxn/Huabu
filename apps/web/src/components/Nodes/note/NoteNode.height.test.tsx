// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { autoHeightKey } from '@huabu/shared/canvas-engine';

import { NoteNode, type NoteNodeType } from './NoteNode';

import type { Node, NodeProps } from '@xyflow/react';

const mocks = vi.hoisted(() => ({
  nodes: [] as Node[],
  zoom: 1,
  callbacks: [] as Array<() => void>,
  propose: vi.fn(),
}));
vi.mock('@xyflow/react', () => ({
  useStore: (select: (state: unknown) => unknown) =>
    select({ transform: [0, 0, mocks.zoom] }),
}));
vi.mock('@/store/canvasStore', () => {
  const getState = () => ({
    nodes: mocks.nodes,
    canvasId: 'c1',
    updateNodeData: vi.fn(),
    moveNoteBlockIntoNote: vi.fn(),
  });
  return {
    default: Object.assign(
      (select: (state: unknown) => unknown) => select(getState()),
      { getState },
    ),
  };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/hooks/useNodePresentation', () => ({
  useNodePresentation: () => ({ mode: 'overview', isVisible: true }),
}));
vi.mock('../shared/nodeHydrationScheduler', () => ({
  useDeferredHydration: () => true,
}));
vi.mock('../shared/height/useHeightMode', () => ({
  useHeightMode: () => mocks.nodes[0].data.heightMode,
}));
vi.mock('../shared/height/commitQueue', () => ({
  proposeMeasuredHeight: mocks.propose,
  cancelMeasuredHeight: vi.fn(),
}));
vi.mock('./heightMemory', () => ({ useTrackNoteFixedHeight: vi.fn() }));
vi.mock('./useAutoHeightInvariant', () => ({
  useAutoHeightInvariant: vi.fn(),
}));
vi.mock('../NodeWrapper', () => ({
  NodeWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('../MissingFileBanner', () => ({ MissingFileBanner: () => null }));
vi.mock('@/components/Common/FloatingToolbar', () => ({
  FloatingToolbar: { ActionButton: () => null },
}));
vi.mock('@/components/Common/Loading', () => ({ Loading: () => null }));
vi.mock('@/components/Milkdown', () => ({
  MilkdownPreview: () => <div className="ProseMirror">Document</div>,
}));
vi.mock('@/store/previewWorkspace/actions', () => ({
  openPreviewNode: vi.fn(),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error('Missing Note test element or observer');
  return value;
}
let container: HTMLDivElement;
let root: Root;
const render = () =>
  act(() =>
    root.render(
      <NoteNode
        {...({
          id: 'n1',
          data: { ...mocks.nodes[0].data },
          selected: true,
        } as NodeProps<NoteNodeType>)}
      />,
    ),
  );

beforeEach(() => {
  mocks.nodes = [
    {
      id: 'n1',
      type: 'note',
      selected: true,
      position: { x: 0, y: 0 },
      style: { width: 400, height: 300 },
      data: { content: 'Document', heightMode: 'auto' },
    },
  ];
  mocks.zoom = 1;
  mocks.callbacks = [];
  mocks.propose.mockReset();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        mocks.callbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('mounted Note actual-width measurement', () => {
  it('captures the measured width, rejects lagging DOM and old callbacks, and ignores zoom', () => {
    render();
    const host = required(
      container.querySelector<HTMLElement>('[data-note-content-host]'),
    );
    const prose = required(host.querySelector<HTMLElement>('.ProseMirror'));
    Object.defineProperty(host, 'clientWidth', {
      value: 394,
      configurable: true,
    });
    Object.defineProperty(prose, 'scrollHeight', {
      value: 200,
      configurable: true,
    });
    const oldCallback = mocks.callbacks[0];
    act(oldCallback);
    expect(mocks.propose).toHaveBeenLastCalledWith(
      expect.objectContaining({ measuredFor: autoHeightKey(mocks.nodes[0]) }),
    );
    mocks.propose.mockClear();
    mocks.nodes = [{ ...mocks.nodes[0], style: { width: 800, height: 300 } }];
    act(oldCallback);
    render();
    expect(mocks.propose).not.toHaveBeenCalled();
    Object.defineProperty(host, 'clientWidth', { value: 794 });
    Object.defineProperty(prose, 'scrollHeight', { value: 100 });
    act(oldCallback);
    expect(mocks.propose).not.toHaveBeenCalled();
    act(required(mocks.callbacks.at(-1)));
    expect(mocks.propose).toHaveBeenCalledOnce();
    expect(mocks.propose).toHaveBeenLastCalledWith(
      expect.objectContaining({ measuredFor: autoHeightKey(mocks.nodes[0]) }),
    );
    mocks.propose.mockClear();
    mocks.zoom = 0.5;
    render();
    expect(mocks.propose).not.toHaveBeenCalled();
    expect(host.style.paddingInline).toBe('16px');
    expect(
      container.querySelector<HTMLElement>('.huabu-note-scroll-frame')?.style
        .transform,
    ).toBe('');
  });

  it('retains fixed-height scrolling without proposing auto geometry', () => {
    mocks.nodes[0].data.heightMode = 'fixed';
    render();
    const host = required(
      container.querySelector<HTMLElement>('[data-note-content-host]'),
    );
    Object.defineProperty(host, 'clientWidth', { value: 394 });
    Object.defineProperty(host.querySelector('.ProseMirror'), 'scrollHeight', {
      value: 500,
    });
    act(mocks.callbacks[0]);
    expect(mocks.propose).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-note-scroll-enabled="true"]'),
    ).not.toBeNull();
  });
});
