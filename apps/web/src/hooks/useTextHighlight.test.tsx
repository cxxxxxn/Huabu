// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useTextHighlight } from './useTextHighlight';

let root: Root;
let host: HTMLDivElement;
let canvas: HTMLDivElement;
let preview: HTMLDivElement;
let highlights: Map<string, Set<Range>>;

function Surface({
  element,
  query,
}: {
  element: HTMLElement | null;
  query: string;
}) {
  useTextHighlight({ container: element, query });
  return null;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  highlights = new Map();
  vi.stubGlobal(
    'Highlight',
    class extends Set<Range> {
      constructor(...ranges: Range[]) {
        super(ranges);
      }
    },
  );
  vi.stubGlobal('CSS', { highlights });
  host = document.createElement('div');
  canvas = document.createElement('div');
  preview = document.createElement('div');
  canvas.textContent = 'canvas needle';
  preview.textContent = 'preview needle';
  document.body.append(host, canvas, preview);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  canvas.remove();
  preview.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('merges independent canvas and preview highlights and removes only the closing surface', () => {
  act(() =>
    root.render(
      <>
        <Surface element={canvas} query="needle" />
        <Surface element={preview} query="needle" />
        <Surface element={null} query="" />
      </>,
    ),
  );
  expect(highlights.get('huabu-search')?.size).toBe(2);
  act(() =>
    root.render(
      <>
        <Surface element={canvas} query="needle" />
        <Surface element={null} query="" />
      </>,
    ),
  );
  expect(highlights.get('huabu-search')?.size).toBe(1);
  expect(
    Array.from(highlights.get('huabu-search') ?? [])[0]?.startContainer,
  ).toBe(canvas.firstChild);
  act(() => root.render(<Surface element={null} query="" />));
  expect(highlights.has('huabu-search')).toBe(false);
});
