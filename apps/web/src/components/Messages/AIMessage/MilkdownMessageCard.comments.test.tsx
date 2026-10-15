// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import {
  selectThreadDraft,
  selectThreadQuotedComments,
  useChatStore,
} from '@/store/chatStore';
import { usePanelStore } from '@/store/panelStore';
import { copyToClipboard } from '@/utils/io/clipboard';

import { MilkdownMessageCard } from './MilkdownMessageCard';

import type { MilkdownPreviewSelection } from '@/components/Milkdown/MilkdownPreview';

const preview = vi.hoisted(() => ({
  addNode: vi.fn(),
  onTextSelection: undefined as
    | ((selection: MilkdownPreviewSelection | null) => void)
    | undefined,
}));
vi.mock('@/components/Milkdown', () => ({
  MilkdownPreview: ({
    onTextSelection,
  }: {
    onTextSelection?: typeof preview.onTextSelection;
  }) => {
    preview.onTextSelection = onTextSelection;
    return <div>Answer</div>;
  },
}));
vi.mock('@/store/canvasStore', () => ({
  default: Object.assign(
    (selector: (state: { canvasId: string | null }) => unknown) =>
      selector({ canvasId: null }),
    { getState: () => ({ addNode: preview.addNode }) },
  ),
}));
vi.mock('@/utils/io/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));

const selection: MilkdownPreviewSelection = {
  range: { from: 1, to: 8 },
  text: 'selected\n\npassage',
  markdown: '**selected**\n\npassage',
  contextBefore: 'Before ',
  contextAfter: ' after',
  position: { x: 20, y: 20 },
};
let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  await i18n.changeLanguage('en');
  preview.addNode.mockClear();
  vi.mocked(copyToClipboard).mockReset().mockResolvedValue(undefined);
  useChatStore.setState({ threadsById: {} });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(enabled = true, content = 'Original answer') {
  act(() =>
    root.render(
      <MilkdownMessageCard
        content={content}
        threadId="thread-a"
        messageId="answer-1"
        enableComments={enabled}
      />,
    ),
  );
}
function button(name: string) {
  const found = [...document.querySelectorAll('button')].find(
    (item) =>
      item.textContent?.trim() === name ||
      item.getAttribute('aria-label') === name,
  );
  if (!found) throw new Error(`Missing button: ${name}`);
  return found;
}
function click(name: string) {
  act(() => button(name).click());
}
function input() {
  const element = document.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Comment"]',
  );
  if (!element) throw new Error('Missing comment editor');
  return element;
}
function type(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )?.set?.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function select() {
  act(() => preview.onTextSelection?.(selection));
  click('Comment');
}

describe('AI response comments', () => {
  it('copies only the selected plain text without writing a note or changing the draft', async () => {
    useChatStore.getState().setDraft('thread-a', 'Keep my draft.');
    render();
    act(() => preview.onTextSelection?.(selection));
    await act(async () => button('Copy').click());
    expect(copyToClipboard).toHaveBeenCalledExactlyOnceWith(selection.text);
    expect(preview.addNode).not.toHaveBeenCalled();
    expect(selectThreadDraft(useChatStore.getState(), 'thread-a')).toBe(
      'Keep my draft.',
    );
    expect(document.querySelector('button[aria-label="Comment"]')).toBeNull();
  });

  it('surfaces clipboard failures and allows retrying the same snapshot', async () => {
    vi.mocked(copyToClipboard).mockRejectedValueOnce(
      new Error('Clipboard unavailable'),
    );
    render();
    act(() => preview.onTextSelection?.(selection));
    await act(async () => button('Copy').click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not copy',
    );
    expect(button('Copy').disabled).toBe(false);
    await act(async () => button('Copy').click());
    expect(copyToClipboard).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('saves the selected Markdown with the same note origin as the whole-response action', () => {
    render();
    act(() => preview.onTextSelection?.(selection));
    click('Add as note');
    expect(preview.addNode).toHaveBeenCalledExactlyOnceWith({
      nodeType: 'note',
      data: {
        content: selection.markdown,
        origin: { type: 'user-from-chat', threadId: 'thread-a' },
      },
    });
    expect(copyToClipboard).not.toHaveBeenCalled();
    expect(selectThreadDraft(useChatStore.getState(), 'thread-a')).toBe('');
    expect(document.querySelector('button[aria-label="Comment"]')).toBeNull();
  });

  it('places a compact, labeled add icon inside the input without a cancel button', () => {
    render();
    select();
    const add = button('Add to input');
    expect(add.type).toBe('submit');
    expect(add.textContent).toBe('');
    expect(add.classList.contains('min-h-6')).toBe(true);
    expect(add.classList.contains('min-w-6')).toBe(true);
    expect(add.classList.contains('bg-transparent')).toBe(true);
    expect(add.classList.contains('text-fg-muted')).toBe(true);
    expect(add.classList.contains('enabled:hover:bg-hover')).toBe(true);
    expect(add.classList.contains('rounded-full')).toBe(true);
    expect(add.querySelector('svg.lucide-arrow-up')).not.toBeNull();
    expect(add.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(input().parentElement?.contains(add)).toBe(true);
    expect(input().classList.contains('pr-9')).toBe(true);
    expect(add.parentElement?.classList.contains('right-1')).toBe(true);
    expect(add.parentElement?.classList.contains('bottom-1')).toBe(true);
    expect(
      document.querySelector('form')?.querySelectorAll('button'),
    ).toHaveLength(1);
  });

  it('keeps the quotation subdued and the editor compact with a single focus border', () => {
    render();
    select();
    expect(document.querySelector('form')?.classList.contains('gap-2')).toBe(
      true,
    );
    const figure = document.querySelector('figure');
    expect(figure?.classList.contains('bg-hover/60')).toBe(true);
    expect(figure?.classList.contains('py-1.5')).toBe(true);
    expect(figure?.classList.contains('rounded-md')).toBe(true);
    expect(
      figure?.querySelector('figcaption svg')?.classList.contains('opacity-60'),
    ).toBe(true);
    expect(
      figure?.querySelector('blockquote')?.classList.contains('text-fg-muted'),
    ).toBe(true);
    expect(input().classList.contains('rounded-md')).toBe(true);
    expect(input().classList.contains('focus:border-info')).toBe(true);
    expect(input().classList.contains('focus:ring-0')).toBe(true);
    expect(input().classList.contains('focus:ring-1')).toBe(false);
  });

  it('uses a multiline editor that grows and shrinks with content', () => {
    render();
    select();
    const textarea = input();
    expect(textarea.getAttribute('rows')).toBe('2');
    expect(textarea.classList.contains('max-h-[calc(6lh+0.875rem)]')).toBe(
      true,
    );
    expect(textarea.classList.contains('overscroll-contain')).toBe(true);
    expect(textarea.classList.contains('resize-none')).toBe(true);
    let contentHeight = 60;
    Object.defineProperties(textarea, {
      scrollHeight: { configurable: true, get: () => contentHeight },
      offsetHeight: { configurable: true, get: () => 48 },
      clientHeight: { configurable: true, get: () => 46 },
    });
    type('First line\nSecond line');
    expect(textarea.style.height).toBe('62px');
    contentHeight = 120;
    type('A longer passage that wraps onto additional lines.');
    expect(textarea.style.height).toBe('122px');
    contentHeight = 32;
    type('Short');
    expect(textarea.style.height).toBe('34px');
    type('');
    expect(textarea.style.height).toBe('');
    expect(textarea.style.overflowY).toBe('');
  });

  it('remeasures wrapped text on width changes and disconnects when closed', () => {
    let notifyResize: (() => void) | undefined;
    let disconnectInput: ReturnType<typeof vi.fn> | undefined;
    let width = 200;
    vi.stubGlobal(
      'ResizeObserver',
      class implements ResizeObserver {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe(target: Element) {
          if (target.firstElementChild?.tagName !== 'TEXTAREA') return;
          disconnectInput = this.disconnect;
          notifyResize = () =>
            this.callback(
              [
                {
                  target,
                  contentRect: new DOMRect(0, 0, width, 100),
                  borderBoxSize: [],
                  contentBoxSize: [],
                  devicePixelContentBoxSize: [],
                },
              ],
              this,
            );
        }
        unobserve() {}
        disconnect = vi.fn();
      },
    );
    render();
    select();
    let contentHeight = 60;
    Object.defineProperty(input(), 'scrollHeight', {
      configurable: true,
      get: () => contentHeight,
    });
    type('A passage that wraps as the popover becomes narrower.');
    expect(input().style.height).toBe('60px');
    contentHeight = 90;
    act(() => notifyResize?.());
    expect(input().style.height).toBe('90px');
    contentHeight = 120;
    act(() => notifyResize?.());
    expect(input().style.height).toBe('90px');
    width = 100;
    act(() => notifyResize?.());
    expect(input().style.height).toBe('120px');
    render(false);
    expect(disconnectInput).toHaveBeenCalledOnce();
  });

  it('keeps Shift+Enter for newlines and adds multiline comments on Enter without sending', () => {
    const addMessage = vi.spyOn(useChatStore.getState(), 'addMessage');
    render();
    select();
    type('First line');
    const newline = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => input().dispatchEvent(newline));
    expect(newline.defaultPrevented).toBe(false);
    expect(
      selectThreadQuotedComments(useChatStore.getState(), 'thread-a'),
    ).toEqual([]);
    type('First line\nSecond line');
    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    act(() => input().dispatchEvent(enter));
    expect(enter.defaultPrevented).toBe(true);
    expect(
      selectThreadQuotedComments(useChatStore.getState(), 'thread-a')[0]
        ?.comment,
    ).toBe('First line\nSecond line');
    expect(document.querySelector('blockquote')).toBeNull();
    expect(addMessage).not.toHaveBeenCalled();
  });

  it('does not add an empty comment on Enter', () => {
    render();
    select();
    type(' \n ');
    act(() =>
      input().dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(
      selectThreadQuotedComments(useChatStore.getState(), 'thread-a'),
    ).toEqual([]);
    expect(document.querySelector('blockquote')).not.toBeNull();
  });

  it('trims quote boundaries in the editor and draft without changing copied text', async () => {
    const text = ' \t\nselected  text\n\n    indented\npassage\n ';
    render();
    act(() => preview.onTextSelection?.({ ...selection, text }));
    await act(async () => button('Copy').click());
    expect(copyToClipboard).toHaveBeenCalledExactlyOnceWith(text);
    act(() => preview.onTextSelection?.({ ...selection, text }));
    click('Comment');
    expect(document.querySelector('blockquote')?.textContent).toBe(text.trim());
    type('Keep it.');
    click('Add to input');
    expect(
      selectThreadQuotedComments(useChatStore.getState(), 'thread-a'),
    ).toEqual([
      {
        quote: text.trim(),
        draftId: expect.any(String),
        contextBefore: selection.contextBefore,
        contextAfter: selection.contextAfter,
        comment: 'Keep it.',
      },
    ]);
    expect(selectThreadDraft(useChatStore.getState(), 'thread-a')).toBe('');
  });

  it.each([
    ['en', 'Quoted passage', 'Add a comment…'],
    ['zh-CN', '引用内容', '添加评论…'],
  ])(
    'labels the quoted passage and uses a concise placeholder in %s',
    async (language, label, placeholder) => {
      await i18n.changeLanguage(language);
      render();
      act(() => preview.onTextSelection?.(selection));
      click(i18n.t('messages.fragmentComment'));
      expect(
        document.querySelector('figcaption svg.lucide-quote'),
      ).not.toBeNull();
      expect(
        document.querySelector('figcaption svg')?.getAttribute('aria-hidden'),
      ).toBe('true');
      expect(document.querySelector('figcaption .sr-only')?.textContent).toBe(
        label,
      );
      const quote = document.querySelector('figure blockquote');
      expect(quote?.textContent).toBe(selection.text);
      expect(quote?.classList.contains('text-xs')).toBe(true);
      expect(quote?.classList.contains('wrap-anywhere')).toBe(true);
      expect(quote?.classList.contains('border-l-2')).toBe(false);
      expect(document.querySelector('figure')?.classList.contains('flex')).toBe(
        true,
      );
      expect(document.querySelector('textarea')?.placeholder).toBe(placeholder);
    },
  );

  it.each(['escape', 'outside-press'])(
    'requires a comment and dismisses via %s without changing the draft',
    async (reason) => {
      useChatStore.getState().setDraft('thread-a', 'Keep my draft.');
      render();
      select();
      expect(document.querySelector('blockquote')?.textContent).toBe(
        selection.text,
      );
      expect(button('Add to input').disabled).toBe(true);
      type('   ');
      expect(button('Add to input').disabled).toBe(true);
      type('Keep it.');
      expect(button('Add to input').disabled).toBe(false);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (reason === 'escape') {
          input().dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
          );
        } else {
          document.body.dispatchEvent(
            new PointerEvent('pointerdown', { bubbles: true }),
          );
        }
      });
      expect(selectThreadDraft(useChatStore.getState(), 'thread-a')).toBe(
        'Keep my draft.',
      );
      expect(
        selectThreadQuotedComments(useChatStore.getState(), 'thread-a'),
      ).toEqual([]);
      expect(document.querySelector('blockquote')).toBeNull();
    },
  );

  it('adds a quoted comment through the input form without sending', () => {
    const addMessage = vi.spyOn(useChatStore.getState(), 'addMessage');
    render();
    select();
    type('Keep it.');
    act(() => input().form?.requestSubmit());
    expect(
      selectThreadQuotedComments(useChatStore.getState(), 'thread-a'),
    ).toEqual([
      {
        draftId: expect.any(String),
        quote: selection.text,
        contextBefore: selection.contextBefore,
        contextAfter: selection.contextAfter,
        comment: 'Keep it.',
      },
    ]);
    expect(selectThreadDraft(useChatStore.getState(), 'thread-a')).toBe('');
    expect(document.querySelector('blockquote')).toBeNull();
    expect(addMessage).not.toHaveBeenCalled();
  });

  it('stages multiple quoted comments in the owning thread without rewriting text or sending', () => {
    const addMessage = vi.spyOn(useChatStore.getState(), 'addMessage');
    useChatStore.getState().setDraft('thread-a', 'Before opening');
    useChatStore.getState().setDraft('thread-b', 'Other thread');
    render();
    select();
    type('Keep it.');
    act(() =>
      useChatStore.getState().setDraft('thread-a', 'Edited while commenting'),
    );
    click('Add to input');
    expect(selectThreadDraft(useChatStore.getState(), 'thread-a')).toBe(
      'Edited while commenting',
    );
    expect(usePanelStore.getState().focusChatInputRequest?.threadId).toBe(
      'thread-a',
    );
    select();
    type('请展开');
    click('Add to input');
    expect(
      selectThreadQuotedComments(useChatStore.getState(), 'thread-a').map(
        (item) => item.comment,
      ),
    ).toEqual(['Keep it.', '请展开']);
    expect(
      selectThreadQuotedComments(useChatStore.getState(), 'thread-b'),
    ).toEqual([]);
    expect(selectThreadDraft(useChatStore.getState(), 'thread-b')).toBe(
      'Other thread',
    );
    expect(addMessage).not.toHaveBeenCalled();
  });

  it('keeps capture-time text after focus and source changes and never rewrites emitted input', () => {
    render();
    select();
    act(() => preview.onTextSelection?.(null));
    render(true, 'Replaced answer');
    type('Explore this.');
    click('Add to input');
    expect(
      selectThreadQuotedComments(useChatStore.getState(), 'thread-a')[0]?.quote,
    ).toBe(selection.text);
    act(() =>
      useChatStore
        .getState()
        .setDraft('thread-a', 'Manually edited comment\nFinal instruction'),
    );
    render(true, 'Changed again');
    expect(selectThreadDraft(useChatStore.getState(), 'thread-a')).toBe(
      'Manually edited comment\nFinal instruction',
    );
    expect(
      selectThreadQuotedComments(useChatStore.getState(), 'thread-a')[0]?.quote,
    ).toBe(selection.text);
  });

  it.each(['isComposing', 'keyCode'])(
    'does not emit during Chinese IME composition (%s)',
    (signal) => {
      render();
      select();
      type('你好');
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, signal, {
        value: signal === 'isComposing' ? true : 229,
      });
      act(() => input().dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
      expect(selectThreadDraft(useChatStore.getState(), 'thread-a')).toBe('');
      expect(
        selectThreadQuotedComments(useChatStore.getState(), 'thread-a'),
      ).toEqual([]);
    },
  );

  it('disables selection feedback on inactive surfaces and resets the editor', () => {
    render();
    select();
    render(false);
    expect(preview.onTextSelection).toBeUndefined();
    expect(document.querySelector('blockquote')).toBeNull();
    render();
    expect(document.querySelector('blockquote')).toBeNull();
  });
});
