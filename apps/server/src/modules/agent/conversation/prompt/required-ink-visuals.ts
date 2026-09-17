// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export class InkVisualPreparationError extends Error {
  readonly code = 'ink_visual_unavailable';
  readonly cause?: unknown;

  constructor(
    readonly nodeIds: readonly string[],
    options?: { cause?: unknown },
  ) {
    super(
      'The selected Ink could not be prepared as image input. Select the strokes again and retry.',
    );
    this.name = 'InkVisualPreparationError';
    this.cause = options?.cause;
  }
}
