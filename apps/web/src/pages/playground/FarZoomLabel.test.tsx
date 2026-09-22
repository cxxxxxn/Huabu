// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FAR_ZOOM_DESIGN,
  farDescriptionLines,
} from '@/components/Nodes/design/farZoomDesign';
import { FarZoomLabel } from '@/components/Nodes/semanticZoom/FarZoomLabel';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('far-zoom optional descriptions', () => {
  let root: Root | undefined;
  let container: HTMLDivElement;
  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    container?.remove();
    vi.restoreAllMocks();
  });

  it('uses remaining height without a width threshold or fixed line-count limits', () => {
    const design = {
      ...FAR_ZOOM_DESIGN,
      labelLine: 16,
      descriptionLine: 10,
      descriptionGap: 4,
    };
    expect(farDescriptionLines(86, 160, 16, 3, design)).toBe(14);
    expect(farDescriptionLines(86, 80, 32, 3, design)).toBe(4);
    expect(farDescriptionLines(86, 60, 48, 3, design)).toBe(0);
    expect(farDescriptionLines(86, 160, 64, 3, design)).toBe(0);
    expect(farDescriptionLines(60, 160, 16, 3, design)).toBe(14);
    expect(farDescriptionLines(86, 160, 0, 3, design)).toBe(0);
    expect(farDescriptionLines(60, 30, 16, 3, design)).toBe(1);
    expect(farDescriptionLines(60, 29.9, 16, 3, design)).toBe(0);
    expect(farDescriptionLines(0, 160, 17, 3, design)).toBe(0);
  });

  it('uses existing text, removes descriptions before titles, and never fades them', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(16);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const render = (
      width: number,
      description: string | undefined,
      visible = true,
      height = 160,
    ) =>
      act(() =>
        root?.render(
          <FarZoomLabel
            title="cmux"
            description={description}
            width={width}
            height={height}
            lines={3}
            zoom={0.25}
            visible={visible}
          />,
        ),
      );
    render(86, 'Existing excerpt');
    expect(
      container.querySelector('[data-study-description]')?.textContent,
    ).toBe('Existing excerpt');
    expect(
      container.querySelector<HTMLElement>('[data-study-label]')?.style.opacity,
    ).toBe('1');
    expect(
      container.querySelector<HTMLElement>('[data-study-description]')?.style
        .fontSize,
    ).toBe(`${FAR_ZOOM_DESIGN.descriptionFont}px`);
    const title = container.querySelector<HTMLElement>('[data-study-title]');
    const probe = container.querySelector<HTMLElement>('[data-title-probe]');
    expect(title?.style.fontSize).toBe(`${FAR_ZOOM_DESIGN.labelFont}px`);
    expect(title?.style.lineHeight).toBe(`${FAR_ZOOM_DESIGN.labelLine}px`);
    expect(title?.style.fontWeight).toBe(String(FAR_ZOOM_DESIGN.labelWeight));
    expect(probe?.style.fontWeight).toBe(String(FAR_ZOOM_DESIGN.labelWeight));
    expect(title?.style.overflowWrap).toBe('anywhere');
    expect(probe?.innerHTML).toBe(title?.innerHTML);
    const word = title?.querySelector<HTMLElement>('[data-study-word]');
    expect(word?.style.whiteSpace).toBe('normal');
    expect(word?.style.textOverflow).toBe('');
    expect(word?.style.overflowWrap).toBe('anywhere');
    expect(
      container.querySelector<HTMLElement>('[data-study-label]')?.style.left,
    ).toBe(`${FAR_ZOOM_DESIGN.labelInsetInline / 0.25}px`);
    expect(
      container.querySelector<HTMLElement>('[data-study-label]')?.style.top,
    ).toBe(`${FAR_ZOOM_DESIGN.labelInset / 0.25}px`);
    render(60, 'Existing excerpt');
    expect(
      container.querySelector('[data-study-description]')?.textContent,
    ).toBe('Existing excerpt');
    expect(
      container.querySelector<HTMLElement>('[data-study-description]')?.style
        .maxHeight,
    ).toBe(`${12 * FAR_ZOOM_DESIGN.descriptionLine}px`);
    const oneDescriptionHeight =
      16 + FAR_ZOOM_DESIGN.descriptionGap + FAR_ZOOM_DESIGN.descriptionLine;
    render(60, 'Existing excerpt', true, oneDescriptionHeight);
    expect(
      container.querySelector<HTMLElement>('[data-study-description]')?.style
        .maxHeight,
    ).toBe(`${FAR_ZOOM_DESIGN.descriptionLine}px`);
    render(60, 'Existing excerpt', true, oneDescriptionHeight - 0.1);
    expect(container.querySelector('[data-study-description]')).toBeNull();
    expect(container.querySelector('[data-study-title]')?.textContent).toBe(
      'cmux',
    );
    render(86, undefined);
    expect(container.querySelector('[data-study-description]')).toBeNull();
    render(86, 'cmux');
    expect(container.querySelector('[data-study-description]')).toBeNull();
    render(86, 'Existing excerpt', false);
    expect(container.querySelector('[data-study-description]')).toBeNull();
    expect(
      container.querySelector<HTMLElement>('[data-study-label]')?.style.opacity,
    ).toBe('0');
  });
});
