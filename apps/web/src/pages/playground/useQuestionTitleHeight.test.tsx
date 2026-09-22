// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useQuestionTitleHeight } from './useQuestionTitleHeight';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Question intrinsic title height', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('grows and shrinks with wrapping, recovers when revealed and disconnects', async () => {
    let height = 36;
    let visible = true;
    let refresh = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          refresh = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
      () => (visible ? [new DOMRect()] : []) as unknown as DOMRectList,
    );
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () => ({ height: String(height) }) as CSSStyleDeclaration,
    );
    function Harness({
      title,
      width = 368,
    }: {
      title: string;
      width?: number;
    }) {
      const measurement = useQuestionTitleHeight(title, width, 28);
      return (
        <div ref={measurement.ref} data-height={measurement.height}>
          {title}
        </div>
      );
    }
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const currentHeight = () =>
      Number((host.firstElementChild as HTMLElement).dataset.height);
    try {
      await act(async () => root.render(<Harness title="Short" />));
      expect(currentHeight()).toBe(36);
      height = 180;
      await act(async () => root.render(<Harness title="Long title" />));
      expect(currentHeight()).toBe(180);
      height = 252;
      await act(async () =>
        root.render(<Harness title="Long title" width={184} />),
      );
      expect(currentHeight()).toBe(252);
      // A loaded font can change wrapping without changing props.
      height = 216;
      act(refresh);
      expect(currentHeight()).toBe(216);
      visible = false;
      height = 0;
      act(refresh);
      expect(currentHeight()).toBe(216);
      visible = true;
      height = 36;
      act(refresh);
      expect(currentHeight()).toBe(36);
      height = 0;
      await act(async () => root.render(<Harness title="" />));
      expect(currentHeight()).toBe(0);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
    expect(disconnect).toHaveBeenCalledTimes(4);
  });
});
