// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';

import {
  getNodeDefaultSize,
  type NestableNode,
} from '@huabu/shared/canvas-engine';

import { computeAdjacentNodePlacement } from './nodePlacement';

const source = { x: 0, y: 0, width: 200, height: 100 };
const questionSize = getNodeDefaultSize('question');
const questionWidth = questionSize.width || 200;
const questionHeight = questionSize.height || 100;
const ideal = {
  x: source.x + source.width / 2 - questionWidth / 2,
  y: source.y + source.height + 80,
};

function obstacle(
  id: string,
  x: number,
  y: number,
  type = 'note',
): NestableNode {
  return {
    id,
    type,
    position: { x, y },
    style: { width: questionWidth, height: questionHeight },
    data: {},
  };
}

describe('computeAdjacentNodePlacement', () => {
  it('places a Question below and centred on unobstructed bounds', () => {
    expect(
      computeAdjacentNodePlacement({
        nodes: [],
        source,
        nodeType: 'question',
        side: 'bottom',
      }),
    ).toEqual(ideal);
  });

  it('uses the connected-node horizontal avoidance rule on collision', () => {
    expect(
      computeAdjacentNodePlacement({
        nodes: [obstacle('occupied', ideal.x, ideal.y)],
        source,
        nodeType: 'question',
        side: 'bottom',
      }),
    ).toEqual({
      x: ideal.x + questionWidth + 24,
      y: ideal.y,
    });
  });

  it('does not treat Frames as placement obstacles', () => {
    expect(
      computeAdjacentNodePlacement({
        nodes: [obstacle('frame-1', ideal.x, ideal.y, 'frame')],
        source,
        nodeType: 'question',
        side: 'bottom',
      }),
    ).toEqual(ideal);
  });
});
