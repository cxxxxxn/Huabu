// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAcpProfilesStore } from '@/store/acpProfilesStore';
import useCanvasStore from '@/store/canvasStore';
import { useChatStore } from '@/store/chatStore';
import { useGesturePreviewStore } from '@/store/gesturePreviewStore';

import { StrokeSelectionToolbar } from './StrokeSelectionToolbar';

import type {
  AgentTurnCallbacks,
  AgentTurnResult,
} from '@/hooks/agentTurnController';

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  prepare: vi.fn(),
  dispatch: vi.fn(),
  createQuestion: vi.fn(),
  placement: vi.fn(),
  captureGrounding: vi.fn(),
  blobToDataUrl: vi.fn(),
  getViewport: vi.fn(),
}));

vi.mock('@xyflow/react', async (original) => ({
  ...((await original()) as object),
  useReactFlow: () => ({ getViewport: mocks.getViewport }),
}));
vi.mock('@/handler/canvasCommand/utils/screenshot', () => ({
  captureVisibleCanvasGrounding: mocks.captureGrounding,
  blobToDataUrl: mocks.blobToDataUrl,
}));

vi.mock('@/components/Common/CanvasFloatingPopover', async () => {
  const { createElement } = await import('react');
  return {
    CanvasFloatingPopover: ({
      open,
      children,
    }: {
      open: boolean;
      children: React.ReactNode;
    }) => (open ? createElement('div', null, children) : null),
  };
});
vi.mock('@/components/Nodes/sketch/SketchControls', async () => {
  const { createElement } = await import('react');
  return {
    SketchControls: () => createElement('div', { 'data-sketch-controls': '' }),
  };
});
vi.mock('@/components/Nodes/sketch/sketchHitTest', () => ({
  getSketchStrokeSelectionBounds: (selection: Record<string, string[]>) =>
    Object.keys(selection).length > 0
      ? { x: 0, y: 0, width: 100, height: 50 }
      : null,
}));
vi.mock('@/hooks/useInputMode', () => ({ useIsNotMouse: () => false }));
vi.mock('@/hooks/agentTurnController', () => ({
  captureAgentTurnSources: mocks.capture,
  prepareAgentTurn: mocks.prepare,
  dispatchAgentTurn: mocks.dispatch,
}));
vi.mock('@/components/Nodes/question/questionCompose', () => ({
  createQuestionNode: mocks.createQuestion,
}));
vi.mock('@/components/Nodes/nodePlacement', () => ({
  computeAdjacentNodePlacement: mocks.placement,
}));

let root: Root;
let container: HTMLDivElement;

function deferredResult() {
  let resolve!: (result: AgentTurnResult) => void;
  const promise = new Promise<AgentTurnResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function mountToolbar() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(StrokeSelectionToolbar));
  });
}

async function renderToolbar() {
  await mountToolbar();
  const button = document.body.querySelector<HTMLButtonElement>('button');
  if (!button) throw new Error('Expected toolbar button');
  return button;
}

beforeEach(() => {
  vi.clearAllMocks();
  useCanvasStore.getState()._setStateNoAutosave({
    canvasId: 'canvas-1',
    nodes: [
      {
        id: 'sketch-1',
        type: 'sketch',
        position: { x: 0, y: 0 },
        data: {},
      },
    ],
    edges: [],
  });
  useChatStore.setState({
    threadsById: {},
    bindingByThread: {},
    settingsByThread: {},
    lastActionByThread: {},
  });
  useAcpProfilesStore.setState({ profiles: [] });
  useGesturePreviewStore.setState({
    sketchStrokeSelection: { 'sketch-1': ['stroke-1'] },
  });
  mocks.capture.mockReturnValue({
    canvasId: 'canvas-1',
    canvasContext: {
      selectedNodes: [
        { id: 'sketch-1', type: 'sketch', strokeIds: ['stroke-1'] },
      ],
    },
  });
  mocks.prepare.mockImplementation((input) => ({
    ...input,
    agentBinding: { kind: 'internal' },
    settings: { modelId: null, reasoningEffort: null },
  }));
  mocks.createQuestion.mockReturnValue({
    nodeId: 'question-1',
    threadId: 'thread-1',
    conversationView: {
      presentationAnchor: { canvasId: 'canvas-1', nodeId: 'question-1' },
      conversationOwner: {
        canvasId: 'canvas-1',
        nodeId: 'question-1',
        threadId: 'thread-1',
      },
    },
  });
  mocks.placement.mockReturnValue({ x: 10, y: 100 });
  mocks.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 1 });
  mocks.captureGrounding.mockResolvedValue({
    blob: new Blob(['png'], { type: 'image/png' }),
    crop: { x: 0, y: 0, width: 220, height: 100 },
    devicePixelRatio: 2,
    viewport: { width: 1200, height: 800 },
  });
  mocks.blobToDataUrl.mockResolvedValue('data:image/png;base64,cG5n');
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

describe('StrokeSelectionToolbar Ink submission', () => {
  it('keeps submit and source count visible for a mixed selection', async () => {
    useCanvasStore.getState()._setStateNoAutosave({
      nodes: [
        {
          id: 'sketch-1',
          type: 'sketch',
          selected: true,
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: 'note-1',
          type: 'note',
          selected: true,
          position: { x: 120, y: 0 },
          data: {},
        },
      ],
    });

    await mountToolbar();

    expect(document.body.textContent).toContain('2 sources');
    expect(document.body.textContent).toContain('New · Huabu');
    expect(document.body.querySelector('[data-sketch-controls]')).toBeNull();
    const submit = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Send ink request"]',
    );
    expect(submit?.disabled).toBe(false);
    expect(submit?.className).toContain('bg-inverse');
    expect(submit?.className).toContain('rounded-full');
  });

  it('captures hidden grounding before dispatching mixed Ink and objects', async () => {
    useCanvasStore.getState()._setStateNoAutosave({
      nodes: [
        {
          id: 'sketch-1',
          type: 'sketch',
          selected: true,
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: 'note-1',
          type: 'note',
          selected: true,
          position: { x: 120, y: 0 },
          data: {},
        },
      ],
    });
    mocks.dispatch.mockResolvedValueOnce({ status: 'completed' });
    const button = await renderToolbar();

    await act(async () => button.click());

    expect(mocks.captureGrounding).toHaveBeenCalledOnce();
    expect(mocks.blobToDataUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        groundingVisual: expect.objectContaining({
          dataUrl: 'data:image/png;base64,cG5n',
          selectedNodeIds: ['note-1'],
        }),
      }),
    );
  });

  it('exposes a disabled explanation for multiple Question targets', async () => {
    useCanvasStore.getState()._setStateNoAutosave({
      nodes: [
        {
          id: 'question-1',
          type: 'question',
          selected: true,
          position: { x: 0, y: 0 },
          data: { threadId: 'thread-1' },
        },
        {
          id: 'question-2',
          type: 'question',
          selected: true,
          position: { x: 200, y: 0 },
          data: { threadId: 'thread-2' },
        },
        {
          id: 'sketch-1',
          type: 'sketch',
          position: { x: 0, y: 0 },
          data: {},
        },
      ],
    });

    await mountToolbar();

    const button = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Select only one question to continue"]',
    );
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute('aria-label')).toBe(
      'Select only one question to continue',
    );
    expect(document.body.textContent).toContain('Multiple agents');
  });

  it('continues an externally bound Question target', async () => {
    useAcpProfilesStore.setState({
      profiles: [
        {
          id: 'profile-1',
          alias: 'Research Agent',
          agentletId: 'agentlet-1',
          workingDirPath: '/tmp',
          launch: { kind: 'acp-command', command: 'agent' },
        },
      ],
    });
    useCanvasStore.getState()._setStateNoAutosave({
      nodes: [
        {
          id: 'question-1',
          type: 'question',
          selected: true,
          position: { x: 0, y: 0 },
          data: {
            threadId: 'thread-1',
            agentBinding: {
              kind: 'external',
              profileId: 'profile-1',
              alias: 'External',
            },
          },
        },
        {
          id: 'sketch-1',
          type: 'sketch',
          position: { x: 0, y: 0 },
          data: {},
        },
      ],
    });
    mocks.dispatch.mockResolvedValueOnce({ status: 'completed' });

    const button = await renderToolbar();
    expect(document.body.textContent).toContain('Research Agent');
    expect(
      document.body.querySelector(
        '[aria-label="Target agent: Research Agent"]',
      ),
    ).not.toBeNull();
    await act(async () => button.click());

    expect(button.disabled).toBe(false);
    expect(mocks.createQuestion).not.toHaveBeenCalled();
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        inputKind: 'ink-intent',
        session: expect.objectContaining({ threadId: 'thread-1' }),
      }),
    );
  });

  it('shows the cached Agent name for an unbound compose target', async () => {
    useChatStore.setState({
      bindingByThread: {
        'thread-1': {
          kind: 'external',
          profileId: 'profile-1',
          alias: 'Cached Agent',
        },
      },
      lastActionByThread: { 'thread-1': 'operate' },
    });
    useAcpProfilesStore.setState({
      profiles: [
        {
          id: 'profile-1',
          alias: 'Current Agent',
          agentletId: 'agentlet-1',
          workingDirPath: '/tmp',
          launch: { kind: 'acp-command', command: 'agent' },
        },
      ],
    });
    useCanvasStore.getState()._setStateNoAutosave({
      nodes: [
        {
          id: 'question-1',
          type: 'question',
          selected: true,
          position: { x: 0, y: 0 },
          data: { threadId: 'thread-1' },
        },
        {
          id: 'sketch-1',
          type: 'sketch',
          position: { x: 0, y: 0 },
          data: {},
        },
      ],
    });

    await mountToolbar();

    expect(document.body.textContent).toContain('Current Agent');
    expect(document.body.textContent).not.toContain('New · Huabu');
    const button = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Send ink request"]',
    );
    if (!button) throw new Error('Expected submit button');
    mocks.dispatch.mockResolvedValueOnce({ status: 'completed' });
    await act(async () => button.click());
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'operate' }),
    );
  });

  it('continues an internal Question in its persisted ask mode', async () => {
    useCanvasStore.getState()._setStateNoAutosave({
      nodes: [
        {
          id: 'question-1',
          type: 'question',
          selected: true,
          position: { x: 0, y: 0 },
          data: {
            threadId: 'thread-1',
            agentBinding: { kind: 'internal' },
            agentMode: 'ask',
          },
        },
        {
          id: 'sketch-1',
          type: 'sketch',
          position: { x: 0, y: 0 },
          data: {},
        },
      ],
    });
    mocks.dispatch.mockResolvedValueOnce({ status: 'completed' });
    const button = await renderToolbar();

    await act(async () => button.click());

    expect(mocks.createQuestion).not.toHaveBeenCalled();
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        inputKind: 'ink-intent',
        mode: 'ask',
        session: expect.objectContaining({
          threadId: 'thread-1',
          conversationView: expect.objectContaining({
            conversationOwner: expect.objectContaining({
              nodeId: 'question-1',
            }),
          }),
        }),
      }),
    );
  });

  it('creates and dispatches at most once for rapid activation', async () => {
    const pending = deferredResult();
    mocks.dispatch.mockReturnValueOnce(pending.promise);
    const button = await renderToolbar();

    act(() => {
      button.click();
      button.click();
    });

    expect(mocks.createQuestion).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);

    pending.resolve({ status: 'rejected' });
    await act(async () => pending.promise);
  });

  it('reuses the created Question when a rejected selection is retried', async () => {
    mocks.dispatch.mockResolvedValue({ status: 'rejected' });
    const button = await renderToolbar();

    await act(async () => button.click());
    await act(async () => button.click());

    expect(mocks.createQuestion).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledTimes(2);
  });

  it('keeps a newer selection when an earlier turn is accepted', async () => {
    const pending = deferredResult();
    let callbacks: AgentTurnCallbacks | undefined;
    mocks.dispatch.mockImplementationOnce(
      (_input: unknown, received: AgentTurnCallbacks) => {
        callbacks = received;
        return pending.promise;
      },
    );
    const button = await renderToolbar();

    act(() => button.click());
    useGesturePreviewStore.setState({
      sketchStrokeSelection: { 'sketch-1': ['stroke-2'] },
    });
    act(() =>
      callbacks?.onAccepted?.({ threadId: 'thread-1', turnStartSeq: 1 }),
    );

    expect(useGesturePreviewStore.getState().sketchStrokeSelection).toEqual({
      'sketch-1': ['stroke-2'],
    });
    pending.resolve({
      status: 'completed',
      accepted: { threadId: 'thread-1', turnStartSeq: 1 },
    });
    await act(async () => pending.promise);
  });

  it('keeps Ink when the whole-node source selection changed meanwhile', async () => {
    const pending = deferredResult();
    let callbacks: AgentTurnCallbacks | undefined;
    mocks.dispatch.mockImplementationOnce(
      (_input: unknown, received: AgentTurnCallbacks) => {
        callbacks = received;
        return pending.promise;
      },
    );
    const button = await renderToolbar();

    act(() => button.click());
    useCanvasStore.getState()._setStateNoAutosave({
      nodes: [
        {
          id: 'sketch-1',
          type: 'sketch',
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: 'note-1',
          type: 'note',
          selected: true,
          position: { x: 0, y: 0 },
          data: {},
        },
      ],
    });
    act(() =>
      callbacks?.onAccepted?.({ threadId: 'thread-1', turnStartSeq: 1 }),
    );

    expect(useGesturePreviewStore.getState().sketchStrokeSelection).toEqual({
      'sketch-1': ['stroke-1'],
    });
    pending.resolve({
      status: 'completed',
      accepted: { threadId: 'thread-1', turnStartSeq: 1 },
    });
    await act(async () => pending.promise);
  });

  it('clears the originating selection only after durable acceptance', async () => {
    const pending = deferredResult();
    let callbacks: AgentTurnCallbacks | undefined;
    mocks.dispatch.mockImplementationOnce(
      (_input: unknown, received: AgentTurnCallbacks) => {
        callbacks = received;
        return pending.promise;
      },
    );
    const button = await renderToolbar();

    act(() => button.click());
    expect(useGesturePreviewStore.getState().sketchStrokeSelection).toEqual({
      'sketch-1': ['stroke-1'],
    });
    act(() =>
      callbacks?.onAccepted?.({ threadId: 'thread-1', turnStartSeq: 1 }),
    );

    expect(useGesturePreviewStore.getState().sketchStrokeSelection).toEqual({});
    pending.resolve({
      status: 'completed',
      accepted: { threadId: 'thread-1', turnStartSeq: 1 },
    });
    await act(async () => pending.promise);
  });
});
