// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { NoteContentViewport } from './NoteContentViewport';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it.each([true, false])(
  'preserves viewport height with native scrollbar visibility %s',
  (visible) => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root.render(
        <NoteContentViewport
          scrollingEnabled
          nativeScrollbarVisible={visible}
          viewportRef={null}
          contentHostRef={null}
          onScroll={vi.fn()}
        >
          Long document
        </NoteContentViewport>,
      ),
    );
    const viewport = container.querySelector<HTMLElement>(
      '[data-note-content-viewport]',
    );
    expect(viewport?.classList.contains('h-full')).toBe(true);
    expect(viewport?.classList.contains('huabu-scrollbar')).toBe(visible);
    expect(viewport?.style.overflowY).toBe('auto');
  },
);
