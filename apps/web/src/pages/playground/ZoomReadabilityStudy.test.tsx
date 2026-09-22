// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { frameVisualMetricsForSize } from '@/components/Nodes/frame/frameDesign';
import { getFrameHeaderMetrics } from '@/components/Nodes/frame/frameHeaderMetrics';
import { farFrameRegionPresentation } from '@/components/Nodes/frame/frameZoom';

import { ZoomReadabilityStudy } from './ZoomReadabilityStudy';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/components/Common/Loading', () => ({ Loading: () => null }));
vi.mock('@/components/Milkdown/MilkdownPreview', () => ({
  MilkdownPreview: ({ markdown }: { markdown: string }) => (
    <div className="ProseMirror">{markdown}</div>
  ),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function required<T>(value: T | null): T {
  if (value === null) throw new Error('Missing study element');
  return value;
}

describe('ZoomReadabilityStudy', () => {
  let container: HTMLDivElement;
  let root: Root;

  function mount() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<ZoomReadabilityStudy />));
  }

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  it('starts at 400px × 50%, with the same existing content inside and outside a Frame', () => {
    mount();
    expect(container.querySelector('[data-study-readout]')?.textContent).toBe(
      '50% · node 200 × 160px',
    );
    const scenes = container.querySelectorAll<HTMLElement>(
      '[data-study-scene="independent"], [data-study-scene="grouped"]',
    );
    expect(scenes).toHaveLength(4);
    for (const scene of scenes) {
      expect(scene.style.transform).toBe('scale(0.5)');
      expect(scene.querySelectorAll('[data-study-node]')).toHaveLength(3);
      expect(
        scene.querySelector('[data-study-node="note"] .ProseMirror')
          ?.textContent,
      ).toContain('工作记录');
      expect(scene.querySelectorAll('.preview-card')).toHaveLength(2);
      for (const node of scene.querySelectorAll<HTMLElement>(
        '[data-study-node]',
      )) {
        expect(node.style.width).toBe('400px');
        expect(node.style.height).toBe('320px');
      }
    }
    expect(container.querySelector('.semantic-lod-placeholder')).toBeNull();
    expect(container.querySelector('[data-minimal-rules]')).toBeNull();
  });

  it('scales the same mounted content down to 40px without promoting labels or changing geometry', () => {
    mount();
    const note = container.querySelector('.ProseMirror');
    const card = container.querySelector('.preview-card');
    const far = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '10%',
    );
    expect(far).toBeDefined();
    act(() => far?.click());
    expect(container.querySelector('[data-study-readout]')?.textContent).toBe(
      '10% · node 40 × 32px',
    );
    expect(container.querySelector('.ProseMirror')).toBe(note);
    expect(container.querySelector('.preview-card')).toBe(card);
    for (const scene of container.querySelectorAll<HTMLElement>(
      '[data-study-scene]',
    )) {
      expect(scene.style.transform).toBe('scale(0.1)');
    }
    expect(container.querySelector('.semantic-lod-placeholder')).toBeNull();
    expect(container.textContent).toContain('does not simulate production LOD');
  });

  it('keeps the 200px proposal intact, then hands off to bounded titles without remounting content', () => {
    mount();
    const proposal = required(
      container.querySelector(
        '[data-study-scene="independent"][data-study-variant="proposal"]',
      ),
    );
    const document = proposal.querySelector('.ProseMirror');
    const content = required(
      proposal.querySelector<HTMLElement>('[data-study-content]'),
    );
    const label = required(
      proposal.querySelector<HTMLElement>('[data-study-label]'),
    );
    expect(content.style.opacity).toBe('1');
    expect(content.inert).toBe(false);
    expect(label.style.opacity).toBe('0');
    act(() =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === '25%')
        ?.click(),
    );
    expect(content.style.opacity).toBe('1');
    expect(label.style.opacity).toBe('0');
    act(() =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === '15%')
        ?.click(),
    );
    expect(content.style.opacity).toBe('0');
    expect(content.inert).toBe(true);
    expect(content.getAttribute('aria-hidden')).toBe('true');
    expect(label.style.opacity).toBe('1');
    expect(
      label.querySelector<HTMLElement>('[data-study-title]')?.style.fontSize,
    ).toBe('10px');
    expect(
      label.querySelector<HTMLElement>('[data-study-title]')?.style.maxHeight,
    ).toBe('28px');
    expect(proposal.querySelector('.ProseMirror')).toBe(document);
  });

  it('uses production Frame spacing without reserving extra room for far titles', () => {
    mount();
    for (const [context, width, height] of [
      ['grouped', 1280, 404],
      ['dense', 800, 464],
    ] as const) {
      const metrics = frameVisualMetricsForSize(width, height);
      const header = getFrameHeaderMetrics(
        metrics.contentSpacing,
        width,
        metrics.titleFontSize,
        metrics.headerInset,
      );
      for (const scene of container.querySelectorAll(
        `[data-study-scene="${context}"]`,
      )) {
        for (const grid of scene.querySelectorAll<HTMLElement>(
          '[data-study-children]',
        )) {
          expect(grid.style.top).toBe(`${metrics.headerInset}px`);
          expect(grid.style.left).toBe(`${metrics.contentSpacing}px`);
          expect(grid.style.gap).toBe(`${metrics.contentSpacing}px`);
          const frame = required(
            grid.closest<HTMLElement>('[data-study-frame]'),
          );
          const node = required(
            grid.querySelector<HTMLElement>('[data-study-node]'),
          );
          const rows = grid.querySelectorAll('[data-study-node]').length / 3;
          const contentWidth =
            parseFloat(node.style.width) * 3 + metrics.contentSpacing * 2;
          const contentHeight =
            parseFloat(node.style.height) * rows +
            metrics.contentSpacing * (rows - 1);
          expect(frame.style.width).toBe(`${width}px`);
          expect(frame.style.height).toBe(`${height}px`);
          expect(width - parseFloat(grid.style.left) - contentWidth).toBe(
            metrics.contentSpacing,
          );
          expect(height - parseFloat(grid.style.top) - contentHeight).toBe(
            metrics.contentSpacing,
          );
        }
        expect((scene as HTMLElement).style.width).toBe(
          `${context === 'dense' ? width * 2 + 80 : width}px`,
        );
        expect((scene as HTMLElement).style.height).toBe(`${height}px`);
        if (scene.getAttribute('data-study-variant') === 'baseline') {
          const row = required(
            scene.querySelector<HTMLElement>('[data-study-frame-name] > div'),
          );
          expect(row.style.top).toBe(`${header.top}px`);
          expect(row.style.fontSize).toBe(`${header.fontSize}px`);
        }
      }
    }
  });

  it('hands off to the top-left Frame name with its count, preserving children and restoring them on zoom in', () => {
    mount();
    expect(
      container.querySelectorAll(
        '[data-study-scene="dense"] [data-study-node]',
      ),
    ).toHaveLength(24);
    act(() =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === '14%')
        ?.click(),
    );
    const grouped = required(
      container.querySelector(
        '[data-study-scene="grouped"][data-study-variant="proposal"]',
      ),
    );
    expect(
      grouped.querySelector<HTMLElement>('[data-study-frame-name]')?.style
        .opacity,
    ).toBe('0');
    const region = required(
      grouped.querySelector<HTMLElement>('[data-study-frame-region]'),
    );
    expect(region.style.opacity).toBe('1');
    const regionLabel = required(
      region.querySelector<HTMLElement>('[data-frame-region-label]'),
    );
    expect(Number.parseFloat(regionLabel.style.left)).toBeGreaterThan(0);
    expect(Number.parseFloat(regionLabel.style.top)).toBeGreaterThanOrEqual(0);
    expect(regionLabel.style.left).not.toBe('50%');
    expect(regionLabel.style.fontSize).toBe(
      `${farFrameRegionPresentation(200, 100, 0.14).fontSize}px`,
    );
    expect(regionLabel.style.transform).toBe(`scale(${1 / 0.14})`);
    const regionTitle = required(
      region.querySelector<HTMLElement>('[data-frame-region-title]'),
    );
    expect(regionTitle.textContent).toBe('研究资料与工作笔记');
    expect(region.querySelector('[data-frame-region-count]')?.textContent).toBe(
      '3',
    );
    expect(region.querySelectorAll('[data-frame-region-count]')).toHaveLength(
      1,
    );
    expect(
      regionLabel
        .querySelector('[aria-hidden="true"]')
        ?.classList.contains('invisible'),
    ).toBe(true);
    expect(region.style.backgroundColor).toBe('');
    expect(region.querySelector('[data-study-frame-backing]')).toBeNull();
    expect(region.style.filter).toBe('');
    expect(region.style.boxShadow).toBe('');
    const lineHeight = Number.parseFloat(regionLabel.style.lineHeight);
    const titleLines =
      Math.floor(Number.parseFloat(regionLabel.style.maxHeight) / lineHeight) -
      1;
    expect(titleLines).toBeGreaterThan(0);
    expect(regionTitle.style.maxHeight).toBe(`${titleLines * lineHeight}px`);
    const document = grouped.querySelector('.ProseMirror');
    for (const node of grouped.querySelectorAll<HTMLElement>(
      '[data-study-node]',
    ))
      expect(node.style.opacity).toBe('1');
    for (const label of grouped.querySelectorAll<HTMLElement>(
      '[data-study-label]',
    ))
      expect(label.style.opacity).toBe('0');
    for (const content of grouped.querySelectorAll<HTMLElement>(
      '[data-study-content]',
    )) {
      expect(content.style.opacity).toBe('0');
      expect(content.inert).toBe(true);
    }
    expect(
      grouped.querySelector<HTMLElement>('[data-study-children]')?.style.top,
    ).toBe('64px');
    act(() =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === '5%')
        ?.click(),
    );
    for (const label of container.querySelectorAll<HTMLElement>(
      '[data-study-variant="proposal"] [data-study-label], [data-study-variant="proposal"] [data-study-frame-name], [data-study-variant="proposal"] [data-study-frame-region]',
    ))
      expect(label.style.opacity).toBe('0');
    act(() =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === '25%')
        ?.click(),
    );
    expect(region.style.opacity).toBe('0');
    for (const node of grouped.querySelectorAll<HTMLElement>(
      '[data-study-node]',
    ))
      expect(node.style.opacity).toBe('1');
    expect(
      grouped.querySelector<HTMLElement>('[data-study-label]')?.style.opacity,
    ).toBe('1');
    expect(grouped.querySelector('.ProseMirror')).toBe(document);
    expect(
      grouped.querySelector<HTMLElement>('[data-study-children]')?.style.top,
    ).toBe('64px');
    const dense = required(
      container.querySelector(
        '[data-study-scene="dense"][data-study-variant="proposal"]',
      ),
    );
    // Dense content no longer causes an earlier Frame takeover at the same zoom.
    for (const name of dense.querySelectorAll<HTMLElement>(
      '[data-study-frame-region]',
    ))
      expect(name.style.opacity).toBe('0');
    act(() =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === '14%')
        ?.click(),
    );
    for (const name of dense.querySelectorAll<HTMLElement>(
      '[data-study-frame-region]',
    ))
      expect(name.style.opacity).toBe('1');
    act(() =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === '50%')
        ?.click(),
    );
    expect(
      grouped.querySelector<HTMLElement>('[data-study-frame-name]')?.style
        .opacity,
    ).toBe('1');
    expect(
      grouped.querySelector<HTMLElement>('[data-study-content]')?.style.opacity,
    ).toBe('1');
  });

  it('never leaves content, titles, or Frame names translucent at any preset', () => {
    mount();
    for (const percent of [35, 25, 15, 10, 5, 10, 15, 25, 35, 50]) {
      act(() =>
        Array.from(container.querySelectorAll('button'))
          .find((button) => button.textContent === `${percent}%`)
          ?.click(),
      );
      for (const layer of container.querySelectorAll<HTMLElement>(
        '[data-study-variant="proposal"] [data-study-content], [data-study-variant="proposal"] [data-study-label], [data-study-variant="proposal"] [data-study-frame-name], [data-study-variant="proposal"] [data-study-frame-region]',
      )) {
        expect(['0', '1']).toContain(layer.style.opacity);
        expect(layer.getAttribute('aria-hidden')).toBe(
          layer.style.opacity === '0' ? 'true' : 'false',
        );
      }
    }
  });
});
