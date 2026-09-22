// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';

import {
  badgeSizeForNode,
  collapsedMarkSize,
  collapseProgress,
  resolveLegacyQuestionStage,
} from './legacyQuestionTakeover';

describe('archived playground takeover geometry', () => {
  it('preserves screen-space badge clamps and collapse interpolation', () => {
    expect(badgeSizeForNode(400, 220)).toBeCloseTo(61.6);
    expect(badgeSizeForNode(20, 11)).toBe(30);
    expect(badgeSizeForNode(1000, 1000)).toBe(84);
    expect(collapsedMarkSize(0, 0)).toBe(6);
    expect(collapsedMarkSize(400, 220)).toBe(30);
    expect(collapseProgress(100)).toBe(0);
    expect(collapseProgress(44)).toBe(0.5);
    expect(collapseProgress(10)).toBe(1);
  });

  it('retains width-based hysteresis independently of production zoom policy', () => {
    expect(resolveLegacyQuestionStage('readable', 58)).toBe('readable');
    expect(resolveLegacyQuestionStage('readable', 57)).toBe('collapsed');
    expect(resolveLegacyQuestionStage('collapsed', 69)).toBe('collapsed');
    expect(resolveLegacyQuestionStage('collapsed', 70)).toBe('readable');
  });
});
