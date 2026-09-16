// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';

import { getGroupRoutingDirections } from '../edgeRoutingGroups.js';

import type { RoutingRect } from '../edgeRoutingGroups.js';

function rect(x: number, y: number, w = 100, h = 100): RoutingRect {
  return { x, y, w, h };
}

describe('local routing group evidence', () => {
  it.each([0, 0.5, 1])(
    'accepts unequal sizes aligned at fraction %s',
    (alignment) => {
      const nodes = new Map([
        ['hub', rect(400, 0)],
        ['a', rect(0, 400 - 50 * alignment, 100, 50)],
        ['b', rect(800, 400 - 150 * alignment, 100, 150)],
      ]);
      const edges = ['a', 'b'].map((target) => ({ source: 'hub', target }));
      expect([...getGroupRoutingDirections(nodes, edges).values()]).toEqual([
        'down',
        'down',
      ]);
    },
  );

  it('does not let duplicate or reverse edges manufacture a group', () => {
    const nodes = new Map([
      ['hub', rect(0, 0)],
      ['a', rect(500, 300)],
    ]);
    const edges = [
      { source: 'hub', target: 'a' },
      { source: 'hub', target: 'a' },
      { source: 'a', target: 'hub' },
      { source: 'hub', target: 'hub' },
      { source: 'hub', target: 'missing' },
    ];
    expect(getGroupRoutingDirections(nodes, edges).size).toBe(0);
  });

  it('does not mistake overlapping cards for a row', () => {
    const nodes = new Map([
      ['hub', rect(400, 0)],
      ['a', rect(0, 300, 900)],
      ['b', rect(500, 310)],
    ]);
    expect(
      getGroupRoutingDirections(nodes, [
        { source: 'hub', target: 'a' },
        { source: 'hub', target: 'b' },
      ]).size,
    ).toBe(0);
  });

  it('does not chain a staggered staircase into one band', () => {
    const nodes = new Map([
      ['hub', rect(400, 0)],
      ['a', rect(0, 300)],
      ['b', rect(250, 320)],
      ['c', rect(500, 340)],
    ]);
    const edges = ['a', 'b', 'c'].map((target) => ({ source: 'hub', target }));
    const result = getGroupRoutingDirections(nodes, edges);
    expect(result.get(edges[0])).toBe('down');
    expect(result.get(edges[1])).toBe('down');
    expect(result.has(edges[2])).toBe(false);
  });

  it('falls back when both endpoints provide equally strong conflicting axes', () => {
    const nodes = new Map([
      ['a', rect(0, 0)],
      ['b', rect(400, 300)],
      ['c', rect(800, 300)],
      ['d', rect(0, 600)],
    ]);
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'd', target: 'b' },
    ];
    const result = getGroupRoutingDirections(nodes, edges);
    expect(result.has(edges[0])).toBe(false);
    expect(result.get(edges[1])).toBe('down');
    expect(result.get(edges[2])).toBe('right');
  });

  it('does not infer a group from mere interval overlap with a tall card', () => {
    const nodes = new Map([
      ['hub', rect(300, 0)],
      ['a', rect(0, 300, 100, 1000)],
      ['b', rect(500, 500)],
      ['c', rect(800, 900)],
    ]);
    const edges = ['a', 'b', 'c'].map((target) => ({ source: 'hub', target }));
    expect(getGroupRoutingDirections(nodes, edges).size).toBe(0);
  });

  it('retains weak evidence per edge without depending on parallel-edge order', () => {
    const nodes = new Map([
      ['hub', rect(400, 0)],
      ['a', rect(0, 300)],
      ['b', rect(800, 330)],
    ]);
    const edges = [
      {
        source: 'hub',
        target: 'a',
        sourceHandle: 'bottom-source',
        targetHandle: 'top-target',
      },
      {
        source: 'hub',
        target: 'b',
        sourceHandle: 'bottom-source',
        targetHandle: 'top-target',
      },
      {
        source: 'b',
        target: 'hub',
        sourceHandle: 'left-source',
        targetHandle: 'right-target',
      },
    ];
    const result = getGroupRoutingDirections(nodes, edges);
    expect(result.get(edges[0])).toBe('down');
    expect(result.get(edges[1])).toBe('down');
    expect(result.has(edges[2])).toBe(false);
    expect(getGroupRoutingDirections(nodes, [...edges].reverse())).toEqual(
      result,
    );
  });
});
