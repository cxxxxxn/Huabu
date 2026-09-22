// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useQuestionHeaderFit } from '@/components/Nodes/question/useQuestionHeaderFit';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Question header fit measurement', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('remeasures intrinsic probes, restores hidden labels and disconnects observers', async () => {
    let available = 200;
    let aliasWidth = 80;
    let labelWidth = 48;
    let visible = true;
    let refresh = () => {};
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          refresh = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() =>
      visible
        ? ([new DOMRect()] as unknown as DOMRectList)
        : ([] as unknown as DOMRectList),
    );
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const node = element as HTMLElement;
      return {
        width: String(
          node.dataset.probe === 'alias'
            ? aliasWidth
            : node.dataset.probe === 'label'
              ? labelWidth
              : available,
        ),
      } as CSSStyleDeclaration;
    });
    function Harness({ alias = 'Short' }: { alias?: string }) {
      const { fit, headerRef, aliasRef, labelRef } = useQuestionHeaderFit(
        32,
        8,
        16,
        alias,
        'Status',
      );
      return (
        <div
          ref={headerRef}
          data-alias={fit.alias}
          data-status={fit.status}
          data-label={fit.statusText}
        >
          <span ref={aliasRef} data-probe="alias">
            {alias}
          </span>
          <span ref={labelRef} data-probe="label">
            Status
          </span>
        </div>
      );
    }
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const result = () => ({
      ...(host.firstElementChild as HTMLElement).dataset,
    });
    try {
      await act(async () => root.render(<Harness />));
      expect(result()).toEqual({
        alias: 'true',
        status: 'true',
        label: 'true',
      });
      expect(observe).toHaveBeenCalledTimes(3);
      available = 120;
      act(refresh);
      expect(result()).toEqual({
        alias: 'false',
        status: 'true',
        label: 'true',
      });
      available = 200;
      act(refresh);
      expect(result().alias).toBe('true');
      aliasWidth = 180;
      await act(async () => root.render(<Harness alias="Longer Agent name" />));
      expect(result().alias).toBe('false');
      // Font changes can resize a probe without changing its text or container.
      aliasWidth = 80;
      act(refresh);
      expect(result().alias).toBe('true');
      labelWidth = 170;
      act(refresh);
      expect(result()).toEqual({
        alias: 'true',
        status: 'true',
        label: 'false',
      });
      visible = false;
      available = 40;
      act(refresh);
      expect(result().alias).toBe('true');
      visible = true;
      act(refresh);
      expect(result()).toEqual({
        alias: 'false',
        status: 'false',
        label: 'false',
      });
    } finally {
      act(() => root.unmount());
      host.remove();
    }
    expect(disconnect).toHaveBeenCalledTimes(2);
  });
});
