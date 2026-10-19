// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it, vi } from 'vitest';

import { executeCanvasCommands } from '../../index.js';
import {
  detectInkHash,
  getInkSigilStrokes,
  inkSigilFingerprint,
  inkSigilLayout,
  projectInkResourceBindings,
  selectedInkResourceReferences,
} from '../inkSigil.js';

import type { InkResourceBinding } from '../../../types/api/ink-sigil.js';
import type {
  CanvasCommand,
  CanvasNodeId,
} from '../../../types/canvas/index.js';
import type { Node } from '@xyflow/react';

it('lays out two-line labels at 288px and includes their entire height in grounding', () => {
  const bounds = { x: 100, y: 80, width: 40, height: 40 };
  const initial = inkSigilLayout(bounds);
  expect(initial.labelWidth).toBe(288);
  expect(initial.labelX).toBe(148);
  expect(initial.fontSize).toBeCloseTo(32.8);
  const wrapped = inkSigilLayout(bounds, 288, initial.fontSize * 1.1 * 2);
  expect(wrapped.labelY).toBe(initial.labelY);
  expect(wrapped.semanticBounds.width).toBe(336);
  expect(wrapped.semanticBounds.y + wrapped.semanticBounds.height).toBeCloseTo(
    wrapped.labelY + wrapped.labelHeight,
  );
  expect(inkSigilLayout({ ...bounds, height: 1 }).fontSize).toBe(16);
  expect(inkSigilLayout({ ...bounds, height: 100 }).fontSize).toBe(34);
});

const points = [
  [
    [10, 0],
    [10, 40],
  ],
  [
    [30, 0],
    [30, 40],
  ],
  [
    [0, 10],
    [40, 10],
  ],
  [
    [0, 30],
    [40, 30],
  ],
];
function sketch(): Node {
  return {
    id: 'ink',
    type: 'sketch',
    position: { x: 100, y: 80 },
    style: { width: 40, height: 40 },
    data: {
      initialSize: { width: 40, height: 40 },
      strokes: points.map((line, index) => ({
        id: `s${index}`,
        points: structuredClone(line),
        color: 'black',
        size: 2,
        createdAt: index * 500,
      })),
    },
  };
}
function boundNodes() {
  const ink = sketch();
  const sources = getInkSigilStrokes([ink]);
  const binding: InkResourceBinding = {
    id: 'binding',
    strokeIds: sources.map((s) => s.stroke.id),
    fingerprint: inkSigilFingerprint(sources),
    targetNodeId: 'pdf',
    targetType: 'pdf',
    label: 'Paper',
  };
  sources[0].stroke.resourceBinding = binding;
  return [
    ink,
    {
      id: 'pdf',
      type: 'pdf',
      position: { x: 9000, y: 0 },
      data: { label: 'Paper' },
    },
  ];
}

describe('hash geometry', () => {
  it('uses actual polylines rather than their endpoint chords', () => {
    const sources = getInkSigilStrokes([sketch()]);
    sources[2].points = [
      [100, 78],
      [120, 85],
      [140, 78],
    ];
    expect(detectInkHash(sources)).toBe(true);
    sources[2].points = [
      [100, 90],
      [109, 79],
      [131, 79],
      [140, 90],
    ];
    expect(detectInkHash(sources)).toBe(false);
  });
  it('matches the reference endpoint-intersection and pair-direction rules', () => {
    const sources = getInkSigilStrokes([sketch()]);
    sources[2].points = [
      [100, 80],
      [140, 80],
    ];
    expect(detectInkHash(sources)).toBe(true);
    sources[2].points = [
      [100, 80],
      [140, 103],
    ];
    sources[3].points = [
      [100, 120],
      [140, 97],
    ];
    expect(detectInkHash(sources)).toBe(false);
  });
  it('recognizes both pair orders and reversed pen directions', () => {
    const sources = getInkSigilStrokes([sketch()]);
    expect(detectInkHash(sources)).toBe(true);
    expect(detectInkHash([...sources.slice(2), ...sources.slice(0, 2)])).toBe(
      true,
    );
    expect(
      detectInkHash(
        sources.map((s) => ({ ...s, points: [...s.points].reverse() })),
      ),
    ).toBe(true);
    expect(detectInkHash(sources.slice(0, 2))).toBe(false);
  });
  it('rejects missing intersections, curves and slow grids', () => {
    const sources = getInkSigilStrokes([sketch()]);
    sources[3].points = [
      [100, 110],
      [120, 110],
    ];
    expect(detectInkHash(sources)).toBe(false);
    const curved = getInkSigilStrokes([sketch()]);
    curved[0].points.splice(1, 0, [135, 100]);
    expect(detectInkHash(curved)).toBe(false);
    const slow = getInkSigilStrokes([sketch()]);
    slow[3].stroke.createdAt = 4001;
    expect(detectInkHash(slow)).toBe(false);
  });
});

describe('resource binding identity', () => {
  it.each(['CREATE_NODES', 'MERGE_NODE_DATA'] as const)(
    'rejects malformed binding writes through %s without changing existing Ink',
    (type) => {
      const nodes = boundNodes();
      const stroke = getInkSigilStrokes(nodes)[0].stroke;
      const malformedData: Record<string, unknown> = {
        strokes: [{ ...stroke, resourceBinding: { strokeIds: 42 } }],
      };
      const command: CanvasCommand =
        type === 'CREATE_NODES'
          ? {
              type,
              nodes: [
                {
                  nodeType: 'sketch',
                  position: { x: 0, y: 0 },
                  data: malformedData,
                },
              ],
            }
          : {
              type,
              patches: [
                { nodeId: 'ink' as CanvasNodeId, patch: malformedData },
              ],
            };
      const result = executeCanvasCommands(
        { source: 'ui', commands: [command] },
        { nodes, edges: [], canvasId: 'space' },
      );
      expect(result.commandResults[0]).toMatchObject({
        applied: false,
        reason: 'invalid-target',
      });
      expect(result.writeResult.nodes).toEqual(nodes);
    },
  );

  it('accepts well-formed metadata and permits unrelated updates to legacy malformed Ink', () => {
    const nodes = boundNodes();
    const strokes = getInkSigilStrokes(nodes).map((source) => source.stroke);
    const valid = executeCanvasCommands(
      {
        source: 'ui',
        commands: [
          {
            type: 'MERGE_NODE_DATA',
            patches: [{ nodeId: 'ink' as CanvasNodeId, patch: { strokes } }],
          },
        ],
      },
      { nodes, edges: [], canvasId: 'space' },
    );
    expect(valid.commandResults[0].applied).toBe(true);
    nodes[0].data.strokes = [
      { ...strokes[0], resourceBinding: { strokeIds: 42 } },
    ];
    const renamed = executeCanvasCommands(
      {
        source: 'ui',
        commands: [
          {
            type: 'MERGE_NODE_DATA',
            patches: [
              { nodeId: 'ink' as CanvasNodeId, patch: { label: 'Renamed' } },
            ],
          },
        ],
      },
      { nodes, edges: [], canvasId: 'space' },
    );
    expect(renamed.commandResults[0].applied).toBe(true);
    expect(renamed.writeResult.nodes[0].data.strokes).toEqual(
      nodes[0].data.strokes,
    );
  });

  it.each([
    null,
    42,
    'binding',
    {},
    { strokeIds: 42 },
    { strokeIds: 's0' },
    { strokeIds: [null, 's1', 's2', 's3'] },
  ])(
    'reports malformed persisted bindings without crashing or mutating Ink: %j',
    (binding) => {
      const nodes = boundNodes();
      const broken = sketch();
      broken.id = 'bad-ink';
      broken.data.strokes = [
        {
          ...getInkSigilStrokes([broken])[0].stroke,
          id: 'bad-stroke',
          resourceBinding: binding,
        },
      ];
      nodes.push(broken);
      const original = structuredClone(nodes);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        expect(projectInkResourceBindings(nodes)).toHaveLength(1);
        expect(warn).toHaveBeenCalledWith(
          '[ink-sigil] Ignoring malformed persisted resource binding',
          { nodeId: 'bad-ink', strokeId: 'bad-stroke' },
        );
        expect(nodes).toEqual(original);
      } finally {
        warn.mockRestore();
      }
    },
  );

  it('preserves complete moves, uniform scale and region rebasing', () => {
    const nodes = boundNodes();
    nodes[0].position = { x: 200, y: 600 };
    nodes[0].style = { width: 80, height: 80 };
    expect(projectInkResourceBindings(nodes)[0].sourceValid).toBe(true);
    const sources = getInkSigilStrokes(nodes);
    nodes[0].data.initialSize = { width: 80, height: 80 };
    nodes[0].data.strokes = sources.map((s) => ({
      ...s.stroke,
      points: s.points.map(([x, y]) => [x - 200, y - 600]),
    }));
    expect(projectInkResourceBindings(nodes)[0].sourceValid).toBe(true);
  });
  it('requires all strokes but not target visibility or Lasso membership', () => {
    const projections = projectInkResourceBindings(boundNodes());
    expect(
      selectedInkResourceReferences(projections, { ink: ['s0', 's1'] }),
    ).toMatchObject({ references: [], partialCount: 1 });
    const selected = selectedInkResourceReferences(projections, {
      ink: ['s0', 's1', 's2', 's3'],
    });
    expect(selected.references).toHaveLength(1);
    expect(selected.references[0].targetNodeId).toBe('pdf');
  });
  it('keeps broken targets explicit and invalidates partial source edits', () => {
    const nodes = boundNodes();
    const selection = { ink: ['s0', 's1', 's2', 's3'] };
    expect(
      selectedInkResourceReferences(
        projectInkResourceBindings(nodes.slice(0, 1)),
        selection,
      ).brokenCount,
    ).toBe(1);
    const sources = getInkSigilStrokes(nodes);
    sources[1].stroke.points[0][0] += 5;
    expect(projectInkResourceBindings(nodes)[0].sourceValid).toBe(false);
  });
});
