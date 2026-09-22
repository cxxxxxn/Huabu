// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { FAR_ZOOM_DESIGN } from '@/components/Nodes/design/farZoomDesign';

import { FarLabelTypographyComparison } from './FarLabelTypographyComparison';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('compares historical metrics with adopted production defaults on identical shells', () => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(16);
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    act(() => root.render(<FarLabelTypographyComparison />));
    const current = container.querySelectorAll<HTMLElement>(
      '[data-typography-variant="previous"]',
    );
    const candidate = container.querySelectorAll<HTMLElement>(
      '[data-typography-variant="adopted"]',
    );
    expect(current).toHaveLength(4);
    current.forEach((pair, i) => {
      const shell = pair.querySelector('article')!;
      const other = candidate[i].querySelector('article')!;
      expect(shell.getAttribute('style')).toBe(other.getAttribute('style'));
      expect(shell.getAttribute('aria-label')).toBe(
        other.getAttribute('aria-label'),
      );
      const title = pair.querySelector<HTMLElement>('[data-study-title]')!;
      const candidateTitle =
        candidate[i].querySelector<HTMLElement>('[data-study-title]')!;
      expect(title.textContent).toBe(candidateTitle.textContent);
      expect(title.style.fontWeight).toBe('500');
      expect(candidateTitle.style.fontWeight).toBe(
        String(FAR_ZOOM_DESIGN.labelWeight),
      );
      expect(title.style.fontSize).toBe(`${FAR_ZOOM_DESIGN.labelFont}px`);
      expect(candidateTitle.style.fontSize).toBe(
        `${FAR_ZOOM_DESIGN.labelFont}px`,
      );
      const label = pair.querySelector<HTMLElement>('[data-study-label]')!;
      const otherLabel =
        candidate[i].querySelector<HTMLElement>('[data-study-label]')!;
      expect(label.style.top).toBe(otherLabel.style.top);
      expect(parseFloat(label.style.left) * 0.24).toBeCloseTo(6);
      expect(parseFloat(otherLabel.style.left) * 0.24).toBeCloseTo(
        FAR_ZOOM_DESIGN.labelInsetInline,
      );
    });
    expect(
      current[0].querySelector<HTMLElement>('[data-study-description]')!.style
        .fontSize,
    ).toBe('9px');
    expect(
      candidate[0].querySelector<HTMLElement>('[data-study-description]')!.style
        .fontSize,
    ).toBe(`${FAR_ZOOM_DESIGN.descriptionFont}px`);
    expect(current[3].querySelector('[data-study-description]')).toBeNull();
    expect(candidate[3].querySelector('[data-study-description]')).toBeNull();
  } finally {
    act(() => root.unmount());
    vi.restoreAllMocks();
  }
});
