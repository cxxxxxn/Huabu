// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act, useImperativeHandle, type ReactNode, type Ref } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSearchStore, type SearchResultRow } from '@/store/searchStore';

import { CanvasSearchResults } from './CanvasSearchResults';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { selectNodes, openPreviewNode, canvasState } = vi.hoisted(() => {
  const selectNodes = vi.fn();
  return {
    selectNodes,
    openPreviewNode: vi.fn(),
    canvasState: {
      selectNodes,
      nodes: [],
      rfInstance: null,
      canvasWrapper: null,
    },
  };
});

vi.mock('@/store/canvasStore', () => ({
  default: (select: (state: typeof canvasState) => unknown) =>
    select(canvasState),
}));
vi.mock('@/store/previewWorkspace/store', () => ({
  selectActiveNodeId: () => null,
  usePreviewWorkspaceStore: () => null,
}));
vi.mock('@/store/previewWorkspace/actions', () => ({ openPreviewNode }));
vi.mock('@/hooks/useTextHighlight', () => ({ useTextHighlight: vi.fn() }));
vi.mock('@/hooks/searchDom', () => ({ scheduleScrollToMatch: vi.fn() }));
vi.mock('./LayerNodeIcon', () => ({ CanvasSearchNodeIcon: () => null }));
vi.mock('./focusNodesOnCanvas', () => ({ revealNodesOnCanvas: vi.fn() }));
vi.mock('../../Nodes/previews', () => ({ hasNodePreview: () => true }));
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    ref,
    data,
    itemContent,
  }: {
    ref: Ref<{ scrollIntoView: (location: { done?: () => void }) => void }>;
    data: unknown[];
    itemContent: (index: number, item: unknown) => ReactNode;
  }) => {
    useImperativeHandle(ref, () => ({
      scrollIntoView: ({ done }) => done?.(),
    }));
    return (
      <div>
        {data.map((item, index) => (
          <div key={index}>{itemContent(index, item)}</div>
        ))}
      </div>
    );
  },
}));

const results: SearchResultRow[] = ['first', 'second'].map((nodeId) => ({
  key: `${nodeId}:content:0`,
  tier: 'content',
  match: {
    nodeId,
    nodeType: 'note',
    label: nodeId,
    field: 'content',
    snippet: 'test content',
    matchStart: 0,
    matchLength: 4,
    occurrenceIndex: 0,
  },
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let searchInput: HTMLInputElement | undefined;

function getRow(index: number): HTMLButtonElement {
  const row = container?.querySelector<HTMLButtonElement>(
    `[data-search-row-index="${index}"]`,
  );
  if (!row) throw new Error(`Missing search row ${index}`);
  return row;
}

function press(element: HTMLElement, key: string) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  act(() => element.dispatchEvent(event));
  return event;
}

beforeEach(() => {
  useSearchStore.setState({
    query: 'test',
    results,
    scope: { kind: 'canvas', canvasId: 'canvas' },
    collapsedNodeIds: new Set(),
    isStreaming: false,
    error: null,
    truncated: false,
    contentPhase: false,
  });
  container = document.createElement('div');
  searchInput = document.createElement('input');
  searchInput.dataset.canvasSearchInput = '';
  document.body.append(searchInput, container);
  root = createRoot(container);
  act(() => root?.render(<CanvasSearchResults />));
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  searchInput?.remove();
  root = undefined;
  useSearchStore.getState().close();
});

describe('Canvas search keyboard focus', () => {
  it('activates the second group when its header receives Tab focus', () => {
    const second = getRow(2);
    act(() => second.focus());
    press(second, 'Enter');
    expect(useSearchStore.getState().collapsedNodeIds.has('second')).toBe(true);
    expect(useSearchStore.getState().collapsedNodeIds.has('first')).toBe(false);
  });

  it('moves actual result focus with arrow navigation before Enter activation', () => {
    act(() => getRow(0).focus());
    press(getRow(0), 'ArrowDown');
    expect(document.activeElement).toBe(getRow(1));
    press(getRow(1), 'Enter');
    expect(openPreviewNode).toHaveBeenCalledExactlyOnceWith('first', {
      transient: true,
    });
    expect(useSearchStore.getState().collapsedNodeIds.size).toBe(0);
    press(getRow(1), 'ArrowDown');
    expect(document.activeElement).toBe(getRow(2));
    press(getRow(2), 'Enter');
    expect(useSearchStore.getState().collapsedNodeIds.has('second')).toBe(true);
  });

  it('keeps virtual result navigation in the search input without moving DOM focus', () => {
    if (!searchInput) throw new Error('Missing search input');
    act(() => searchInput?.focus());
    press(searchInput, 'ArrowDown');
    expect(document.activeElement).toBe(searchInput);
    press(searchInput, 'Enter');
    expect(openPreviewNode).toHaveBeenCalledExactlyOnceWith('first', {
      transient: true,
    });
  });

  it('continues arrow navigation from a clicked match', () => {
    act(() => getRow(3).click());
    expect(openPreviewNode).toHaveBeenCalledWith('second', { transient: true });
    if (!searchInput) throw new Error('Missing search input');
    act(() => searchInput?.focus());
    press(searchInput, 'ArrowUp');
    press(searchInput, 'Enter');
    expect(useSearchStore.getState().collapsedNodeIds.has('second')).toBe(true);
    expect(useSearchStore.getState().collapsedNodeIds.has('first')).toBe(false);
  });

  it('does not consume Enter from unrelated controls', () => {
    const other = document.createElement('button');
    document.body.appendChild(other);
    try {
      act(() => other.focus());
      expect(press(other, 'Enter').defaultPrevented).toBe(false);
      expect(useSearchStore.getState().collapsedNodeIds.size).toBe(0);
      expect(selectNodes).not.toHaveBeenCalled();
    } finally {
      other.remove();
    }
  });
});
