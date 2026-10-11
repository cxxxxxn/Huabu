// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import { selectThreadDraft, useChatStore } from '@/store/chatStore';
import { usePanelStore } from '@/store/panelStore';

import { MilkdownMessageCard } from './MilkdownMessageCard';

import type { MilkdownPreviewSelection } from '@/components/Milkdown/MilkdownPreview';

const preview = vi.hoisted(() => ({
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
  default: (selector: (state: { canvasId: string | null }) => unknown) =>
    selector({ canvasId: null }),
}));

const selection: MilkdownPreviewSelection = {
  range: { from: 1, to: 8 },
  text: 'selected\n\npassage',
  contextBefore: 'Before ',
  contextAfter: ' after',
  position: { x: 20, y: 20 },
};
let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  await i18n.changeLanguage('en');
  useChatStore.setState({ threadsById: {} });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
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
    (item) => item.textContent?.trim() === name,
  );
  if (!found) throw new Error(`Missing button: ${name}`);
  return found;
}
function click(name: string) {
  act(() => button(name).click());
}
function input() {
  const element = document.querySelector<HTMLInputElement>(
    'input[aria-label="Comment"]',
  );
  if (!element) throw new Error('Missing comment editor');
  return element;
}
function type(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
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
  it('opens a snapshot editor, requires a comment and cancels without changing the draft', () => {
    render();
    select();
    expect(document.querySelector('blockquote')?.textContent).toBe(
      selection.text,
    );
    expect(button('Add to input').disabled).toBe(true);
    type('   ');
    expect(button('Add to input').disabled).toBe(true);
    type('Keep it.');
    click('Cancel');
    expect(selectThreadDraft(useChatStore.getState(), 'thread-a')).toBe('');
    expect(document.querySelector('blockquote')).toBeNull();
  });

  it('appends to the latest owning-thread draft and supports multiple comments without sending', () => {
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
      'Edited while commenting\n\nQuote from an earlier reply:\n> selected\n> \n> passage\n\nNearby context ([…] marks the quoted passage):\nBefore […] after\n\nComment:\nKeep it.',
    );
    expect(usePanelStore.getState().focusChatInputRequest?.threadId).toBe(
      'thread-a',
    );
    select();
    type('请展开');
    click('Add to input');
    expect(selectThreadDraft(useChatStore.getState(), 'thread-a')).toContain(
      '评论：\n请展开',
    );
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
    expect(selectThreadDraft(useChatStore.getState(), 'thread-a')).toContain(
      '> selected',
    );
    act(() =>
      useChatStore
        .getState()
        .setDraft('thread-a', 'Manually edited comment\nFinal instruction'),
    );
    render(true, 'Changed again');
    expect(selectThreadDraft(useChatStore.getState(), 'thread-a')).toBe(
      'Manually edited comment\nFinal instruction',
    );
  });

  it('does not emit during Chinese IME composition', () => {
    render();
    select();
    type('你好');
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'isComposing', { value: true });
    act(() => input().dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(selectThreadDraft(useChatStore.getState(), 'thread-a')).toBe('');
  });

  it('disables selection feedback on inactive or streaming surfaces and resets the editor', () => {
    render();
    select();
    render(false);
    expect(preview.onTextSelection).toBeUndefined();
    expect(document.querySelector('blockquote')).toBeNull();
    render();
    expect(document.querySelector('blockquote')).toBeNull();
  });
});
