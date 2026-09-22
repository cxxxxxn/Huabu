// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';

import { connectionAnchor, resizeSpecimen } from './selectionFrameGeometry';

describe('selection frame proposal geometry', () => {
  const box = { x: 50, y: 60, width: 280, height: 180 };
  it.each(['tl', 'tr', 'bl', 'br'] as const)(
    'keeps image aspect and opposite anchor at %s',
    (handle) => {
      const result = resizeSpecimen(box, handle, 80, 30, 'image');
      expect(result.width / result.height).toBeCloseTo(box.width / box.height);
      expect(
        handle.endsWith('l') ? result.x + result.width : result.x,
      ).toBeCloseTo(handle.endsWith('l') ? box.x + box.width : box.x);
      expect(
        handle.startsWith('t') ? result.y + result.height : result.y,
      ).toBeCloseTo(handle.startsWith('t') ? box.y + box.height : box.y);
    },
  );
  it('changes text width without choosing font size or imposing height', () => {
    expect(resizeSpecimen(box, 'left', -60, 90, 'text')).toEqual({
      x: -10,
      y: 60,
      width: 340,
      height: 180,
    });
  });
  it('allows independent card axes and prevents flipping', () => {
    expect(resizeSpecimen(box, 'br', 80, 20, 'card')).toEqual({
      ...box,
      width: 360,
      height: 200,
    });
    expect(resizeSpecimen(box, 'br', -999, -999, 'card')).toMatchObject({
      width: 140,
      height: 100,
    });
  });
  it('routes from the boundary toward the target, not the fixed right control', () => {
    expect(connectionAnchor(box, { x: -100, y: 150 })).toEqual({
      x: 50,
      y: 150,
    });
    expect(connectionAnchor(box, { x: 190, y: 500 })).toEqual({
      x: 190,
      y: 240,
    });
  });
});
