// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Activity, act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageList } from './MessageList';
import {
  forgetMessageListScrollPosition,
  rememberMessageListScrollAnchor,
  rememberMessageListScrollPosition,
} from './messageListScroll';
import { readChatViewport } from '../../store/previewWorkspace/scrollMemory';

import type { ChatMessage } from '../../store/chatTypes';
import type { InkInterpretation } from '@huabu/shared';

const renderCounts = vi.hoisted(() => ({
  assistant: new Map<string, number>(),
  assistantEffects: [] as string[],
  user: 0,
  userInputKinds: [] as Array<string | undefined>,
  userInterpretations: [] as Array<InkInterpretation | undefined>,
  userGroundingValues: [] as unknown[],
}));

vi.mock('./AIMessage', async () => {
  const { memo, useEffect } = await import('react');
  return {
    AIMessage: memo(function MockAIMessage({
      messageId,
      endStatus,
      enableComments,
    }: {
      messageId: string;
      endStatus?: 'interrupted' | 'error';
      enableComments?: boolean;
    }) {
      renderCounts.assistant.set(
        messageId,
        (renderCounts.assistant.get(messageId) ?? 0) + 1,
      );
      useEffect(() => {
        renderCounts.assistantEffects.push(messageId);
      }, [messageId]);
      return (
        <div
          data-assistant-message={messageId}
          data-end-status={endStatus}
          data-comments={enableComments}
        />
      );
    }),
  };
});

vi.mock('./UserMessage', async () => {
  const { memo } = await import('react');
  return {
    UserMessage: memo(function MockUserMessage({
      isFirst,
      inputKind,
      inkInterpretation,
      groundingVisual,
    }: {
      isFirst?: boolean;
      inputKind?: string;
      inkInterpretation?: InkInterpretation;
      groundingVisual?: unknown;
    }) {
      renderCounts.user++;
      renderCounts.userInputKinds.push(inputKind);
      renderCounts.userInterpretations.push(inkInterpretation);
      renderCounts.userGroundingValues.push(groundingVisual);
      return <div data-user-message data-first={isFirst} />;
    }),
  };
});

vi.mock('./StatusMessage', () => ({
  StatusMessage: () => <div data-status-message />,
}));

vi.mock('../Common/Button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('../Common/Loading', () => ({
  Loading: () => <div data-loading />,
}));

vi.mock('../Common/ThinkingIndicator', () => ({
  ThinkingIndicator: () => <div data-thinking />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) => {
      if (key === 'chat.showEarlierTurns') {
        return `Show ${values?.count ?? 0} earlier turns`;
      }
      if (key === 'chat.loadingEarlierTurns') return 'Loading earlier turns…';
      if (key === 'chat.backToBottom') return 'Back to bottom';
      if (key === 'chat.newMessage') return 'New message';
      return key;
    },
  }),
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function mount(element: React.ReactNode): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(element));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  renderCounts.assistant.clear();
  renderCounts.assistantEffects = [];
  renderCounts.user = 0;
  renderCounts.userInputKinds = [];
  renderCounts.userInterpretations = [];
  renderCounts.userGroundingValues = [];
  vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MessageList leading user spacing', () => {
  it.each([false, true])(
    'marks only the leading rendered message as first when an assistant precedes it=%s',
    (withAssistant) => {
      const messages: ChatMessage[] = [
        { id: 'user-1', role: 'user', content: 'First question' },
        { id: 'user-2', role: 'user', content: 'Follow-up question' },
      ];
      if (withAssistant) {
        messages.unshift({
          id: 'assistant-1',
          role: 'assistant',
          segments: [{ kind: 'text', text: 'Earlier answer' }],
        });
      }
      mount(<MessageList messages={messages} isLoading={false} />);
      expect(
        [...(container?.querySelectorAll('[data-user-message]') ?? [])].map(
          (message) => message.getAttribute('data-first'),
        ),
      ).toEqual([String(!withAssistant), 'false']);
    },
  );
});

describe('MessageList comment availability', () => {
  it.each([
    [true, false],
    [true, true],
    [false, false],
    [false, true],
  ])(
    'follows panel visibility (%s) independently of history hydration (%s)',
    (isActive, isHistoryLoading) => {
      mount(
        <MessageList
          messages={[
            {
              id: 'visible-answer',
              role: 'assistant',
              segments: [{ kind: 'text', text: 'An already rendered answer' }],
            },
          ]}
          isLoading={false}
          isActive={isActive}
          isHistoryLoading={isHistoryLoading}
        />,
      );
      expect(
        container
          ?.querySelector('[data-assistant-message="visible-answer"]')
          ?.getAttribute('data-comments'),
      ).toBe(String(isActive));
    },
  );
});

describe('MessageList empty state', () => {
  it('shows the disclaimer only while the conversation is empty', () => {
    mount(<MessageList messages={[]} isLoading={false} />);

    expect(
      container?.querySelector('[data-chat-empty-disclaimer]')?.textContent,
    ).toBe('chat.aiContentDisclaimer');

    act(() =>
      root?.render(
        <MessageList
          messages={[{ id: 'user-1', role: 'user', content: 'Hello' }]}
          isLoading={false}
        />,
      ),
    );

    expect(container?.querySelector('[data-chat-empty-disclaimer]')).toBeNull();
  });
});

describe('MessageList bottom navigation', () => {
  const scrollTopDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollTop',
  );
  let height: number;
  let viewportHeight: number;
  let top: number;
  let resizes: Set<() => void>;
  let observe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    height = 1_000;
    viewportHeight = 200;
    top = 0;
    resizes = new Set();
    observe = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(
      () => height,
    );
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(
      () => viewportHeight,
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = Math.max(0, Math.min(value, height - viewportHeight));
      },
    });
    vi.mocked(HTMLElement.prototype.scrollTo).mockImplementation(function (
      this: HTMLElement,
      options?: ScrollToOptions | number,
    ) {
      if (typeof options === 'object') this.scrollTop = options.top ?? 0;
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        callback: () => void;
        constructor(callback: () => void) {
          this.callback = callback;
          resizes.add(callback);
        }
        observe = observe;
        disconnect() {
          resizes.delete(this.callback);
        }
      },
    );
  });

  afterEach(() => {
    if (scrollTopDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        'scrollTop',
        scrollTopDescriptor,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollTop');
    }
  });

  function thread(): HTMLElement {
    const element = container?.querySelector<HTMLElement>(
      '[data-chat-thread-root]',
    );
    if (!element) throw new Error('Thread is not mounted');
    return element;
  }

  function scrollTo(value: number): void {
    act(() => {
      thread().scrollTop = value;
      thread().dispatchEvent(new Event('scroll', { bubbles: true }));
    });
  }

  function resize(): void {
    act(() => {
      for (const callback of resizes) callback();
    });
  }

  function bottomButton(): HTMLButtonElement | undefined {
    return Array.from(container?.querySelectorAll('button') ?? []).find(
      (button) => /Back to bottom|New message/.test(button.textContent ?? ''),
    );
  }

  it('shows back-to-bottom only beyond 50px even without new messages', () => {
    mount(<MessageList messages={[]} isLoading={false} />);
    expect(top).toBe(800);
    scrollTo(750);
    expect(bottomButton()).toBeUndefined();
    scrollTo(749);
    expect(bottomButton()?.textContent).toContain('Back to bottom');
    expect(bottomButton()?.querySelector('svg')).toBeNull();
    scrollTo(750);
    expect(bottomButton()).toBeUndefined();
  });

  it('jumps instantly and follows late content and viewport growth', () => {
    mount(<MessageList messages={[]} isLoading={false} />);
    scrollTo(100);
    act(() => bottomButton()?.click());
    expect(top).toBe(800);
    expect(bottomButton()).toBeUndefined();
    expect(HTMLElement.prototype.scrollTo).toHaveBeenLastCalledWith({
      top: 1_000,
      behavior: 'instant',
    });
    height = 1_500;
    resize();
    expect(top).toBe(1_300);
    viewportHeight = 100;
    resize();
    expect(top).toBe(1_400);
    expect(observe).toHaveBeenCalledWith(thread());
    expect(observe).toHaveBeenCalledWith(thread().firstElementChild);
    for (const args of vi.mocked(HTMLElement.prototype.scrollTo).mock.calls) {
      expect(args).toEqual([expect.objectContaining({ behavior: 'instant' })]);
    }
  });

  it('skips anchor geometry for bottom snapshots while preserving reading anchors', () => {
    const viewKey = 'bottom-snapshot-geometry';
    const messages = history(10);
    const view = () => (
      <MessageList
        messages={messages}
        recentTurnCount={10}
        isLoading
        viewKey={viewKey}
      />
    );
    const geometry = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 300, 200));
    mount(view());
    geometry.mockClear();
    height = 1200;
    resize();
    act(() =>
      root?.render(
        <MessageList
          messages={[
            ...messages,
            {
              id: 'stream',
              role: 'assistant',
              segments: [{ kind: 'text', text: 'New output' }],
            },
          ]}
          recentTurnCount={10}
          isLoading
          viewKey={viewKey}
        />,
      ),
    );
    expect(geometry).not.toHaveBeenCalled();
    expect(readChatViewport(viewKey)).toMatchObject({ atBottom: true });
    expect(readChatViewport(viewKey)?.messageAnchor).toBeUndefined();
    scrollTo(100);
    expect(geometry).toHaveBeenCalled();
    expect(readChatViewport(viewKey)).toMatchObject({
      atBottom: false,
      messageAnchor: { messageId: 'u0', offsetTop: 0 },
    });
    act(() => bottomButton()?.click());
    geometry.mockClear();
    height = 1400;
    resize();
    expect(geometry).not.toHaveBeenCalled();
    expect(readChatViewport(viewKey)?.messageAnchor).toBeUndefined();
    forgetMessageListScrollPosition(viewKey);
  });

  it('does not hide the button before the scroll actually reaches bottom', () => {
    mount(<MessageList messages={[]} isLoading={false} />);
    scrollTo(100);
    vi.mocked(HTMLElement.prototype.scrollTo).mockImplementation(() => {});
    act(() => bottomButton()?.click());
    expect(top).toBe(100);
    expect(bottomButton()).toBeDefined();
  });

  it('keeps following when growth emits a scroll event without movement', () => {
    mount(<MessageList messages={[]} isLoading={false} />);
    height = 1_500;
    act(() => thread().dispatchEvent(new Event('scroll')));
    resize();
    expect(top).toBe(1_300);
    expect(bottomButton()).toBeUndefined();
  });

  it('never pulls a paused reader down on delayed resize or streamed updates', () => {
    const tail: ChatMessage = {
      id: 'assistant-live',
      role: 'assistant',
      segments: [{ kind: 'text', text: 'First' }],
    };
    mount(<MessageList messages={[tail]} isLoading />);
    scrollTo(100);
    height = 1_500;
    resize();
    expect(top).toBe(100);
    expect(bottomButton()?.textContent).toContain('Back to bottom');
    act(() =>
      root?.render(
        <MessageList
          messages={[
            { ...tail, segments: [{ kind: 'text', text: 'More output' }] },
          ]}
          isLoading
        />,
      ),
    );
    expect(top).toBe(100);
    expect(bottomButton()?.textContent).toContain('New message');
    scrollTo(1_300);
    expect(bottomButton()).toBeUndefined();
    height = 1_700;
    resize();
    expect(top).toBe(1_500);
  });

  it('honors an upward gesture before resize without preventing native scrolling', () => {
    mount(<MessageList messages={[]} isLoading={false} />);
    expect(thread().style.overflowAnchor).toBe('none');
    const wheel = new WheelEvent('wheel', {
      deltaY: -100,
      bubbles: true,
      cancelable: true,
    });
    act(() => thread().dispatchEvent(wheel));
    expect(thread().style.overflowAnchor).toBe('auto');
    height = 1_500;
    resize();
    expect(wheel.defaultPrevented).toBe(false);
    expect(top).toBe(800);
    expect(bottomButton()).toBeDefined();
    act(() => bottomButton()?.click());
    expect(thread().style.overflowAnchor).toBe('none');
  });

  it('does not stop following for downward wheel input already at bottom', () => {
    mount(<MessageList messages={[]} isLoading={false} />);
    act(() =>
      thread().dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: 100,
          bubbles: true,
        }),
      ),
    );
    height = 1_500;
    resize();
    expect(top).toBe(1_300);
  });

  it('does not undo native scrolling before its scroll event arrives', () => {
    mount(<MessageList messages={[]} isLoading={false} />);
    thread().scrollTop = 100;
    height = 1_500;
    resize();
    expect(top).toBe(100);
    expect(bottomButton()).toBeDefined();
  });

  it('keeps keyboard focus in the thread after activating the bottom action', () => {
    mount(<MessageList messages={[]} isLoading={false} />);
    scrollTo(100);
    const button = bottomButton();
    button?.focus();
    act(() => button?.click());
    expect(document.activeElement).toBe(thread());
    expect(top).toBe(800);
    act(() =>
      thread().dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'End',
          bubbles: true,
        }),
      ),
    );
    height = 1_500;
    resize();
    expect(top).toBe(1_300);
    act(() =>
      thread().dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'PageUp',
          bubbles: true,
        }),
      ),
    );
    height = 1_700;
    resize();
    expect(top).toBe(1_300);
  });

  it('does not flag a prepend with the same tail as new output', () => {
    const tail: ChatMessage = {
      id: 'current',
      role: 'user',
      content: 'Current',
    };
    mount(<MessageList messages={[tail]} isLoading={false} />);
    scrollTo(100);
    act(() =>
      root?.render(
        <MessageList
          messages={[{ id: 'older', role: 'user', content: 'Older' }, tail]}
          isLoading={false}
        />,
      ),
    );
    expect(top).toBe(100);
    expect(bottomButton()?.textContent).toContain('Back to bottom');
  });

  it('waits for hydration and disconnects observers on unmount', () => {
    mount(<MessageList messages={[]} isLoading={false} isHistoryLoading />);
    expect(top).toBe(0);
    expect(bottomButton()).toBeUndefined();
    act(() => root?.render(<MessageList messages={[]} isLoading={false} />));
    expect(top).toBe(800);
    expect(resizes.size).toBe(1);
    act(() => root?.unmount());
    root = undefined;
    expect(resizes.size).toBe(0);
  });

  it('ignores hidden-tab scroll events and resize callbacks', () => {
    mount(
      <div data-preview-active="true">
        <MessageList messages={[]} isLoading={false} />
      </div>,
    );
    const wrapper = container?.querySelector<HTMLElement>(
      '[data-preview-active]',
    );
    wrapper?.setAttribute('data-preview-active', 'false');
    height = 1_500;
    resize();
    expect(top).toBe(800);
    wrapper?.setAttribute('data-preview-active', 'true');
    resize();
    expect(top).toBe(1_300);
  });

  const history = (count: number): ChatMessage[] =>
    Array.from({ length: count }, (_, index): ChatMessage[] => [
      { id: `u${index}`, role: 'user', content: `Turn ${index}` },
      {
        id: `a${index}`,
        role: 'assistant',
        segments: [{ kind: 'text', text: `Reply ${index}` }],
      },
    ]).flat();
  const messageIds = () =>
    Array.from(
      thread().querySelectorAll<HTMLElement>('[data-chat-message-id]'),
      (element) => element.dataset.chatMessageId,
    );
  const earlier = () =>
    Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('earlier turns'),
    );

  it('mounts only recent cached turns and expands cache before fetching', () => {
    const messages = history(10);
    const fetchOlder = vi.fn();
    mount(
      <MessageList
        messages={messages}
        isLoading={false}
        recentTurnCount={3}
        hasOlderHistory
        onLoadOlderHistory={fetchOlder}
      />,
    );
    expect(messageIds()).toEqual(['u7', 'a7', 'u8', 'a8', 'u9', 'a9']);
    expect([...renderCounts.assistant.keys()]).toEqual(['a7', 'a8', 'a9']);
    act(() => earlier()?.click());
    expect(messageIds()).toHaveLength(12);
    expect(fetchOlder).not.toHaveBeenCalled();
    act(() => earlier()?.click());
    act(() => earlier()?.click());
    expect(messageIds()).toHaveLength(20);
    expect(fetchOlder).not.toHaveBeenCalled();
    act(() => earlier()?.click());
    expect(fetchOlder).toHaveBeenCalledTimes(1);
    expect(messages).toHaveLength(20);
  });

  it('does not reset expanded history on ordinary rerenders, but does on activation', () => {
    const messages = history(10);
    const view = (activationId: number) => (
      <MessageList
        messages={messages}
        recentTurnCount={3}
        isLoading={false}
        activationId={activationId}
      />
    );
    mount(view(0));
    act(() => earlier()?.click());
    act(() => root?.render(view(0)));
    expect(messageIds()).toHaveLength(12);
    act(() => root?.render(view(1)));
    expect(messageIds()).toHaveLength(6);
    expect(top).toBe(800);
  });

  it.each(['warm', 'cold', 'hydration'])(
    'restores unchanged history and its reading offset after %s activation',
    (kind) => {
      const viewKey = `unchanged-${kind}`;
      vi.spyOn(
        HTMLElement.prototype,
        'getBoundingClientRect',
      ).mockImplementation(function (this: HTMLElement) {
        const id = this.dataset.chatMessageId;
        const y = id ? (id === 'u4' ? 400 : 0) - top : 0;
        return new DOMRect(0, y, 300, id ? 200 : 200);
      });
      const view = (
        active: boolean,
        activationId: number,
        hydrating = false,
      ) => (
        <Activity mode={active ? 'visible' : 'hidden'}>
          <MessageList
            messages={hydrating ? [] : history(10)}
            recentTurnCount={3}
            isLoading={false}
            isHistoryLoading={hydrating}
            viewKey={viewKey}
            activationId={activationId}
            isActive={active}
          />
        </Activity>
      );
      mount(view(true, 0));
      act(() => earlier()?.click());
      scrollTo(410);
      expect(messageIds()[0]).toBe('u4');
      if (kind === 'warm') {
        act(() => root?.render(view(false, 0)));
      } else {
        act(() => root?.unmount());
        root = undefined;
        container?.remove();
        container = undefined;
        top = 0;
        mount(view(true, 1, kind === 'hydration'));
      }
      act(() => root?.render(view(true, 1)));
      expect(messageIds()[0]).toBe('u4');
      expect(top).toBe(410);
      height = 1_200;
      resize();
      expect(top).toBe(410);
      forgetMessageListScrollPosition(viewKey);
    },
  );

  it.each(['before-frame', 'after-frame'])(
    'keeps a clamped non-bottom restoration paused when content grows %s',
    (growth) => {
      vi.useFakeTimers();
      const viewKey = `clamped-restore-${growth}`;
      vi.spyOn(
        HTMLElement.prototype,
        'getBoundingClientRect',
      ).mockImplementation(function (this: HTMLElement) {
        const id = this.dataset.chatMessageId;
        return new DOMRect(0, id ? (id === 'u4' ? 400 : 0) - top : 0, 300, 200);
      });
      const view = () => (
        <MessageList
          messages={history(10)}
          recentTurnCount={3}
          isLoading={false}
          viewKey={viewKey}
        />
      );
      try {
        mount(view());
        act(() => earlier()?.click());
        scrollTo(410);
        act(() => root?.unmount());
        root = undefined;
        container?.remove();
        container = undefined;
        height = 600;
        top = 0;
        mount(view());
        expect(top).toBe(400);
        expect(thread().style.overflowAnchor).toBe('none');
        if (growth === 'after-frame') act(() => vi.advanceTimersByTime(32));
        height = 1200;
        resize();
        if (growth === 'before-frame') act(() => vi.advanceTimersByTime(32));
        expect(top).toBe(410);
        act(() => vi.advanceTimersByTime(501));
        expect(thread().style.overflowAnchor).toBe('auto');
        height = 1400;
        resize();
        expect(top).toBe(410);
        expect(bottomButton()?.textContent).toBe('Back to bottom');
        act(() => bottomButton()?.click());
        expect(top).toBe(1200);
        height = 1600;
        resize();
        expect(top).toBe(1400);
      } finally {
        act(() => root?.unmount());
        root = undefined;
        forgetMessageListScrollPosition(viewKey);
        vi.useRealTimers();
      }
    },
  );

  it.each(['appended', 'streamed', 'prepended', 'explicit'])(
    'handles %s content when reactivating a saved viewport',
    (change) => {
      const viewKey = `changed-${change}`;
      const original = history(10);
      const view = (
        messages: ChatMessage[],
        active: boolean,
        activationId: number,
      ) => (
        <MessageList
          messages={messages}
          recentTurnCount={3}
          isLoading={false}
          viewKey={viewKey}
          isActive={active}
          activationId={activationId}
          openPositionRequestNonce={
            change === 'explicit' && activationId === 1 ? 1 : undefined
          }
        />
      );
      mount(view(original, true, 0));
      act(() => earlier()?.click());
      scrollTo(410);
      act(() => root?.render(view(original, false, 0)));
      const changed =
        change === 'appended'
          ? history(11)
          : change === 'streamed'
            ? [
                ...original.slice(0, -1),
                {
                  id: 'a9',
                  role: 'assistant' as const,
                  segments: [
                    { kind: 'text' as const, text: 'More streamed text' },
                  ],
                },
              ]
            : change === 'prepended'
              ? [
                  { id: 'older', role: 'user' as const, content: 'Earlier' },
                  ...original,
                ]
              : original;
      act(() => root?.render(view(changed, false, 0)));
      act(() => root?.render(view(changed, true, 1)));
      expect(top).toBe(change === 'prepended' ? 410 : 800);
      expect(messageIds()[0]).toBe(
        change === 'appended' ? 'u8' : change === 'prepended' ? 'u4' : 'u7',
      );
      forgetMessageListScrollPosition(viewKey);
    },
  );

  it('preserves bottom rather than restoring an older reading bookmark', () => {
    const viewKey = 'unchanged-at-bottom';
    const view = (activationId: number) => (
      <MessageList
        messages={history(10)}
        recentTurnCount={3}
        isLoading={false}
        activationId={activationId}
        viewKey={viewKey}
      />
    );
    mount(view(0));
    scrollTo(200);
    act(() => bottomButton()?.click());
    act(() => root?.render(view(1)));
    expect(top).toBe(800);
    expect(messageIds()[0]).toBe('u7');
    forgetMessageListScrollPosition(viewKey);
  });

  it('selects the recent window before a retained Activity reconnects without scroll memory', () => {
    const messages = history(10);
    const view = (active: boolean, activationId: number) => (
      <Activity mode={active ? 'visible' : 'hidden'}>
        <MessageList
          messages={messages}
          recentTurnCount={3}
          isLoading={false}
          activationId={activationId}
          isActive={active}
        />
      </Activity>
    );
    mount(view(true, 0));
    act(() => earlier()?.click());
    act(() => root?.render(view(false, 0)));
    renderCounts.assistant.clear();
    renderCounts.assistantEffects = [];
    act(() => root?.render(view(true, 1)));
    expect(messageIds()).toHaveLength(6);
    expect(
      [...renderCounts.assistant.keys()].every((id) =>
        ['a7', 'a8', 'a9'].includes(id),
      ),
    ).toBe(true);
    expect(renderCounts.assistantEffects).toEqual(['a7', 'a8', 'a9']);
  });

  it('grows during a turn and compacts only on genuine completion', () => {
    mount(
      <MessageList
        messages={history(3)}
        recentTurnCount={3}
        isLoading={false}
      />,
    );
    const grown = history(4);
    act(() =>
      root?.render(
        <MessageList messages={grown} recentTurnCount={3} isLoading />,
      ),
    );
    expect(messageIds()).toHaveLength(8);
    act(() =>
      root?.render(
        <MessageList messages={grown} recentTurnCount={3} isLoading={false} />,
      ),
    );
    expect(messageIds()).toHaveLength(8);
    act(() =>
      root?.render(
        <MessageList
          messages={grown}
          recentTurnCount={3}
          isLoading={false}
          completedTurnId="a3"
        />,
      ),
    );
    expect(messageIds()).toHaveLength(6);
    expect(messageIds()[0]).toBe('u1');
    expect(top).toBe(800);
  });

  it('does not compact an upward-reading gesture even before its scroll event', () => {
    mount(
      <MessageList
        messages={history(3)}
        recentTurnCount={3}
        isLoading={false}
      />,
    );
    act(() =>
      thread().dispatchEvent(
        new WheelEvent('wheel', { deltaY: -100, bubbles: true }),
      ),
    );
    act(() =>
      root?.render(
        <MessageList
          messages={history(4)}
          recentTurnCount={3}
          isLoading={false}
          completedTurnId="a3"
        />,
      ),
    );
    expect(messageIds()).toHaveLength(8);
  });

  it('does not compact or override native scrolling before its event at completion', () => {
    mount(
      <MessageList
        messages={history(3)}
        recentTurnCount={3}
        isLoading={false}
      />,
    );
    thread().scrollTop = 100;
    act(() =>
      root?.render(
        <MessageList
          messages={history(4)}
          recentTurnCount={3}
          isLoading={false}
          completedTurnId="a3"
        />,
      ),
    );
    expect(messageIds()).toHaveLength(8);
    expect(top).toBe(100);
  });

  it('protects expanded history at completion and compacts on explicit return to latest', () => {
    mount(
      <MessageList
        messages={history(6)}
        recentTurnCount={3}
        isLoading={false}
      />,
    );
    act(() => earlier()?.click());
    scrollTo(100);
    act(() =>
      root?.render(
        <MessageList
          messages={history(7)}
          recentTurnCount={3}
          isLoading={false}
          completedTurnId="a6"
        />,
      ),
    );
    expect(messageIds()).toHaveLength(14);
    expect(top).toBe(100);
    act(() => bottomButton()?.click());
    expect(messageIds()).toHaveLength(6);
    expect(top).toBe(800);
  });

  it('does not compact or scroll a hidden conversation on completion', () => {
    const view = (messages: ChatMessage[], active: boolean, done?: string) => (
      <MessageList
        messages={messages}
        recentTurnCount={3}
        isLoading={false}
        isActive={active}
        completedTurnId={done}
      />
    );
    mount(view(history(3), true));
    act(() => root?.render(view(history(4), false, 'a3')));
    expect(messageIds()).toHaveLength(8);
    expect(top).toBe(800);
  });

  it('materializes cached history for explicit search and protects the target', () => {
    mount(
      <MessageList
        messages={history(10)}
        recentTurnCount={3}
        isLoading={false}
      />,
    );
    const request = new Event('chat-reveal-search', { cancelable: true });
    act(() => thread().dispatchEvent(request));
    expect(request.defaultPrevented).toBe(true);
    expect(messageIds()).toHaveLength(20);
    act(() =>
      root?.render(
        <MessageList
          messages={history(11)}
          recentTurnCount={3}
          isLoading={false}
          completedTurnId="a10"
        />,
      ),
    );
    expect(messageIds()).toHaveLength(22);
  });

  it('hydrates a recent window without ever mounting the full fetched array', () => {
    mount(
      <MessageList
        messages={[]}
        recentTurnCount={3}
        isLoading={false}
        isHistoryLoading
      />,
    );
    act(() =>
      root?.render(
        <MessageList
          messages={history(10)}
          recentTurnCount={3}
          isLoading={false}
        />,
      ),
    );
    expect(messageIds()).toHaveLength(6);
    expect(renderCounts.user).toBe(3);
  });

  it('opens at latest without overwriting a bookmark and reveals it from cache on request', () => {
    const viewKey = 'reading-return-test';
    const source = document.createElement('div');
    const anchor = document.createElement('div');
    anchor.dataset.chatMessageId = 'u2';
    anchor.getBoundingClientRect = () => ({ top: 10, bottom: 100 }) as DOMRect;
    source.appendChild(anchor);
    rememberMessageListScrollAnchor(source, viewKey);
    const fetchOlder = vi.fn();
    mount(
      <MessageList
        messages={history(10)}
        recentTurnCount={3}
        isLoading={false}
        viewKey={viewKey}
        onLoadOlderHistory={fetchOlder}
      />,
    );
    expect(messageIds()[0]).toBe('u7');
    expect(top).toBe(800);
    act(() => thread().dispatchEvent(new Event('scroll')));
    const button = Array.from(container?.querySelectorAll('button') ?? []).find(
      (entry) => entry.textContent === 'chat.returnToReadingPosition',
    );
    expect(button).toBeDefined();
    button?.focus();
    act(() => button?.click());
    expect(messageIds()[0]).toBe('u2');
    expect(document.activeElement).toBe(thread());
    expect(fetchOlder).not.toHaveBeenCalled();
    forgetMessageListScrollPosition(viewKey);
  });

  it('reports an unavailable reading target without fetching history', () => {
    const viewKey = 'missing-return-test';
    const source = document.createElement('div');
    const anchor = document.createElement('div');
    anchor.dataset.chatMessageId = 'no-longer-cached';
    anchor.getBoundingClientRect = () => ({ top: 10, bottom: 100 }) as DOMRect;
    source.appendChild(anchor);
    rememberMessageListScrollAnchor(source, viewKey);
    const fetchOlder = vi.fn();
    mount(
      <MessageList
        messages={history(10)}
        recentTurnCount={3}
        isLoading={false}
        viewKey={viewKey}
        onLoadOlderHistory={fetchOlder}
      />,
    );
    act(() =>
      Array.from(container?.querySelectorAll('button') ?? [])
        .find((entry) => entry.textContent === 'chat.returnToReadingPosition')
        ?.click(),
    );
    expect(container?.querySelector('[role="status"]')?.textContent).toBe(
      'chat.readingPositionUnavailable',
    );
    expect(thread().querySelector('[role="status"]')).toBeNull();
    expect(messageIds()).toHaveLength(6);
    expect(fetchOlder).not.toHaveBeenCalled();
    forgetMessageListScrollPosition(viewKey);
  });

  describe('floating reading-position navigation', () => {
    const viewKey = 'floating-reading-test';
    const returnButton = () =>
      Array.from(container?.querySelectorAll('button') ?? []).find(
        (button) => button.textContent === 'chat.returnToReadingPosition',
      );

    function bookmark(messageId = 'u8', offsetTop = -10) {
      const source = document.createElement('div');
      const anchor = document.createElement('div');
      anchor.dataset.chatMessageId = messageId;
      anchor.getBoundingClientRect = () => new DOMRect(0, offsetTop, 300, 500);
      source.appendChild(anchor);
      rememberMessageListScrollAnchor(source, viewKey);
    }

    beforeEach(() => {
      bookmark();
      vi.spyOn(
        HTMLElement.prototype,
        'getBoundingClientRect',
      ).mockImplementation(function (this: HTMLElement) {
        return this.dataset.chatMessageId === 'u8'
          ? new DOMRect(0, 400 - top, 300, 500)
          : new DOMRect(0, 0, 300, 200);
      });
    });

    afterEach(() => forgetMessageListScrollPosition(viewKey));

    const view = (
      props: Partial<React.ComponentProps<typeof MessageList>> = {},
    ) => (
      <MessageList
        messages={history(10)}
        recentTurnCount={3}
        isLoading={false}
        viewKey={viewKey}
        {...props}
      />
    );

    it('skips retired bookmark scans during bottom-follow updates', () => {
      mount(view());
      expect(returnButton()).toBeDefined();
      scrollTo(350);
      act(() => bottomButton()?.click());
      expect(returnButton()).toBeUndefined();
      const geometry = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
      geometry.mockClear();
      const query = vi.spyOn(thread(), 'querySelectorAll');
      height = 1200;
      resize();
      act(() =>
        root?.render(
          view({
            messages: [
              ...history(10),
              {
                id: 'stream',
                role: 'assistant',
                segments: [{ kind: 'text', text: 'New output' }],
              },
            ],
            isLoading: true,
          }),
        ),
      );
      expect(query).not.toHaveBeenCalled();
      expect(geometry).not.toHaveBeenCalled();
      expect(top).toBe(1000);
      expect(returnButton()).toBeUndefined();
    });

    it('floats outside history and retires after a successful return', () => {
      mount(view());
      expect(returnButton()).toBeDefined();
      expect(thread().contains(returnButton() ?? null)).toBe(false);
      expect(returnButton()?.className).toContain('absolute top-12');
      expect(thread().contains(earlier() ?? null)).toBe(true);

      scrollTo(350);
      expect(returnButton()).toBeDefined();
      expect(bottomButton()).toBeDefined();
      returnButton()?.focus();
      act(() => returnButton()?.click());
      expect(top).toBe(410);
      expect(returnButton()).toBeUndefined();
      expect(document.activeElement).toBe(thread());

      scrollTo(500);
      expect(returnButton()).toBeUndefined();
    });

    it('retires after manually reaching the saved position without reappearing', () => {
      mount(view());
      scrollTo(408);
      expect(returnButton()).toBeUndefined();
      scrollTo(500);
      expect(returnButton()).toBeUndefined();
    });

    function wheel(deltaY: number, to: number) {
      act(() =>
        thread().dispatchEvent(
          new WheelEvent('wheel', { bubbles: true, deltaY }),
        ),
      );
      scrollTo(to);
    }

    it('requires a full viewport of intentional downward reading, not a small scroll', () => {
      mount(view());
      scrollTo(500);
      wheel(100, 600);
      expect(returnButton()).toBeDefined();
      wheel(99, 699);
      expect(returnButton()).toBeDefined();
      wheel(1, 700);
      expect(returnButton()).toBeUndefined();
      wheel(-100, 600);
      expect(returnButton()).toBeUndefined();
    });

    it('keeps the return action for upward browsing and resets downward progress', () => {
      mount(view());
      wheel(-300, 500);
      wheel(150, 650);
      wheel(-50, 600);
      wheel(150, 750);
      expect(returnButton()).toBeDefined();
      wheel(50, 800);
      expect(returnButton()).toBeUndefined();
    });

    it('does not count programmatic, expired, nested or zero-distance scrolling', () => {
      mount(view());
      scrollTo(500);
      scrollTo(800);
      expect(returnButton()).toBeDefined();
      wheel(500, 800);
      expect(returnButton()).toBeDefined();
      scrollTo(500);
      const now = vi.spyOn(performance, 'now').mockReturnValue(0);
      act(() =>
        thread().dispatchEvent(
          new WheelEvent('wheel', { bubbles: true, deltaY: 200 }),
        ),
      );
      now.mockReturnValue(251);
      scrollTo(700);
      expect(returnButton()).toBeDefined();
      const nested = document.createElement('div');
      nested.style.overflowY = 'auto';
      thread().appendChild(nested);
      act(() =>
        nested.dispatchEvent(
          new WheelEvent('wheel', { bubbles: true, deltaY: 500 }),
        ),
      );
      scrollTo(800);
      expect(returnButton()).toBeDefined();
      nested.remove();
      height = 1_500;
      resize();
      expect(returnButton()).toBeDefined();
    });

    it.each(['keyboard', 'touch', 'scrollbar'])(
      'dismisses after one viewport using %s',
      (input) => {
        mount(view());
        scrollTo(500);
        act(() => {
          if (input === 'keyboard') {
            thread().dispatchEvent(
              new KeyboardEvent('keydown', { bubbles: true, key: 'PageDown' }),
            );
          } else if (input === 'touch') {
            thread().dispatchEvent(
              new TouchEvent('touchstart', {
                bubbles: true,
                touches: [
                  new Touch({ identifier: 1, target: thread(), clientY: 300 }),
                ],
              }),
            );
            thread().dispatchEvent(
              new TouchEvent('touchmove', {
                bubbles: true,
                touches: [
                  new Touch({ identifier: 1, target: thread(), clientY: 100 }),
                ],
              }),
            );
          } else {
            thread().dispatchEvent(
              new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }),
            );
          }
        });
        scrollTo(700);
        expect(returnButton()).toBeUndefined();
      },
    );

    it('dismisses when choosing latest or submitting, without affecting another activation', () => {
      mount(view({ submissionNonce: 0 }));
      scrollTo(500);
      act(() => bottomButton()?.click());
      expect(returnButton()).toBeUndefined();
      scrollTo(500);
      expect(returnButton()).toBeUndefined();
      bookmark('u2');
      act(() =>
        root?.render(
          view({ activationId: 1, submissionNonce: 0, messages: history(11) }),
        ),
      );
      expect(returnButton()).toBeDefined();
      act(() =>
        root?.render(
          view({ activationId: 1, submissionNonce: 1, messages: history(11) }),
        ),
      );
      expect(returnButton()).toBeUndefined();
    });

    it.each([-400, -450])(
      'retires at the initial clamped position and stays hidden after resizing (offset %s)',
      (offset) => {
        bookmark('u8', offset);
        mount(view());
        expect(top).toBe(800);
        expect(returnButton()).toBeUndefined();
        height = 1_200;
        resize();
        expect(top).toBe(1_000);
        expect(returnButton()).toBeUndefined();
      },
    );

    it('keeps an inactive or hydrating panel quiet and isolates conversation targets', () => {
      mount(view({ isHistoryLoading: true }));
      expect(returnButton()).toBeUndefined();
      act(() => root?.render(view({ isActive: false })));
      expect(returnButton()).toBeUndefined();
      act(() => root?.render(view()));
      expect(returnButton()).toBeDefined();
      act(() => root?.render(view({ viewKey: 'no-reading-bookmark' })));
      expect(returnButton()).toBeUndefined();
      bookmark();
      act(() => root?.render(view({ activationId: 1 })));
      expect(returnButton()).toBeUndefined();
    });

    it('yields to explicit open positioning and search navigation', () => {
      mount(view({ openPositionRequestNonce: 1 }));
      expect(returnButton()).toBeUndefined();
      act(() => root?.render(view({ activationId: 1, messages: history(11) })));
      expect(returnButton()).toBeDefined();
      act(() =>
        thread().dispatchEvent(
          new Event('chat-reveal-search', { cancelable: true }),
        ),
      );
      expect(returnButton()).toBeUndefined();
      scrollTo(500);
      expect(returnButton()).toBeUndefined();
    });
  });

  it('keeps the reading window across live-to-history ID reconciliation', () => {
    const messages = history(10);
    mount(
      <MessageList messages={messages} recentTurnCount={3} isLoading={false} />,
    );
    act(() => earlier()?.click());
    scrollTo(100);
    const hydrated = messages.map((message, index) => ({
      ...message,
      id: `server-${index}`,
      historyTurnId: `turn-${Math.floor(index / 2)}`,
    }));
    act(() =>
      root?.render(
        <MessageList
          messages={hydrated}
          recentTurnCount={3}
          isLoading={false}
        />,
      ),
    );
    expect(messageIds()).toHaveLength(12);
    expect(messageIds()[0]).toBe('server-8');
    expect(top).toBe(100);
  });
});

describe('MessageList render isolation', () => {
  it.each(['interrupted', 'error'] as const)(
    'forwards %s only to the immediately preceding assistant message',
    (status) => {
      mount(
        <MessageList
          messages={[
            { id: 'user-1', role: 'user', content: 'First request' },
            { id: 'earlier', role: 'assistant', segments: [] },
            { id: 'stopped', role: 'assistant', segments: [] },
            { id: 'status-1', role: 'status', status },
            { id: 'user-2', role: 'user', content: 'Next request' },
            { id: 'next', role: 'assistant', segments: [] },
          ]}
          isLoading={false}
        />,
      );
      expect(
        container
          ?.querySelector('[data-assistant-message="stopped"]')
          ?.getAttribute('data-end-status'),
      ).toBe(status);
      expect(
        container
          ?.querySelector('[data-assistant-message="earlier"]')
          ?.hasAttribute('data-end-status'),
      ).toBe(false);
      expect(
        container
          ?.querySelector('[data-assistant-message="next"]')
          ?.hasAttribute('data-end-status'),
      ).toBe(false);
    },
  );

  it('forwards the persisted input kind to user-message rendering', () => {
    mount(
      <MessageList
        messages={[
          {
            id: 'ink-user',
            role: 'user',
            content: '',
            inputKind: 'ink-intent',
            inkInterpretation: {
              state: 'reported',
              text: 'Expand the third step',
              explanation: 'The arrow points at step three.',
            },
            groundingVisual: {
              kind: 'visible-canvas',
              dataUrl: 'data:image/png;base64,cG5n',
              viewport: {
                x: 0,
                y: 0,
                zoom: 1,
                width: 100,
                height: 100,
                devicePixelRatio: 1,
              },
              crop: { x: 0, y: 0, width: 100, height: 100 },
              selectedNodeIds: ['note-1'],
              strokeSubsets: [{ nodeId: 'sketch-1', strokeIds: ['stroke-1'] }],
            },
          },
        ]}
        isLoading={false}
      />,
    );

    expect(renderCounts.userInputKinds).toEqual(['ink-intent']);
    expect(renderCounts.userInterpretations).toEqual([
      {
        state: 'reported',
        text: 'Expand the third step',
        explanation: 'The arrow points at step three.',
      },
    ]);
    expect(renderCounts.userGroundingValues).toEqual([undefined]);
  });

  it('does not rerender historical messages when a sibling draft changes', () => {
    const messages: ChatMessage[] = Array.from(
      { length: 100 },
      (_, index): ChatMessage[] => [
        {
          id: `user-${index}`,
          role: 'user',
          content: `Question ${index}`,
        },
        {
          id: `assistant-${index}`,
          role: 'assistant',
          segments: [
            {
              kind: 'text',
              text: `## Answer ${index}\n\nA representative Markdown response.`,
            },
          ],
        },
      ],
    ).flat();

    function Harness() {
      const [draft, setDraft] = useState('');
      return (
        <>
          <textarea
            aria-label="Draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <MessageList messages={messages} isLoading={false} />
        </>
      );
    }

    mount(<Harness />);
    const textarea = container?.querySelector('textarea');
    expect(textarea).not.toBeNull();

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '你');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(renderCounts.user).toBe(100);
    expect(renderCounts.assistant.size).toBe(100);
    expect(
      [...renderCounts.assistant.values()].every((count) => count === 1),
    ).toBe(true);
  });

  it('rerenders only the assistant message whose segments changed', () => {
    const first = {
      id: 'assistant-1',
      role: 'assistant',
      segments: [{ kind: 'text', text: 'Stable' }],
    } satisfies ChatMessage;
    const second = {
      id: 'assistant-2',
      role: 'assistant',
      segments: [{ kind: 'text', text: 'Streaming' }],
    } satisfies ChatMessage;

    mount(<MessageList messages={[first, second]} isLoading />);
    act(() => {
      root?.render(
        <MessageList
          messages={[
            first,
            {
              ...second,
              segments: [{ kind: 'text', text: 'Streaming update' }],
            },
          ]}
          isLoading
        />,
      );
    });

    expect(renderCounts.assistant.get('assistant-1')).toBe(1);
    expect(renderCounts.assistant.get('assistant-2')).toBe(2);
  });
});

describe('MessageList opening position', () => {
  it('restores a saved position and offers new messages without auto-scrolling', () => {
    const viewKey = 'canvas-1:thread-1';
    rememberMessageListScrollPosition(viewKey, 240);
    const scrollHeight = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(1_000);
    const clientHeight = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockReturnValue(200);

    try {
      mount(
        <MessageList
          messages={[]}
          isLoading={false}
          viewKey={viewKey}
          openPosition="last-user"
          openPositionRequestNonce={1}
        />,
      );

      const messageContainer = container?.querySelector<HTMLElement>(
        '[data-chat-thread-root]',
      );
      expect(messageContainer?.scrollTop).toBe(240);
      expect(container?.textContent).toContain('New message');
    } finally {
      scrollHeight.mockRestore();
      clientHeight.mockRestore();
    }
  });

  it('restores the same visible message after a cold remount', () => {
    const viewKey = 'canvas-1:thread-semantic-anchor';
    const messages: ChatMessage[] = [
      { id: 'user-1', role: 'user', content: 'Question 1' },
      { id: 'user-2', role: 'user', content: 'Question 2' },
    ];
    let remounted = false;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        const messageId = this.dataset.chatMessageId;
        if (this.hasAttribute('data-chat-thread-root')) {
          return {
            x: 0,
            y: 0,
            width: 100,
            height: 200,
            top: 0,
            right: 100,
            bottom: 200,
            left: 0,
            toJSON: () => ({}),
          };
        }
        const top = messageId === 'user-2' ? (remounted ? 300 : 40) : -100;
        return {
          x: 0,
          y: top,
          width: 100,
          height: 20,
          top,
          right: 100,
          bottom: top + 20,
          left: 0,
          toJSON: () => ({}),
        };
      },
    );

    mount(
      <MessageList messages={messages} isLoading={false} viewKey={viewKey} />,
    );
    const firstContainer = container?.querySelector<HTMLElement>(
      '[data-chat-thread-root]',
    );
    if (firstContainer) {
      firstContainer.scrollTop = 200;
      act(() => firstContainer.dispatchEvent(new Event('scroll')));
    }
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;

    remounted = true;
    mount(
      <MessageList messages={messages} isLoading={false} viewKey={viewKey} />,
    );

    const remountedThreadRoot = document.querySelector<HTMLElement>(
      '[data-chat-thread-root]',
    );
    expect(remountedThreadRoot?.scrollTop).toBe(260);
    forgetMessageListScrollPosition(viewKey);
  });
});

describe('MessageList older history', () => {
  it('reveals cached turns and pages older history only during an explicit search jump', () => {
    const onLoadOlderHistory = vi.fn();
    const recent: ChatMessage[] = [
      { id: 'user-2', role: 'user', content: 'Recent needle' },
      { id: 'user-3', role: 'user', content: 'Newest needle' },
    ];
    const renderList = (messages: ChatMessage[], loading = false) => (
      <MessageList
        messages={messages}
        recentTurnCount={1}
        isLoading={false}
        hasOlderHistory
        isLoadingOlderHistory={loading}
        onLoadOlderHistory={onLoadOlderHistory}
      />
    );
    mount(renderList(recent));
    expect(
      container?.querySelector('[data-chat-message-id="user-2"]'),
    ).toBeNull();
    expect(onLoadOlderHistory).not.toHaveBeenCalled();
    const thread = container?.querySelector<HTMLElement>(
      '[data-chat-thread-root]',
    );
    act(() =>
      thread?.dispatchEvent(
        new Event('chat-reveal-search', { cancelable: true }),
      ),
    );
    expect(
      container?.querySelector('[data-chat-message-id="user-2"]'),
    ).not.toBeNull();
    expect(onLoadOlderHistory).toHaveBeenCalledTimes(1);
    act(() => root?.render(renderList(recent, true)));
    expect(onLoadOlderHistory).toHaveBeenCalledTimes(1);
    const older: ChatMessage[] = [
      { id: 'user-1', role: 'user', content: 'Older needle' },
      ...recent,
    ];
    act(() => root?.render(renderList(older)));
    expect(onLoadOlderHistory).toHaveBeenCalledTimes(2);
    act(() => root?.render(renderList(older)));
    expect(onLoadOlderHistory).toHaveBeenCalledTimes(2);
    act(() => thread?.dispatchEvent(new Event('chat-search-finished')));
    act(() =>
      root?.render(
        renderList([
          { id: 'user-0', role: 'user', content: 'Oldest needle' },
          ...older,
        ]),
      ),
    );
    expect(onLoadOlderHistory).toHaveBeenCalledTimes(2);
  });

  it('does not automatically retry a failed older-history page during search', () => {
    const onLoadOlderHistory = vi.fn();
    mount(
      <MessageList
        messages={[]}
        isLoading={false}
        hasOlderHistory
        olderHistoryError="History unavailable"
        onLoadOlderHistory={onLoadOlderHistory}
      />,
    );
    const thread = container?.querySelector<HTMLElement>(
      '[data-chat-thread-root]',
    );
    act(() =>
      thread?.dispatchEvent(
        new Event('chat-reveal-search', { cancelable: true }),
      ),
    );
    expect(onLoadOlderHistory).not.toHaveBeenCalled();
    expect(container?.querySelector('[role="alert"]')?.textContent).toBe(
      'History unavailable',
    );
  });

  it('exposes an accessible explicit expansion control', () => {
    const onLoadOlderHistory = vi.fn();
    mount(
      <MessageList
        messages={[]}
        isLoading={false}
        hasOlderHistory
        olderTurnBatchSize={3}
        onLoadOlderHistory={onLoadOlderHistory}
      />,
    );

    const button = Array.from(container?.querySelectorAll('button') ?? []).find(
      (candidate) => candidate.textContent === 'Show 3 earlier turns',
    );
    expect(button).not.toBeUndefined();

    act(() => button?.click());
    expect(onLoadOlderHistory).toHaveBeenCalledTimes(1);
  });

  it('preserves the first visible message while prepending older history', () => {
    const current: ChatMessage[] = [
      { id: 'user-2', role: 'user', content: 'Question 2' },
      {
        id: 'assistant-2',
        role: 'assistant',
        segments: [{ kind: 'text', text: 'Answer 2' }],
      },
    ];
    const prepended: ChatMessage[] = [
      { id: 'user-1', role: 'user', content: 'Question 1' },
      {
        id: 'assistant-1',
        role: 'assistant',
        segments: [{ kind: 'text', text: 'Answer 1' }],
      },
      ...current,
    ];
    let didPrepend = false;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        const messageId = this.dataset.chatMessageId;
        const top = messageId === 'user-2' ? (didPrepend ? 100 : 40) : -100;
        return {
          x: 0,
          y: top,
          width: 100,
          height: 20,
          top,
          right: 100,
          bottom: top + 20,
          left: 0,
          toJSON: () => ({}),
        };
      },
    );

    const renderList = (messages: ChatMessage[]) => (
      <MessageList
        messages={messages}
        isLoading={false}
        hasOlderHistory={!didPrepend}
        olderTurnBatchSize={1}
        onLoadOlderHistory={() => {
          didPrepend = true;
          root?.render(renderList(prepended));
        }}
      />
    );
    mount(renderList(current));
    const messageContainer = container?.querySelector<HTMLElement>(
      '[data-chat-thread-root]',
    );
    if (messageContainer) messageContainer.scrollTop = 200;
    const button = Array.from(container?.querySelectorAll('button') ?? []).find(
      (candidate) => candidate.textContent === 'Show 1 earlier turns',
    );

    act(() => button?.click());

    expect(messageContainer?.scrollTop).toBe(260);
  });
});
