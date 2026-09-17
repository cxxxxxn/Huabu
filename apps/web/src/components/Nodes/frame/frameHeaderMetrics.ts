// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { FRAME_DESIGN_CONFIG } from '@huabu/shared/canvas-engine';

import { getAccentTokens } from '../accentTokens';

export interface FrameHeaderMetrics {
  left: number;
  top: number;
  height: number;
  fontSize: number;
  maxWidth: number;
}

export function getFrameAccentMarkerColor(accent: string | null): string {
  return accent ? getAccentTokens(accent).fg : 'var(--fg-muted)';
}

/**
 * Positions the title row within the padding above the first child without
 * changing its responsive font size. A Manual Frame may therefore expose
 * insufficient authored padding as overlap instead of silently shrinking type.
 */
export function getFrameHeaderMetrics(
  contentInsetX: number | null,
  contentInsetY: number | null,
  frameWidth: number,
  desiredFontSize: number,
): FrameHeaderMetrics {
  const config = FRAME_DESIGN_CONFIG.header;
  const availableTop =
    contentInsetY !== null && Number.isFinite(contentInsetY)
      ? Math.max(0, contentInsetY)
      : config.fallbackInsetY;
  const desiredLeft =
    contentInsetX !== null && Number.isFinite(contentInsetX)
      ? Math.max(0, contentInsetX)
      : config.fallbackInsetX;
  const fontSize = Math.round(Math.max(config.minFontSize, desiredFontSize));
  const height = Math.round(fontSize * config.lineHeight);
  const left = Math.min(
    Math.max(config.edgeInset, desiredLeft),
    Math.max(config.edgeInset, frameWidth - config.minWidth),
  );

  return {
    left,
    top: Math.round(
      Math.max(config.verticalPadding, (availableTop - height) / 2),
    ),
    height,
    fontSize,
    maxWidth: Math.max(config.minWidth, frameWidth - left - config.edgeInset),
  };
}
