// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';

import {
  FRAME_LAYOUT_CONFIG,
  FRAME_DEFAULT_ACCENT,
  frameAccentToken,
  frameResponsiveMetricsForContentSize,
  frameResponsiveMetricsForSize,
} from '../design.js';

describe('Frame design config', () => {
  it('keeps the public scale explicit and configurable', () => {
    expect(FRAME_LAYOUT_CONFIG.tiers).toMatchObject([
      { id: 'compact', maxEffectiveSize: 900 },
      { id: 'regular', maxEffectiveSize: 1800 },
      { id: 'large', maxEffectiveSize: Number.POSITIVE_INFINITY },
    ]);
  });

  it('normalizes missing legacy accents to the canonical white default', () => {
    expect(FRAME_DEFAULT_ACCENT).toBe('white');
    expect(frameAccentToken(null)).toBe('white');
    expect(frameAccentToken(undefined)).toBe('white');
    expect(frameAccentToken('purple')).toBe('purple');
  });

  it.each([
    [
      600,
      1800,
      {
        headerInset: 64,
        contentSpacing: 20,
      },
    ],
    [
      1380,
      876,
      {
        headerInset: 96,
        contentSpacing: 28,
      },
    ],
    [
      2400,
      1800,
      {
        headerInset: 152,
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
      headerInset: 96,
      contentSpacing: 28,
    });
  });

  it('resolves a Hug Frame tier from its final content-driven box', () => {
    expect(frameResponsiveMetricsForContentSize(1000, 650)).toEqual({
      headerInset: 64,
      contentSpacing: 20,
    });
  });

  it('caps the contribution of an extreme aspect ratio', () => {
    expect(frameResponsiveMetricsForSize(5000, 600)).toEqual({
      headerInset: 64,
      contentSpacing: 20,
    });
  });
});
