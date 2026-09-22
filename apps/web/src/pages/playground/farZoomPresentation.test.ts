// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';

import {
  FAR_ZOOM_DESIGN,
  farDescriptionLines as canonicalDescriptionLines,
} from '@/components/Nodes/design/farZoomDesign';
import {
  resolveFarLabelLayout,
  resolveNodePresentation,
  SEMANTIC_ZOOM_CONFIG,
} from '@/config/semanticZoom';

import {
  FAR_ZOOM_STUDY,
  farDescriptionLines,
  farFramePresentation,
  farFrameRegionPresentation,
  farNodePresentation as resolveStudyNode,
} from './farZoomPresentation';

// Most fixtures represent a 400px authored node at different zoom levels.
function farNodePresentation(
  width: number,
  height: number,
  group = 0,
  previous?: Parameters<typeof resolveStudyNode>[4],
  zoom = width / 400,
  border = 0,
) {
  return resolveStudyNode(width, height, zoom, group, previous, border);
}

describe('far-zoom playground budgets', () => {
  it('aliases the shared design, description helper, and semantic boundaries', () => {
    expect(FAR_ZOOM_STUDY).toMatchObject(FAR_ZOOM_DESIGN);
    expect(farDescriptionLines).toBe(canonicalDescriptionLines);
    expect(FAR_ZOOM_STUDY.contentZoom).toBe(
      SEMANTIC_ZOOM_CONFIG.minimalZoom.exit,
    );
    expect(FAR_ZOOM_STUDY.handoffZoom).toBe(
      SEMANTIC_ZOOM_CONFIG.minimalZoom.enter,
    );
  });

  it('matches canonical content and independent-label policies, including initial mount', () => {
    for (const previous of [
      undefined,
      { contentOpacity: 0, labelRetained: false },
      { contentOpacity: 0, labelRetained: true },
      { contentOpacity: 1, labelRetained: true },
    ]) {
      for (const [width, height] of [
        [50, 41],
        [100, 80],
        [140, 112],
        [145, 116],
        [155, 124],
        [160, 128],
        [800, 111],
        [800, 120],
        [800, 128],
        [800, 500],
      ]) {
        const contentOpacity =
          resolveNodePresentation(
            width / 400,
            width,
            height,
            previous?.contentOpacity === 0 ? 'minimal' : 'overview',
            false,
          ) === 'minimal'
            ? 0
            : 1;
        const layout = resolveFarLabelLayout(
          width,
          height,
          previous?.labelRetained,
        );
        expect(farNodePresentation(width, height, 0, previous)).toEqual({
          ...layout,
          contentOpacity,
          labelOpacity: contentOpacity === 0 && layout.labelRetained ? 1 : 0,
        });
      }
    }
    expect(farNodePresentation(145, 116).contentOpacity).toBe(1);
  });

  it('takes over by zoom with hysteresis, only where the title fits', () => {
    expect(farFrameRegionPresentation(350, 140, 0.25).visible).toBe(false);
    expect(farFrameRegionPresentation(210, 82.5, 0.14).visible).toBe(true);
    expect(farFrameRegionPresentation(210, 82.5, 0.18, false).active).toBe(
      false,
    );
    expect(farFrameRegionPresentation(210, 82.5, 0.18, true).active).toBe(true);
    expect(farFrameRegionPresentation(210, 82.5, 0.2, true).active).toBe(false);
    expect(farFrameRegionPresentation(210, 82.5, 0.149, false).active).toBe(
      true,
    );
    expect(farFrameRegionPresentation(27, 100, 0.1).visible).toBe(false);
    expect(farFrameRegionPresentation(70, 100, 0.1).visible).toBe(true);
    expect(farFrameRegionPresentation(200, 48, 0.1).visible).toBe(false);
    expect(farFrameRegionPresentation(200, 49, 0.1).visible).toBe(true);
    expect(farFrameRegionPresentation(200, 49, 0.1)).toMatchObject({
      fontSize: 11,
      lines: 1,
    });
    expect(farFrameRegionPresentation(200, 69, 0.1).lines).toBe(2);
    expect(farFrameRegionPresentation(200, 70, 0.1).lines).toBe(2);
    expect(farFrameRegionPresentation(200, 200, 0.1).lines).toBe(10);
    expect(farFrameRegionPresentation(350, 140, 0.4, true).visible).toBe(false);
  });
  it('uses zoom independently of geometry while fitting the label to inner bounds', () => {
    expect(farNodePresentation(200, 20, 0, undefined, 0.5).contentOpacity).toBe(
      1,
    );
    expect(farNodePresentation(200, 20, 0, undefined, 0.2).contentOpacity).toBe(
      0,
    );
    const layout = farNodePresentation(80, 20, 0, undefined, 0.2, 1);
    expect(layout.verticalInset).toBe(2);
    expect(layout.availableHeight).toBe(14);
    expect(layout.labelOpacity).toBe(1);
  });

  it('preserves readable geometry and hands off without a blank midpoint', () => {
    expect(farNodePresentation(200, 160)).toMatchObject({
      contentOpacity: 1,
      labelOpacity: 0,
    });
    expect(farNodePresentation(99, 80)).toMatchObject({
      contentOpacity: 0,
      labelOpacity: 1,
      lines: 4,
    });
    for (let width = 1; width <= 400; width++) {
      const result = farNodePresentation(width, width * 0.8);
      if (width >= 120)
        expect(result.contentOpacity + result.labelOpacity).toBeGreaterThan(0);
      expect(result.labelOpacity).toBeGreaterThanOrEqual(0);
      expect(result.labelOpacity).toBeLessThanOrEqual(1);
      expect([0, 1]).toContain(result.labelOpacity);
      expect([0, 1]).toContain(result.contentOpacity);
      expect(result.labelOpacity + result.contentOpacity).toBeLessThanOrEqual(
        1,
      );
    }
  });

  it('only yields child labels when a readable group name can replace them', () => {
    expect(farNodePresentation(60, 48, 1).labelOpacity).toBeLessThan(
      farNodePresentation(60, 48, 0).labelOpacity,
    );
    expect(farNodePresentation(40, 32, 1).labelOpacity).toBe(0);
    expect(
      farNodePresentation(60, 48, 0, { contentOpacity: 0, labelRetained: true })
        .labelOpacity,
    ).toBe(1);
    expect(farFramePresentation(128, 18, 4).opacity).toBeGreaterThan(0);
    expect(farFramePresentation(64, 9, 2).opacity).toBe(0);
  });

  it('hides labels when a complete line cannot fit, including short wide nodes', () => {
    for (const [width, height] of [
      [20, 16],
      [200, 15],
      [10, 100],
      [40, 32],
    ]) {
      expect(farNodePresentation(width, height).labelOpacity).toBe(0);
    }
    expect(farNodePresentation(200, 15).contentOpacity).toBe(1);
    expect(farFramePresentation(30, 100, 14).opacity).toBe(0);
  });

  it('retains the preceding node state inside each hysteresis band', () => {
    let state = farNodePresentation(200, 160);
    state = farNodePresentation(110, 88, 0, state);
    expect(state.contentOpacity).toBe(1);
    state = farNodePresentation(99, 79, 0, state);
    expect(state.labelOpacity).toBe(1);
    state = farNodePresentation(115, 92, 0, state);
    expect(state.contentOpacity).toBe(0);
    expect(farNodePresentation(120, 96, 0, state).contentOpacity).toBe(1);
    state = farNodePresentation(100, 80, 1);
    expect(farNodePresentation(72, 58, 1, state).labelOpacity).toBe(1);
    state = farNodePresentation(67, 54, 1, state);
    expect(state.labelOpacity).toBe(0);
    expect(farNodePresentation(76, 61, 1, state).labelOpacity).toBe(0);
    expect(farNodePresentation(80, 64, 1, state).labelOpacity).toBe(1);
  });

  it('keeps Frame text binary and stable at its boundaries without violating fit', () => {
    expect(farFramePresentation(70, 22, 4, true).opacity).toBe(1);
    expect(farFramePresentation(70, 22, 4, false).opacity).toBe(0);
    expect(farFramePresentation(80, 22, 4, false).opacity).toBe(1);
    expect(farFramePresentation(128, 17, 4, true).opacity).toBe(1);
    expect(farFramePresentation(128, 17, 4, false).opacity).toBe(0);
    expect(farFramePresentation(128, 16, 4, true).opacity).toBe(0);
    for (let width = 1; width < 200; width++)
      expect([0, 1]).toContain(
        farFramePresentation(width, width / 6, 4).opacity,
      );
  });
});
