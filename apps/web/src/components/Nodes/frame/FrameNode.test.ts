// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';

import {
  getFrameAccentMarkerColor,
  getFrameHeaderMetrics,
} from './frameHeaderMetrics';
import { shouldPreserveFrameAspectRatio } from './frameResizePolicy';

describe('shouldPreserveFrameAspectRatio', () => {
  it('locks a Hug Frame that directly contains media', () => {
    expect(
      shouldPreserveFrameAspectRatio({
        sizing: 'hug',
        hasMediaChild: true,
      }),
    ).toBe(true);
    expect(
      shouldPreserveFrameAspectRatio({
        sizing: undefined,
        hasMediaChild: true,
      }),
    ).toBe(true);
  });

  it('keeps non-media Hug Frames free-axis resizable', () => {
    expect(
      shouldPreserveFrameAspectRatio({
        sizing: 'hug',
        hasMediaChild: false,
      }),
    ).toBe(false);
  });

  it('keeps Manual Frames free-axis resizable when they contain media', () => {
    expect(
      shouldPreserveFrameAspectRatio({
        sizing: 'manual',
        hasMediaChild: true,
      }),
    ).toBe(false);
  });
});

describe('getFrameHeaderMetrics', () => {
  it('fits the title inside the existing top content inset', () => {
    expect(getFrameHeaderMetrics(40, 120, 1380, 52)).toEqual({
      left: 40,
      top: 29,
      height: 62,
      fontSize: 52,
      maxWidth: 1332,
    });
  });

  it('uses compact fallback metrics for an empty frame', () => {
    expect(getFrameHeaderMetrics(null, null, 400, 32)).toEqual({
      left: 16,
      top: 13,
      height: 38,
      fontSize: 32,
      maxWidth: 376,
    });
  });

  describe('getFrameAccentMarkerColor', () => {
    it('uses a contrast-safe foreground for a white accent', () => {
      expect(getFrameAccentMarkerColor('#ffffff')).toBe('var(--fg-default)');
    });

    it('uses the neutral marker color when the Frame has no accent', () => {
      expect(getFrameAccentMarkerColor(null)).toBe('var(--fg-muted)');
    });
  });

  it('preserves title size when a Manual Frame lacks top inset', () => {
    expect(getFrameHeaderMetrics(200, 40, 80, 52)).toEqual({
      left: 32,
      top: 8,
      height: 62,
      fontSize: 52,
      maxWidth: 48,
    });
  });
});
