// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveAccent } from '@huabu/shared';

import { nodeMetricsForSize } from '@/components/Nodes/design/nodeDesign';
import {
  NOTE_CONTENT_HOST_CLASS,
  NOTE_CONTENT_HOST_STYLE,
  readNoteIntrinsicHeight,
} from '@/components/Nodes/note/noteContentHost';
import { NoteContentViewport } from '@/components/Nodes/note/NoteContentViewport';
import {
  NOTE_SURFACE_BACKGROUND,
  NOTE_SURFACE_DESIGN_CONFIG,
  noteBoundaryForAccent,
} from '@/components/Nodes/note/noteDesign';
import { canScrollNote } from '@/components/Nodes/note/noteScroll';

import { NoteDesignDraft } from './NoteDesignDraft';

vi.mock('@/components/Milkdown/MilkdownPreview', () => ({
  MilkdownPreview: ({
    markdown,
    className,
    ariaLabel,
  }: {
    markdown: string;
    className: string;
    ariaLabel: string;
  }) => (
    <div className={className} aria-label={ariaLabel}>
      <div className="ProseMirror" contentEditable={false}>
        {markdown}
      </div>
    </div>
  ),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('Expected specimen element');
  }
  return value;
}

describe('NoteDesignDraft', () => {
  let container: HTMLDivElement;
  let root: Root;
  let resizeCallbacks: Array<() => void>;
  let mutationCallbacks: Array<() => void>;
  let disconnect: ReturnType<typeof vi.fn>;
  let observe: ReturnType<typeof vi.fn>;
  let unobserve: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    resizeCallbacks = [];
    mutationCallbacks = [];
    disconnect = vi.fn();
    observe = vi.fn();
    unobserve = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resizeCallbacks.push(callback);
        }
        observe = observe;
        unobserve = unobserve;
        disconnect = disconnect;
      },
    );
    vi.stubGlobal(
      'MutationObserver',
      class {
        constructor(callback: () => void) {
          mutationCallbacks.push(callback);
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows three fixed S/M/L specimens with production shell and viewport geometry', () => {
    act(() => root.render(<NoteDesignDraft />));
    const notes = container.querySelectorAll<HTMLElement>(
      '[data-note-specimen]',
    );
    expect(notes).toHaveLength(3);
    const fixtures = [
      { label: 'Compact', width: 352, height: 280, tier: 'S' },
      { label: 'Regular', width: 640, height: 480, tier: 'M' },
      { label: 'Large', width: 960, height: 800, tier: 'L' },
    ];
    fixtures.forEach(({ label, width, height, tier }, index) => {
      const note = required(notes[index]);
      expect(note.dataset.noteSpecimen).toBe(label);
      expect(note.dataset.noteSize).toBe(tier);
      expect(note.style.width).toBe(`${width}px`);
      expect(note.style.height).toBe(`${height}px`);
      expect(note.classList.contains('box-border')).toBe(true);
      expect(note.style.borderWidth).toBe(
        `${NOTE_SURFACE_DESIGN_CONFIG.borderWidth}px`,
      );
      expect(note.style.borderRadius).toBe(
        `${nodeMetricsForSize(width, height).radius}px`,
      );
      const presentation = required(note.parentElement);
      expect(parseFloat(presentation.style.width)).toBeLessThanOrEqual(300);
      expect(parseFloat(presentation.style.height)).toBeLessThanOrEqual(260);
      const frame = required(
        note.querySelector<HTMLElement>('.huabu-note-scroll-frame'),
      );
      expect(frame.style.transform).toBe('');
      expect(frame.classList.contains('w-full')).toBe(true);
      expect(frame.classList.contains('h-full')).toBe(true);
      expect(frame.parentElement?.className).toBe(
        'h-full w-full overflow-hidden',
      );
      const viewport = frame.firstElementChild as HTMLElement;
      expect(viewport.hasAttribute('data-note-content-viewport')).toBe(true);
      expect(viewport.dataset.noteScrollEnabled).toBe('true');
      expect(viewport.className).toBe('huabu-note-scroll-viewport h-full');
      expect(viewport.style.overflowY).toBe('auto');
      expect(viewport.style.overflowX).toBe('hidden');
      expect(viewport.style.overscrollBehavior).toBe('contain');
      const host = viewport.firstElementChild as HTMLElement;
      expect(host.hasAttribute('data-note-content-host')).toBe(true);
      expect(host.className).toBe(`${NOTE_CONTENT_HOST_CLASS} min-h-full`);
      expect(host.style.paddingBlock).toBe(
        NOTE_CONTENT_HOST_STYLE.paddingBlock,
      );
      expect(host.style.paddingInline).toBe(
        NOTE_CONTENT_HOST_STYLE.paddingInline,
      );
      expect(
        host.querySelector('.ProseMirror')?.getAttribute('contenteditable'),
      ).toBe('false');
      expect(host.firstElementChild?.className).toBe(
        'pointer-events-none w-full select-none',
      );
    });
    expect(container.textContent?.match(/Scroll enabled/g)).toHaveLength(3);
    expect(container.textContent).toContain('These are not canvas selections.');
    expect(
      container.querySelector('input[type="range"], [role="slider"]'),
    ).toBeNull();
    expect(container.textContent).not.toMatch(
      /Show more|Minimal|Full title|Note width|Note height/,
    );
    expect(container.querySelectorAll('button').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('article button')).toHaveLength(0);
  });

  it('keeps scroll eligibility canonical and makes geometry reflect the supplied eligibility', () => {
    const active = {
      selected: true,
      selectedCount: 1,
      fixed: true,
      bodyVisible: true,
      missing: false,
    };
    const viewportRef = createRef<HTMLDivElement>();
    const contentHostRef = createRef<HTMLDivElement>();
    const onScroll = vi.fn();
    for (const change of [
      {},
      { selected: false },
      { selectedCount: 0 },
      { selectedCount: 2 },
      { fixed: false },
      { bodyVisible: false },
      { missing: true },
    ]) {
      const eligible = canScrollNote({ ...active, ...change });
      expect(eligible).toBe(Object.keys(change).length === 0);
      act(() =>
        root.render(
          <NoteContentViewport
            scrollingEnabled={eligible}
            viewportRef={viewportRef}
            contentHostRef={contentHostRef}
            onScroll={onScroll}
          >
            <p>Read-only content</p>
          </NoteContentViewport>,
        ),
      );
      expect(viewportRef.current?.dataset.noteScrollEnabled).toBe(
        String(eligible),
      );
      expect(viewportRef.current?.style.overflowY).toBe(
        eligible ? 'auto' : 'hidden',
      );
      expect(contentHostRef.current?.classList.contains('bg-surface')).toBe(
        false,
      );
      expect(contentHostRef.current?.parentElement).toBe(viewportRef.current);
    }
    act(() => viewportRef.current?.dispatchEvent(new Event('scroll')));
    expect(onScroll).toHaveBeenCalledOnce();
  });

  it('contains plain native wheel only for overflowing specimens, including their edges', () => {
    act(() => root.render(<NoteDesignDraft />));
    const viewport = required(
      container.querySelector<HTMLElement>('[data-note-content-viewport]'),
    );
    Object.defineProperties(viewport, {
      scrollHeight: { value: 300, configurable: true },
      clientHeight: { value: 100 },
    });
    const bubbled = vi.fn();
    container.addEventListener('wheel', bubbled);
    for (const scrollTop of [0, 200]) {
      viewport.scrollTop = scrollTop;
      const event = new WheelEvent('wheel', {
        deltaY: 100,
        bubbles: true,
        cancelable: true,
      });
      viewport.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(bubbled).not.toHaveBeenCalled();
    for (const key of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
      const event = new WheelEvent('wheel', { bubbles: true });
      // Happy DOM does not initialize inherited WheelEvent modifiers.
      Object.defineProperty(event, key, { value: true });
      viewport.dispatchEvent(event);
    }
    expect(bubbled).toHaveBeenCalledTimes(4);
    Object.defineProperty(viewport, 'scrollHeight', { value: 100 });
    viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    expect(bubbled).toHaveBeenCalledTimes(5);
    act(() => root.render(null));
    viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    expect(disconnect).toHaveBeenCalledTimes(6);
  });

  it('observes intrinsic content and viewport independently and hides the fade at the bottom', () => {
    act(() => root.render(<NoteDesignDraft />));
    const note = required(
      container.querySelector<HTMLElement>('[data-note-specimen]'),
    );
    const viewport = required(
      note.querySelector<HTMLElement>('[data-note-content-viewport]'),
    );
    const host = required(
      note.querySelector<HTMLElement>('[data-note-content-host]'),
    );
    const prose = required(host.querySelector<HTMLElement>('.ProseMirror'));
    Object.defineProperty(prose, 'scrollHeight', {
      value: 400,
      configurable: true,
    });
    Object.defineProperty(host, 'scrollHeight', { value: 900 });
    Object.defineProperty(viewport, 'clientHeight', { value: 100 });
    act(() => resizeCallbacks.forEach((callback) => callback()));
    expect(observe).toHaveBeenCalledWith(prose);
    expect(observe).toHaveBeenCalledWith(viewport);
    const fade = required(
      note.querySelector<HTMLElement>('[data-note-truncation-fade]'),
    );
    expect(fade).not.toBeNull();
    expect(fade.classList.contains('pointer-events-none')).toBe(true);
    expect(parseFloat(fade.style.height)).toBeCloseTo(12 / (300 / 352));
    act(() => {
      viewport.scrollTop =
        readNoteIntrinsicHeight(host) - viewport.clientHeight;
      viewport.dispatchEvent(new Event('scroll'));
    });
    expect(note.querySelector('[data-note-truncation-fade]')).toBeNull();
    act(() => {
      viewport.scrollTop = 0;
      viewport.dispatchEvent(new Event('scroll'));
    });
    expect(note.querySelector('[data-note-truncation-fade]')).not.toBeNull();
    const replacement = document.createElement('div');
    replacement.className = 'ProseMirror';
    Object.defineProperty(replacement, 'scrollHeight', { value: 20 });
    act(() => {
      prose.replaceWith(replacement);
      mutationCallbacks.forEach((callback) => callback());
    });
    expect(unobserve).toHaveBeenCalledWith(prose);
    expect(observe).toHaveBeenCalledWith(replacement);
    expect(note.querySelector('[data-note-truncation-fade]')).toBeNull();
  });

  it('uses subdued accent Note specimens without the removed surface comparison', () => {
    const comparison = document.createElement('div');
    comparison.innerHTML = renderToStaticMarkup(<NoteDesignDraft />);
    const accent = resolveAccent('teal');
    if (!accent) throw new Error('Expected teal accent');
    expect(comparison.querySelectorAll('[data-note-specimen]')).toHaveLength(3);
    expect(comparison.querySelector('#note-surfaces')).toBeNull();
    for (const note of comparison.querySelectorAll('[data-note-specimen]')) {
      expect(note.getAttribute('style')).toContain(
        `background-color:${NOTE_SURFACE_BACKGROUND}`,
      );
      expect(note.getAttribute('style')).not.toContain('--bg-note-surface:');
      expect(note.getAttribute('style')).toContain(
        '--note-surface-background:color-mix(',
      );
      expect(note.getAttribute('style')).toContain(
        `border-color:${noteBoundaryForAccent(accent).borderColor}`,
      );
      expect(note.getAttribute('style')).toContain(
        `border-width:${NOTE_SURFACE_DESIGN_CONFIG.borderWidth}px`,
      );
    }
  });

  it('shows the production fade for overflowing neutral Full specimens', () => {
    act(() => root.render(<NoteDesignDraft />));
    const note = required(
      container.querySelector('[data-note-specimen="Compact"]'),
    );
    const viewport = required(
      note.querySelector<HTMLElement>('[data-note-content-viewport]'),
    );
    const prose = required(note.querySelector('.ProseMirror'));
    Object.defineProperty(prose, 'scrollHeight', { value: 800 });
    Object.defineProperty(viewport, 'clientHeight', { value: 100 });
    act(() => resizeCallbacks.forEach((callback) => callback()));
    expect(note.querySelector('[data-note-truncation-fade]')).not.toBeNull();
  });
});
