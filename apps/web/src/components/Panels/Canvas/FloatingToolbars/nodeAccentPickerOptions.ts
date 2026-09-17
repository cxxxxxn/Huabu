// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  ACCENT_PALETTE,
  ACCENT_PICKER_OPTIONS_WITH_TRANSPARENT,
  type ColorPickerOption,
} from '@huabu/shared';

/**
 * Frames always render a structural surface, so a transparent swatch would
 * promise a result the renderer deliberately does not produce.
 */
export function nodeAccentPickerOptions(
  nodeTypes: readonly (string | undefined)[],
): readonly ColorPickerOption[] {
  return nodeTypes.includes('frame')
    ? ACCENT_PALETTE
    : ACCENT_PICKER_OPTIONS_WITH_TRANSPARENT;
}
