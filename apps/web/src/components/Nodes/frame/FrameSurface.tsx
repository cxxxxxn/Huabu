// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { forwardRef } from 'react';

import { FRAME_DESIGN_CONFIG } from '@huabu/shared/canvas-engine';

import { cn } from '@/components/Common/cn';
import { getAccentTokens } from '@/components/Nodes/accentTokens';

import type { ComponentPropsWithoutRef } from 'react';

export interface FrameSurfaceProps extends ComponentPropsWithoutRef<'div'> {
  accent: string | null;
  borderRadius?: number;
}

/**
 * Store-free Frame shell shared by the canvas node and visual playgrounds.
 */
export const FrameSurface = forwardRef<HTMLDivElement, FrameSurfaceProps>(
  ({ accent, borderRadius, className, style, ...props }, ref) => {
    const accentTokens = accent ? getAccentTokens(accent) : null;
    const resolvedBorderRadius =
      borderRadius ?? FRAME_DESIGN_CONFIG.tiers[1].borderRadius;

    return (
      <div
        ref={ref}
        className={cn('border-edge-default bg-surface border-3', className)}
        style={{
          borderRadius: resolvedBorderRadius,
          ...(accentTokens
            ? {
                backgroundColor: accentTokens.bg,
                borderColor: accentTokens.divider,
              }
            : {}),
          ...style,
        }}
        {...props}
      />
    );
  },
);

FrameSurface.displayName = 'FrameSurface';
