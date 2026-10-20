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

vi.mock('../../../hooks/useTextHighlight', () => ({
  useTextHighlight: () => ({ matchCount: 0 }),
}));

vi.mock('./PreviewSearchAdapterContext', () => ({
  usePreviewSearchAdapter: () => null,
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
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
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
    scope.innerHTML =
      '<p data-preview-search-content>first needle</p><p data-preview-search-content>second needle</p>';
    await act(async () => {
      await vi.waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    });
    expect(scroll.mock.instances[0]).toBe(scope.lastElementChild);
    expect(usePreviewSearchStore.getState().navigationRequest).toBeNull();
    expect(document.activeElement).toBe(focus);
    scroll.mockRestore();
  });

  it('is active while its node owns preview search', () => {
    usePreviewSearchStore.getState().open('pdf-1');
    usePreviewSearchStore.getState().setQuery('needle');

    act(() =>
      root.render(<InPreviewSearchBar scopeEl={null} nodeId="pdf-1" />),
    );

    expect(container.querySelector('input')?.value).toBe('needle');
  });

  it('resets the shared store when unmounted so a stale query cannot resurface', () => {
    usePreviewSearchStore.getState().open('pdf-1');
    usePreviewSearchStore.getState().setQuery('needle');
    act(() =>
      root.render(<InPreviewSearchBar scopeEl={null} nodeId="pdf-1" />),
    );

    act(() => root.unmount());

    expect(usePreviewSearchStore.getState()).toMatchObject({
      nodeId: null,
      query: '',
      isOpen: false,
    });
  });

  it('resets the shared store when the owning node changes', () => {
    usePreviewSearchStore.getState().open('pdf-1');
    usePreviewSearchStore.getState().setQuery('needle');
    act(() =>
      root.render(<InPreviewSearchBar scopeEl={null} nodeId="pdf-1" />),
    );

    act(() =>
      root.render(<InPreviewSearchBar scopeEl={null} nodeId="pdf-2" />),
    );

    expect(usePreviewSearchStore.getState()).toMatchObject({
      nodeId: null,
      query: '',
      isOpen: false,
    });
  });
});
