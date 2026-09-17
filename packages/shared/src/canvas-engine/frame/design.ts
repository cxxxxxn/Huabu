// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export interface FrameResponsiveMetrics {
  titleFontSize: number;
  headerInset: number;
  borderRadius: number;
  contentSpacing: number;
}

export type FrameResponsiveTier = 'compact' | 'regular' | 'large';

interface FrameDesignConfig {
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
  header: {
    fallbackInsetX: number;
    fallbackInsetY: number;
    minFontSize: number;
    minWidth: number;
    lineHeight: number;
    verticalPadding: number;
    edgeInset: number;
    gapRatio: number;
    minGap: number;
    markerSizeRatio: number;
  };
  instructionBadge: {
    fontRatio: number;
    minFontSize: number;
    maxFontSize: number;
    heightRatio: number;
    paddingInlineRatio: number;
  };
}

/**
 * Canonical Frame layout and visual scale.
 *
 * Other node types may reuse individual ratios or tier values as references,
 * but should not import Frame semantics such as the title inset unless they
 * are also containers with an internal header.
 */
export const FRAME_DESIGN_CONFIG = {
  query: {
    fallbackWidth: 1200,
    fallbackHeight: 900,
    maxAspectRatioContribution: 2,
  },
  tiers: [
    {
      id: 'compact',
      maxEffectiveSize: 900,
      titleFontSize: 24,
      headerInset: 56,
      borderRadius: 16,
      contentSpacing: 20,
    },
    {
      id: 'regular',
      maxEffectiveSize: 1800,
      titleFontSize: 36,
      headerInset: 80,
      borderRadius: 24,
      contentSpacing: 28,
    },
    {
      id: 'large',
      maxEffectiveSize: Number.POSITIVE_INFINITY,
      titleFontSize: 64,
      headerInset: 128,
      borderRadius: 32,
      contentSpacing: 40,
    },
  ],
  header: {
    fallbackInsetX: 16,
    fallbackInsetY: 64,
    minFontSize: 12,
    minWidth: 48,
    lineHeight: 1.2,
    verticalPadding: 8,
    edgeInset: 8,
    gapRatio: 0.4,
    minGap: 4,
    markerSizeRatio: 0.42,
  },
  instructionBadge: {
    fontRatio: 0.42,
    minFontSize: 12,
    maxFontSize: 20,
    heightRatio: 1.8,
    paddingInlineRatio: 0.65,
  },
} as const satisfies FrameDesignConfig;

/**
 * Select Frame visual tokens from its own bounded geometric mean. The longer
 * side contributes only up to the configured aspect-ratio cap, so a genuinely
 * larger container can advance while an extreme strip cannot inflate the
 * visual hierarchy indefinitely.
 */
export function frameResponsiveMetricsForSize(
  frameWidth: number,
  frameHeight: number,
): FrameResponsiveMetrics {
  const { query, tiers } = FRAME_DESIGN_CONFIG;
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

  return {
    titleFontSize: tier.titleFontSize,
    headerInset: tier.headerInset,
    borderRadius: tier.borderRadius,
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
  for (const metrics of FRAME_DESIGN_CONFIG.tiers) {
    result = layout({
      titleFontSize: metrics.titleFontSize,
      headerInset: metrics.headerInset,
      contentSpacing: metrics.contentSpacing,
      borderRadius: metrics.borderRadius,
    });
    const actual = frameResponsiveMetricsForSize(
      result.frameSize.width,
      result.frameSize.height,
    );
    if (
      actual.titleFontSize === metrics.titleFontSize &&
      actual.headerInset === metrics.headerInset &&
      actual.contentSpacing === metrics.contentSpacing &&
      actual.borderRadius === metrics.borderRadius
    )
      return result;
  }
  if (!result) throw new Error('Frame design must define at least one tier');
  return result;
}
