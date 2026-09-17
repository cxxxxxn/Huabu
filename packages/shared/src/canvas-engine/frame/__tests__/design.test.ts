// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';

import {
  FRAME_DESIGN_CONFIG,
  frameResponsiveMetricsForContentSize,
  frameResponsiveMetricsForSize,
} from '../design.js';

describe('Frame design config', () => {
  it('keeps the public scale explicit and configurable', () => {
    expect(FRAME_DESIGN_CONFIG.tiers).toMatchObject([
      { id: 'compact', maxEffectiveSize: 900 },
      { id: 'regular', maxEffectiveSize: 1800 },
      { id: 'large', maxEffectiveSize: Number.POSITIVE_INFINITY },
    ]);
  });

  it.each([
    [
      600,
      1800,
      {
        titleFontSize: 24,
        headerInset: 56,
        borderRadius: 16,
        contentSpacing: 20,
      },
    ],
    [
      1380,
      876,
      {
        titleFontSize: 36,
        headerInset: 80,
        borderRadius: 24,
        contentSpacing: 28,
      },
    ],
    [
      2400,
      1800,
      {
        titleFontSize: 64,
        headerInset: 128,
        borderRadius: 32,
        contentSpacing: 40,
      },
    ],
  ])(
    'selects responsive tokens for a %spx by %spx Frame',
    (width, height, expected) => {
      expect(frameResponsiveMetricsForSize(width, height)).toEqual(expected);
    },
  );

  it('uses the regular configuration when dimensions are unavailable', () => {
    expect(frameResponsiveMetricsForSize(0, 0)).toEqual({
      titleFontSize: 36,
      headerInset: 80,
      borderRadius: 24,
      contentSpacing: 28,
    });
  });

  it('resolves a Hug Frame tier from its final content-driven box', () => {
    expect(frameResponsiveMetricsForContentSize(1000, 650)).toEqual({
      titleFontSize: 24,
      headerInset: 56,
      borderRadius: 16,
      contentSpacing: 20,
    });
  });

  it('caps the contribution of an extreme aspect ratio', () => {
    expect(frameResponsiveMetricsForSize(5000, 600)).toEqual({
      titleFontSize: 24,
      headerInset: 56,
      borderRadius: 16,
      contentSpacing: 20,
    });
  });
});
