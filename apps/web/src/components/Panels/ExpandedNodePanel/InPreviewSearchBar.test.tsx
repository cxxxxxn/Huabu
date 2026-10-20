// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InPreviewSearchBar } from './InPreviewSearchBar';
import { usePreviewSearchStore } from '../../../store/previewSearchStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  usePreviewSearchStore.getState().close();
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(10, 100, 80, 20),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('InPreviewSearchBar preview-search lifecycle', () => {
  it('keeps a newer node search when the previous renderer unmounts', () => {
    usePreviewSearchStore.getState().open('note-1');
    act(() =>
      root.render(<InPreviewSearchBar scopeEl={null} nodeId="note-1" />),
    );
    const focusedControl = document.createElement('button');
    container.append(focusedControl);
    focusedControl.focus();
    act(() => {
      usePreviewSearchStore.getState().reveal('note-2', 'needle', 1);
      root.render(<InPreviewSearchBar scopeEl={null} nodeId="note-2" />);
    });
    expect(usePreviewSearchStore.getState()).toMatchObject({
      nodeId: 'note-2',
      query: 'needle',
      navigationRequest: { occurrenceIndex: 1 },
    });
    expect(document.activeElement).toBe(focusedControl);
  });

  it('waits for asynchronously mounted note content and scrolls to the requested occurrence', async () => {
    const scope = document.createElement('div');
    const rootHost = document.createElement('div');
    act(() => root.unmount());
    container.append(scope, rootHost);
    root = createRoot(rootHost);
    const scroll = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => {});
    const focus = document.createElement('button');
    container.append(focus);
    focus.focus();
    usePreviewSearchStore.getState().reveal('note-1', 'needle', 1);
    act(() =>
      root.render(<InPreviewSearchBar scopeEl={scope} nodeId="note-1" />),
    );
    expect(usePreviewSearchStore.getState().navigationRequest).not.toBeNull();
    scope.innerHTML = '<p data-preview-search-content>first needle</p>';
    await act(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    expect(scroll).not.toHaveBeenCalled();
    expect(usePreviewSearchStore.getState().navigationRequest).not.toBeNull();
    scope.insertAdjacentHTML(
      'beforeend',
      '<p data-preview-search-content>second needle</p>',
    );
    await act(async () => {
      await vi.waitFor(() =>
        expect(usePreviewSearchStore.getState().navigationRequest).toBeNull(),
      );
    });
    expect(container.textContent).toContain('2/2');
    expect(usePreviewSearchStore.getState().navigationRequest).toBeNull();
    expect(document.activeElement).toBe(focus);
    scroll.mockRestore();
  });

  it('uses the full count to navigate beyond the 500-range highlight cap', () => {
    const scope = document.createElement('p');
    scope.dataset.previewSearchContent = '';
    scope.textContent = 'needle '.repeat(600);
    container.append(scope);
    usePreviewSearchStore.getState().reveal('note-1', 'needle', 500);
    act(() =>
      root.render(<InPreviewSearchBar scopeEl={scope} nodeId="note-1" />),
    );
    expect(container.textContent).toContain('501/600');
    const next = container.querySelectorAll('button')[1];
    act(() => next?.click());
    expect(container.textContent).toContain('502/600');
  });

  it('keeps indexed navigation pending before an adapter registers even if DOM text matches', () => {
    const scope = document.createElement('p');
    scope.textContent = 'needle';
    container.append(scope);
    usePreviewSearchStore.getState().reveal('pdf-1', 'needle', 0);
    act(() =>
      root.render(
        <InPreviewSearchBar scopeEl={scope} nodeId="pdf-1" requiresAdapter />,
      ),
    );
    expect(usePreviewSearchStore.getState().navigationRequest).not.toBeNull();
    expect(container.querySelector('button')?.disabled).toBe(true);
  });

  it('bounds the wait for a missing indexed adapter', () => {
    vi.useFakeTimers();
    try {
      usePreviewSearchStore.getState().reveal('pdf-1', 'needle', 0);
      act(() =>
        root.render(
          <InPreviewSearchBar
            scopeEl={container}
            nodeId="pdf-1"
            requiresAdapter
          />,
        ),
      );
      act(() => vi.advanceTimersByTime(8000));
      expect(usePreviewSearchStore.getState().navigationRequest).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is active while its node owns preview search', () => {
    usePreviewSearchStore.getState().open('pdf-1');
    usePreviewSearchStore.getState().setQuery('needle');

    act(() =>
      root.render(<InPreviewSearchBar scopeEl={null} nodeId="pdf-1" />),
    );

    expect(container.querySelector('input')?.value).toBe('needle');
  });

  it('resets the shared store when unmounted so a stale query cannot resurface', async () => {
    usePreviewSearchStore.getState().open('pdf-1');
    usePreviewSearchStore.getState().setQuery('needle');
    act(() =>
      root.render(<InPreviewSearchBar scopeEl={null} nodeId="pdf-1" />),
    );

    await act(async () => root.unmount());

    expect(usePreviewSearchStore.getState()).toMatchObject({
      nodeId: null,
      query: '',
      isOpen: false,
    });
  });

  it('resets the shared store when the owning node changes', async () => {
    usePreviewSearchStore.getState().open('pdf-1');
    usePreviewSearchStore.getState().setQuery('needle');
    act(() =>
      root.render(<InPreviewSearchBar scopeEl={null} nodeId="pdf-1" />),
    );

    await act(async () =>
      root.render(<InPreviewSearchBar scopeEl={null} nodeId="pdf-2" />),
    );

    expect(usePreviewSearchStore.getState()).toMatchObject({
      nodeId: null,
      query: '',
      isOpen: false,
    });
  });
});
