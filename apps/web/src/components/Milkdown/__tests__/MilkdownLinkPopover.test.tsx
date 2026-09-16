// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { copyToClipboard } from '@/utils/io/clipboard';

import {
  createMilkdown,
  type MilkdownInstance,
  type MilkdownLinkSnapshot,
} from '../createMilkdown';
import { MilkdownEditor } from '../MilkdownEditor';
import { MilkdownLinkPopover } from '../MilkdownLinkPopover';

import type * as ClipboardModule from '@/utils/io/clipboard';

vi.mock('@/utils/io/clipboard', async (importOriginal) => ({
  ...(await importOriginal<typeof ClipboardModule>()),
  copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let instance: MilkdownInstance;
let editorRoot: HTMLDivElement;
let reactRoot: Root | null;
let chromeRoot: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(async () => {
  act(() => reactRoot?.unmount());
  reactRoot = null;
  await instance?.destroy();
  editorRoot?.remove();
  chromeRoot?.remove();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(
  markdown = '[hello **bold** tail](https://example.com "Title") and [same](https://other.example)',
  chrome = false,
) {
  editorRoot = document.createElement('div');
  document.body.append(editorRoot);
  instance = await createMilkdown({
    root: editorRoot,
    initialMarkdown: markdown,
    toolbarMode: 'none',
    linkActivation: 'plain',
    onLinkClick: vi.fn(),
  });
  if (chrome) {
    chromeRoot = document.createElement('div');
    document.body.append(chromeRoot);
    reactRoot = createRoot(chromeRoot);
    act(() =>
      reactRoot?.render(
        <MilkdownLinkPopover
          instance={instance}
          rootRef={{ current: editorRoot }}
        />,
      ),
    );
  }
}

function anchor(index = 0): HTMLAnchorElement {
  const el =
    editorRoot.querySelectorAll<HTMLAnchorElement>('.ProseMirror a')[index];
  if (!el) throw new Error('Missing anchor');
  return el;
}
function snapshot(index = 0): MilkdownLinkSnapshot {
  const value = instance.getLinkSnapshot(anchor(index));
  if (!value) throw new Error('Missing snapshot');
  return value;
}
function hover() {
  act(() =>
    anchor().dispatchEvent(
      new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }),
    ),
  );
}
function dialog() {
  return document.querySelector('[role="dialog"]');
}
function button(label: string): HTMLButtonElement {
  const el = Array.from(document.querySelectorAll('button')).find(
    (el) => el.textContent === `editor.${label}`,
  );
  if (!el) throw new Error(`Missing button ${label}`);
  return el;
}
function shortcut(
  target: Element,
  modifier: 'metaKey' | 'ctrlKey' = 'metaKey',
) {
  const event = new KeyboardEvent('keydown', {
    key: 'k',
    [modifier]: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => target.dispatchEvent(event));
  return event;
}
function input(index: number, value: string) {
  const el = dialog()?.querySelectorAll('input')[index];
  if (!el) throw new Error('Missing dialog input');
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Milkdown link edit snapshots (real editor)', () => {
  it('retains formatting when replacing an entirely bold link label', async () => {
    await mount('**[old](https://example.com "Title")**');
    expect(instance.editLink(snapshot(), 'https://new.example', 'new')).toBe(
      true,
    );
    expect(editorRoot.querySelector('strong')?.textContent).toBe('new');
    expect(instance.getMarkdown()).toContain('"Title"');
  });
  it('captures the full mark across bold runs without moving selection', async () => {
    await mount();
    instance.__setCursorAfterTextForTest?.('same');
    const selection = instance.getSelectionRange(true);
    expect(snapshot()).toMatchObject({
      text: 'hello bold tail',
      href: 'https://example.com',
    });
    expect(instance.getSelectionRange(true)).toEqual(selection);
    expect(
      snapshot(editorRoot.querySelectorAll('.ProseMirror a').length - 1).text,
    ).toBe('same');
  });

  it('edits text and URL atomically while retaining title and unchanged bold runs', async () => {
    await mount();
    const updates = vi.fn();
    instance.onMarkdownUpdated(updates);
    expect(
      instance.editLink(snapshot(), 'https://new.example', 'hello bold ending'),
    ).toBe(true);
    expect(updates).toHaveBeenCalledTimes(1);
    expect(snapshot()).toMatchObject({
      text: 'hello bold ending',
      href: 'https://new.example',
    });
    expect(editorRoot.querySelector('strong')?.textContent).toBe('bold');
    expect(instance.getMarkdown()).toContain('"Title"');
    expect(instance.getMarkdown()).toContain('[same](https://other.example)');
  });

  it('preserves all other marks when only changing URL or removing a link', async () => {
    await mount();
    expect(instance.editLink(snapshot(), 'https://new.example')).toBe(true);
    expect(editorRoot.querySelector('strong')?.textContent).toBe('bold');
    expect(instance.getMarkdown()).toContain('"Title"');
    expect(instance.editLink(snapshot(), null)).toBe(true);
    expect(instance.getMarkdown()).toContain('hello **bold** tail');
    expect(editorRoot.querySelectorAll('.ProseMirror a')).toHaveLength(1);
  });

  it('retains a snapshot across selection-only transactions', async () => {
    await mount();
    const captured = snapshot();
    const updates = vi.fn();
    instance.onMarkdownUpdated(updates);
    instance.__setCursorAfterTextForTest?.('same');
    expect(updates).not.toHaveBeenCalled();
    expect(instance.isLinkSnapshotCurrent(captured)).toBe(true);
    expect(instance.editLink(captured, 'https://new.example')).toBe(true);
  });

  it('rejects stale equal text at the same positions and elsewhere, and forged snapshots', async () => {
    await mount('[same](https://example.com) after');
    const captured = snapshot();
    instance.setMarkdown(
      '[same](https://example.com) elsewhere [same](https://example.com)',
    );
    const markdown = instance.getMarkdown();
    expect(instance.isLinkSnapshotCurrent(captured)).toBe(false);
    expect(instance.editLink(captured, null)).toBe(false);
    expect(instance.editLink({ ...snapshot() }, null)).toBe(false);
    expect(instance.getMarkdown()).toBe(markdown);
  });

  it('rejects unsafe addresses, empty labels and read-only writes', async () => {
    await mount();
    const captured = snapshot();
    expect(instance.editLink(captured, 'javascript:alert(1)')).toBe(false);
    expect(instance.editLink(captured, 'https://new.example', '')).toBe(false);
    instance.setReadonly(true);
    expect(instance.editLink(captured, null)).toBe(false);
    expect(instance.isLinkSnapshotCurrent(captured)).toBe(true);
  });

  it('does not merge adjacent links with different titles or addresses', async () => {
    await mount(
      '[one](https://example.com "first")[two](https://example.com "second")[three](https://other.example)',
    );
    expect(snapshot(0).text).toBe('one');
    expect(snapshot(1).text).toBe('two');
    expect(snapshot(2).text).toBe('three');
  });
});

describe('MilkdownLinkPopover (real editor and Common controls)', () => {
  it.each([
    {
      editable: true,
      callback: true,
      activation: 'plain' as const,
      visible: true,
    },
    {
      editable: true,
      callback: false,
      activation: 'plain' as const,
      visible: false,
    },
    {
      editable: true,
      callback: true,
      activation: 'modifier' as const,
      visible: false,
    },
    {
      editable: false,
      callback: true,
      activation: 'plain' as const,
      visible: false,
    },
  ])(
    'mounts controls only for the opted-in editable Note: %j',
    async ({ editable, callback, activation, visible }) => {
      chromeRoot = document.createElement('div');
      document.body.append(chromeRoot);
      reactRoot = createRoot(chromeRoot);
      let ready: (() => void) | undefined;
      const mounted = new Promise<void>((resolve) => {
        ready = resolve;
      });
      await act(async () => {
        reactRoot?.render(
          <MilkdownEditor
            markdown="[hello](https://example.com)"
            editable={editable}
            onLinkClick={callback ? vi.fn() : undefined}
            linkActivation={activation}
            onReady={(value) => {
              if (value) {
                instance = value;
                ready?.();
              }
            }}
          />,
        );
      });
      await act(async () => {
        await mounted;
      });
      const link = chromeRoot.querySelector('a');
      if (!link) throw new Error('Missing mounted link');
      act(() =>
        link.dispatchEvent(
          new PointerEvent('pointerover', {
            bubbles: true,
            pointerType: 'mouse',
          }),
        ),
      );
      expect(Boolean(dialog())).toBe(visible);
    },
  );
  it('opens on hover without focus or selection theft and dismisses on Escape', async () => {
    await mount(undefined, true);
    instance.focus();
    const focused = document.activeElement;
    const selection = instance.getSelectionRange(true);
    hover();
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(focused);
    expect(instance.getSelectionRange(true)).toEqual(selection);
    act(() =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
    );
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(focused);
  });

  it.each(['metaKey', 'ctrlKey'] as const)(
    'enters from the caret with %s+K and restores editor focus',
    async (modifier) => {
      await mount(undefined, true);
      instance.__setCursorAfterTextForTest?.('hello');
      instance.focus();
      const focused = document.activeElement;
      if (!focused) throw new Error('Missing editor focus');
      expect(shortcut(focused, modifier).defaultPrevented).toBe(true);
      act(() => vi.advanceTimersToNextFrame());
      expect(document.activeElement).toBe(dialog()?.querySelector('input'));
      act(() =>
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
      );
      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(focused);
    },
  );

  it('enters from a focused anchor without moving editor selection', async () => {
    await mount(undefined, true);
    instance.__setCursorAfterTextForTest?.('same');
    const selection = instance.getSelectionRange(true);
    anchor().focus();
    shortcut(anchor());
    expect(dialog()?.querySelector('input')?.value).toBe('hello bold tail');
    expect(instance.getSelectionRange(true)).toEqual(selection);
    act(() =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
    );
    expect(document.activeElement).toBe(anchor());
  });

  it('keeps controls traversable across the hover gap and inside the form', async () => {
    await mount(undefined, true);
    hover();
    act(() =>
      anchor().dispatchEvent(new PointerEvent('pointerout', { bubbles: true })),
    );
    act(() => dialog()?.querySelector('input')?.focus());
    act(() => vi.advanceTimersByTime(250));
    expect(dialog()).not.toBeNull();
    act(() => button('saveLink').focus());
    expect(dialog()).not.toBeNull();
  });

  it('shows a URL validation error without changing content, then saves both fields', async () => {
    await mount(undefined, true);
    hover();
    const markdown = instance.getMarkdown();
    input(1, 'javascript:alert(1)');
    act(() => button('saveLink').click());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      'editor.linkInvalidUrl',
    );
    expect(instance.getMarkdown()).toBe(markdown);
    input(0, 'hello bold edited');
    input(1, 'https://new.example');
    act(() => button('saveLink').click());
    expect(snapshot()).toMatchObject({
      text: 'hello bold edited',
      href: 'https://new.example',
    });
    expect(editorRoot.querySelector('strong')?.textContent).toBe('bold');
    expect(instance.getMarkdown()).toContain('"Title"');
    expect(dialog()).toBeNull();
  });

  it('copies the captured address and removes only the link', async () => {
    await mount(undefined, true);
    hover();
    await act(async () => button('copyLinkAddress').click());
    expect(copyToClipboard).toHaveBeenCalledWith('https://example.com');
    expect(button('linkCopied')).toBeTruthy();
    act(() => button('removeLink').click());
    expect(instance.getMarkdown()).toContain('hello **bold** tail');
    expect(dialog()).toBeNull();
  });

  it('closes for content changes but not selection-only updates', async () => {
    await mount(undefined, true);
    hover();
    act(() => instance.__setCursorAfterTextForTest?.('same'));
    expect(dialog()).not.toBeNull();
    act(() =>
      instance.setMarkdown('[hello bold tail](https://example.com) changed'),
    );
    expect(dialog()).toBeNull();
  });
});
