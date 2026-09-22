// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export interface FrameResponsiveMetrics {
  headerInset: number;
  contentSpacing: number;
}

export type FrameResponsiveTier = 'compact' | 'regular' | 'large';

interface FrameLayoutConfig {
  query: {
    fallbackWidth: number;
    fallbackHeight: number;
    maxAspectRatioContribution: number;
  };
  tiers: ReadonlyArray<
    FrameResponsiveMetrics & {
      id: FrameResponsiveTier;
      maxEffectiveSize: number;
    }
  >;
}

/**
 * Frame geometry shared by browser gestures and server-side commands.
 */
export const FRAME_LAYOUT_CONFIG = {
  query: {
    fallbackWidth: 1200,
    fallbackHeight: 900,
    maxAspectRatioContribution: 2,
  },
  tiers: [
    {
      id: 'compact',
      maxEffectiveSize: 900,
      headerInset: 64,
      contentSpacing: 20,
    },
    {
      id: 'regular',
      maxEffectiveSize: 1800,
      headerInset: 96,
      contentSpacing: 28,
    },
    {
      id: 'large',
      maxEffectiveSize: Number.POSITIVE_INFINITY,
      headerInset: 152,
      contentSpacing: 40,
    },
  ],
} as const satisfies FrameLayoutConfig;

// Persisted creation default, also used when rendering legacy missing accents.
export const FRAME_DEFAULT_ACCENT = 'white';

export function frameAccentToken(accent: string | null | undefined): string {
  return accent || FRAME_DEFAULT_ACCENT;
}

/**
 * Select Frame visual tokens from its own bounded geometric mean. The longer
 * side contributes only up to the configured aspect-ratio cap, so a genuinely
 * larger container can advance while an extreme strip cannot inflate the
 * visual hierarchy indefinitely.
 */
function frameLayoutTierForSize(frameWidth: number, frameHeight: number) {
  const { query, tiers } = FRAME_LAYOUT_CONFIG;
  const safeWidth =
    Number.isFinite(frameWidth) && frameWidth > 0
      ? frameWidth
      : query.fallbackWidth;
  const safeHeight =
    Number.isFinite(frameHeight) && frameHeight > 0
      ? frameHeight
      : query.fallbackHeight;
  const shortSide = Math.min(safeWidth, safeHeight);
  const longSide = Math.max(safeWidth, safeHeight);
  const effectiveSize = Math.sqrt(
    shortSide *
      Math.min(longSide, shortSide * query.maxAspectRatioContribution),
  );
  const tier =
    tiers.find(({ maxEffectiveSize }) => effectiveSize < maxEffectiveSize) ??
    tiers[tiers.length - 1];

  return tier;
}

export function frameResponsiveTierForSize(
  width: number,
  height: number,
): FrameResponsiveTier {
  return frameLayoutTierForSize(width, height).id;
}

export function frameResponsiveMetricsForSize(
  width: number,
  height: number,
): FrameResponsiveMetrics {
  const tier = frameLayoutTierForSize(width, height);
  return {
    headerInset: tier.headerInset,
    contentSpacing: tier.contentSpacing,
  };
}

/**
 * Resolve the same container-query tier while a Hug Frame's final box is
 * still being computed from its content bounds.
 */
export function frameResponsiveMetricsForContentSize(
  contentWidth: number,
  contentHeight: number,
  minFrameWidth = 0,
  minFrameHeight = 0,
): FrameResponsiveMetrics {
  return resolveFrameResponsiveLayout((metrics) => ({
    metrics,
    frameSize: {
      width: Math.max(minFrameWidth, contentWidth + metrics.contentSpacing * 2),
      height: Math.max(
        minFrameHeight,
        contentHeight + metrics.headerInset + metrics.contentSpacing,
      ),
    },
  })).metrics;
}

/**
 * Find the smallest self-consistent tier for a content-derived box. Insets
 * increase monotonically, so checking each tier is bounded and independent
 * of previous geometry. The callback's dimensions must not decrease as the
 * insets grow.
 */
export function resolveFrameResponsiveLayout<
  T extends { frameSize: { width: number; height: number } },
>(layout: (metrics: FrameResponsiveMetrics) => T): T {
  let result: T | undefined;
  for (const metrics of FRAME_LAYOUT_CONFIG.tiers) {
    result = layout({
      headerInset: metrics.headerInset,
      contentSpacing: metrics.contentSpacing,
    });
    const actual = frameResponsiveMetricsForSize(
      result.frameSize.width,
      result.frameSize.height,
    );
    if (
      actual.headerInset === metrics.headerInset &&
      actual.contentSpacing === metrics.contentSpacing
    )
      return result;
  }
  if (!result) throw new Error('Frame design must define at least one tier');
  return result;
}
