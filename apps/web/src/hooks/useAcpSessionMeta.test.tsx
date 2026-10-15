// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chatStore';
import { useConversationPreparationStore } from '@/store/conversationPreparation';

import { useAcpSessionMeta } from './useAcpSessionMeta';

const apiMocks = vi.hoisted(() => ({
  getCached: vi.fn(),
  loadProfile: vi.fn(),
  sink: vi.fn(),
}));

vi.mock('@/api/acp', () => ({
  getAcpThreadCachedMeta: apiMocks.getCached,
  loadAcpProfileCapabilities: apiMocks.loadProfile,
}));

vi.mock('@/hooks/useAgentStream', () => ({
  registerAcpSessionMetaSink: apiMocks.sink,
}));

const EMPTY_META = {
  availableModes: [],
  currentModeId: null,
  availableModels: [],
  currentModelId: null,
  configOptions: [],
  selections: {},
  sessionInfo: null,
  usage: null,
  updatedAt: 0,
};

function Harness({ profileId = 'profile-1' }: { profileId?: string }) {
  const { loading, source, meta, error, refresh } = useAcpSessionMeta({
    threadId: 'thread-1',
    binding: {
      kind: 'external',
      profileId,
      alias: 'Profile',
    },
    canvasId: 'canvas-1',
  });
  return (
    <button data-updated-at={meta.updatedAt} onClick={() => void refresh()}>
      {loading
        ? 'loading'
        : (error?.message ?? `${source}:${meta.configOptions.length}`)}
    </button>
  );
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  apiMocks.getCached.mockReset();
  apiMocks.loadProfile.mockReset();
  apiMocks.sink.mockReset();
  useChatStore.setState({ threadsById: {} });
  useConversationPreparationStore.setState({
    directories: {},
    executions: {},
    pending: {},
    locked: {},
    revisions: {},
  });
});

async function renderHarness(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<Harness />);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useAcpSessionMeta', () => {
  it('surfaces discovery errors and retries without setting execution facts', async () => {
    apiMocks.getCached.mockResolvedValue({
      source: 'none',
      sessionMeta: EMPTY_META,
    });
    apiMocks.loadProfile
      .mockRejectedValueOnce(new Error('Login required'))
      .mockResolvedValueOnce({
        source: 'profile',
        sessionMeta: { ...EMPTY_META, updatedAt: 1 },
      });
    await renderHarness();
    expect(container?.textContent).toBe('Login required');
    await act(async () => container?.querySelector('button')?.click());
    expect(container?.textContent).toBe('profile:0');
    expect(apiMocks.loadProfile).toHaveBeenCalledTimes(2);
    expect(useConversationPreparationStore.getState().executions).toEqual({});
  });

  it('ignores discovery from a previous Profile', async () => {
    let finish!: (value: {
      source: 'profile';
      sessionMeta: typeof EMPTY_META;
    }) => void;
    apiMocks.getCached.mockResolvedValue({
      source: 'none',
      sessionMeta: EMPTY_META,
    });
    apiMocks.loadProfile
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce({
        source: 'profile',
        sessionMeta: { ...EMPTY_META, updatedAt: 2 },
      });
    await renderHarness();
    await act(async () => root?.render(<Harness profileId="profile-2" />));
    await act(async () =>
      finish({
        source: 'profile',
        sessionMeta: { ...EMPTY_META, updatedAt: 1 },
      }),
    );
    expect(container?.textContent).toBe('profile:0');
    expect(container?.querySelector('button')?.dataset.updatedAt).toBe('2');
    expect(apiMocks.loadProfile).toHaveBeenLastCalledWith('profile-2');
    expect(useConversationPreparationStore.getState().executions).toEqual({});
  });

  it('keeps live thread metadata authoritative over an in-flight discovery', async () => {
    let finish!: (value: {
      source: 'profile';
      sessionMeta: typeof EMPTY_META;
    }) => void;
    apiMocks.getCached.mockResolvedValue({
      source: 'none',
      sessionMeta: EMPTY_META,
    });
    apiMocks.loadProfile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await renderHarness();
    const applyEvent = apiMocks.sink.mock.calls[0][1];
    await act(async () =>
      applyEvent({
        type: 'session_mode_update',
        data: {
          currentModeId: 'plan',
          availableModes: [{ id: 'plan', name: 'Plan' }],
        },
      }),
    );
    await act(async () =>
      finish({
        source: 'profile',
        sessionMeta: { ...EMPTY_META, updatedAt: 1 },
      }),
    );
    expect(container?.textContent).toBe('thread:0');
  });
  it('hydrates frozen directory facts and refreshes them after a streamed turn', async () => {
    const execution = {
      binding: {
        kind: 'external' as const,
        profileId: 'profile-1',
        alias: 'Profile',
      },
      workingDirPath: '/frozen/project',
    };
    apiMocks.getCached.mockResolvedValue({
      source: 'thread',
      availableCommands: [],
      commandsUpdatedAt: 0,
      sessionMeta: EMPTY_META,
      execution,
    });
    await renderHarness();
    expect(
      useConversationPreparationStore.getState().executions[
        '["canvas-1","thread-1"]'
      ],
    ).toEqual(execution);
    await act(async () => {
      useChatStore.getState().setThreadLoading('thread-1', true);
    });
    await act(async () => {
      useChatStore.getState().setThreadLoading('thread-1', false);
    });
    expect(apiMocks.getCached).toHaveBeenCalledTimes(2);
  });
  it('automatically discovers a cold Profile without realizing the conversation', async () => {
    apiMocks.getCached.mockResolvedValue({
      source: 'none',
      availableCommands: [],
      commandsUpdatedAt: 0,
      sessionMeta: EMPTY_META,
    });
    apiMocks.loadProfile.mockResolvedValue({
      source: 'profile',
      availableCommands: [],
      commandsUpdatedAt: 0,
      sessionMeta: { ...EMPTY_META, updatedAt: 1 },
    });

    await renderHarness();
    expect(apiMocks.getCached).toHaveBeenCalledOnce();
    expect(apiMocks.loadProfile).toHaveBeenCalledExactlyOnceWith('profile-1');
    expect(container?.textContent).toBe('profile:0');
    expect(useConversationPreparationStore.getState().executions).toEqual({});
    expect(
      Object.values(useConversationPreparationStore.getState().locked),
    ).not.toContain(true);
  });

  it('renders a Profile capability observation without warming a thread', async () => {
    apiMocks.getCached.mockResolvedValue({
      source: 'profile',
      availableCommands: [{ name: 'help', description: 'Help' }],
      commandsUpdatedAt: 1,
      sessionMeta: {
        ...EMPTY_META,
        currentModelId: 'model-1',
        configOptions: [
          {
            id: 'allow_all',
            name: 'Auto approve',
            type: 'boolean',
            currentValue: true,
          },
        ],
        updatedAt: 1,
      },
    });

    await renderHarness();

    expect(apiMocks.getCached).toHaveBeenCalledWith(
      'thread-1',
      'canvas-1',
      'profile-1',
    );
    expect(container?.textContent).toBe('profile:1');
    expect(apiMocks.loadProfile).not.toHaveBeenCalled();
  });
});
