// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';

import { ACCENT_NONE_TOKEN } from '@huabu/shared';

import { nodeAccentPickerOptions } from './nodeAccentPickerOptions';

describe('nodeAccentPickerOptions', () => {
  it('omits the transparent sentinel for a Frame', () => {
    const options = nodeAccentPickerOptions(['frame']);

    expect(options).not.toContainEqual(
      expect.objectContaining({ token: ACCENT_NONE_TOKEN }),
    );
    expect(options).toContainEqual(expect.objectContaining({ token: 'white' }));
  });

  it('omits the transparent sentinel from selections containing a Frame', () => {
    expect(nodeAccentPickerOptions(['frame', 'note'])).not.toContainEqual(
      expect.objectContaining({ token: ACCENT_NONE_TOKEN }),
    );
  });

  it('preserves the transparent sentinel for supported node types', () => {
    expect(nodeAccentPickerOptions(['text'])).toContainEqual(
      expect.objectContaining({ token: ACCENT_NONE_TOKEN }),
    );
  });
});
