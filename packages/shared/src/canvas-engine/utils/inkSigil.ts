// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { getSketchRenderedSize } from './nodeSizes.js';
import { getAbsolutePosition } from '../frame/index.js';

import type { ChatAttachment } from '../../types/agent/chat.js';
import type { WireSelectionNode } from '../../types/api/agent.js';
import type {
  InkResourceBinding,
  InkResourceReference,
  InkResourceType,
} from '../../types/api/ink-sigil.js';
import type { SketchStroke } from '../../types/canvas/node.js';
import type { Node } from '@xyflow/react';

export const INK_SIGIL_QUIET_MS = 400;
export const INK_SIGIL_WINDOW_MS = 4000;
export const MAX_INK_RESOURCE_REFERENCES = 32;
export const INK_SIGIL_LABEL_MAX_WIDTH = 288;
export const INK_SIGIL_LABEL_LINE_HEIGHT = 1.1;

export interface InkSigilBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InkSigilStroke {
  nodeId: string;
  stroke: SketchStroke;
  points: number[][];
}

export interface InkSigilProjection {
  binding: InkResourceBinding;
  sources: InkSigilStroke[];
  bounds: InkSigilBounds;
  target?: Node;
  label: string;
  sourceValid: boolean;
}

export function isInkResourceType(type: unknown): type is InkResourceType {
  return (
    type === 'pdf' ||
    type === 'web' ||
    type === 'image' ||
    type === 'note' ||
    type === 'text'
  );
}

/** Runtime guard for persisted metadata; the Canvas engine must remain zod-free. */
export function isInkResourceBinding(
  value: unknown,
): value is InkResourceBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  const identity = (field: unknown): field is string =>
    typeof field === 'string' && field.length > 0 && field.length <= 200;
  return (
    Object.keys(binding).every((key) =>
      [
        'id',
        'fingerprint',
        'targetNodeId',
        'targetType',
        'label',
        'strokeIds',
      ].includes(key),
    ) &&
    identity(binding.id) &&
    typeof binding.fingerprint === 'string' &&
    /^[0-9a-f]{16}$/.test(binding.fingerprint) &&
    identity(binding.targetNodeId) &&
    isInkResourceType(binding.targetType) &&
    identity(binding.label) &&
    Array.isArray(binding.strokeIds) &&
    binding.strokeIds.length === 4 &&
    binding.strokeIds.every(identity) &&
    new Set(binding.strokeIds).size === 4
  );
}

export function hasValidInkResourceBindings(
  data: Record<string, unknown>,
): boolean {
  if (data.strokes === undefined) return true;
  return (
    Array.isArray(data.strokes) &&
    data.strokes.every(
      (stroke: unknown) =>
        !!stroke &&
        typeof stroke === 'object' &&
        !Array.isArray(stroke) &&
        (!('resourceBinding' in stroke) ||
          stroke.resourceBinding === undefined ||
          isInkResourceBinding(stroke.resourceBinding)),
    )
  );
}

export function inkResourceLabel(node: Node): string {
  const label = node.data.label;
  return typeof label === 'string' && label.trim()
    ? label.trim().slice(0, 200)
    : (node.type ?? 'resource');
}

export function getInkSigilStrokes(
  nodes: Node[],
  ids?: ReadonlySet<string>,
): InkSigilStroke[] {
  const result: InkSigilStroke[] = [];
  for (const node of nodes) {
    if (node.type !== 'sketch' || !Array.isArray(node.data.strokes)) continue;
    const data = node.data as {
      strokes: SketchStroke[];
      initialSize?: { width: number; height: number };
    };
    const strokes = ids
      ? data.strokes.filter((stroke) => ids.has(stroke.id))
      : data.strokes;
    if (strokes.length === 0) continue;
    const size = getSketchRenderedSize(node);
    const sx = data.initialSize?.width
      ? size.width / data.initialSize.width
      : 1;
    const sy = data.initialSize?.height
      ? size.height / data.initialSize.height
      : 1;
    const origin = getAbsolutePosition(nodes, node.id) ?? node.position;
    for (const stroke of strokes) {
      result.push({
        nodeId: node.id,
        stroke,
        points: stroke.points.map(([x, y]) => [
          origin.x + x * sx,
          origin.y + y * sy,
        ]),
      });
    }
  }
  return result;
}

export function inkSigilBounds(
  strokes: readonly InkSigilStroke[],
): InkSigilBounds {
  let x = Infinity;
  let y = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const stroke of strokes) {
    for (const point of stroke.points) {
      x = Math.min(x, point[0]);
      y = Math.min(y, point[1]);
      right = Math.max(right, point[0]);
      bottom = Math.max(bottom, point[1]);
    }
  }
  return { x, y, width: right - x, height: bottom - y };
}

/** Translation/uniform-scale invariant; detects partial edits and ownership-safe rebasing. */
export function inkSigilFingerprint(
  strokes: readonly InkSigilStroke[],
): string {
  const bounds = inkSigilBounds(strokes);
  const scale = Math.max(bounds.width, bounds.height, 1e-6);
  let first = 2166136261;
  let second = 3339675911;
  const mix = (value: number) => {
    first = Math.imul(first ^ value, 16777619);
    second = Math.imul(second ^ value, 2246822519);
  };
  for (const stroke of strokes) {
    for (const char of stroke.stroke.id) mix(char.charCodeAt(0));
    mix(stroke.points.length);
    for (const [x, y] of stroke.points) {
      mix(Math.round(((x - bounds.x) / scale) * 10000));
      mix(Math.round(((y - bounds.y) / scale) * 10000));
    }
  }
  return [first, second]
    .map((value) => (value >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

function lineGeometry(source: InkSigilStroke) {
  const points = source.points;
  if (points.length < 2) return null;
  const start = points[0];
  const end = points[points.length - 1];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length < 7) return null;
  if (
    points.some(
      ([x, y]) =>
        Math.abs(dy * (x - start[0]) - dx * (y - start[1])) / length >
        length * 0.28,
    )
  )
    return null;
  const angle = Math.atan2(Math.abs(dy), Math.abs(dx));
  const horizontal = angle <= (Math.PI * 35) / 180;
  const vertical = Math.PI / 2 - angle <= (Math.PI * 35) / 180;
  if (!horizontal && !vertical) return null;
  return { points, length, horizontal, direction: Math.atan2(dy, dx) };
}

function intersects(
  a: NonNullable<ReturnType<typeof lineGeometry>>,
  b: NonNullable<ReturnType<typeof lineGeometry>>,
) {
  const cross = (p: number[], q: number[], r: number[]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const onSegment = (p: number[], q: number[], r: number[]) =>
    Math.abs(cross(p, q, r)) <= 1e-6 &&
    r[0] >= Math.min(p[0], q[0]) - 1e-6 &&
    r[0] <= Math.max(p[0], q[0]) + 1e-6 &&
    r[1] >= Math.min(p[1], q[1]) - 1e-6 &&
    r[1] <= Math.max(p[1], q[1]) + 1e-6;
  for (let i = 1; i < a.points.length; i++) {
    for (let j = 1; j < b.points.length; j++) {
      const [p, q, r, s] = [
        a.points[i - 1],
        a.points[i],
        b.points[j - 1],
        b.points[j],
      ];
      if (
        (cross(p, q, r) * cross(p, q, s) < 0 &&
          cross(r, s, p) * cross(r, s, q) < 0) ||
        onSegment(p, q, r) ||
        onSegment(p, q, s) ||
        onSegment(r, s, p) ||
        onSegment(r, s, q)
      )
        return true;
    }
  }
  return false;
}

/** Adapts Inkitiate's hash-only geometric checks to Canvas-space Sketch strokes. */
export function detectInkHash(strokes: readonly InkSigilStroke[]): boolean {
  if (
    strokes.length !== 4 ||
    new Set(strokes.map((s) => s.stroke.id)).size !== 4
  )
    return false;
  const times = strokes.map((s) => s.stroke.createdAt);
  if (Math.max(...times) - Math.min(...times) > INK_SIGIL_WINDOW_MS)
    return false;
  const lines = strokes.map(lineGeometry);
  if (lines.some((line) => !line)) return false;
  const horizontal = lines.filter((line) => line?.horizontal);
  const vertical = lines.filter((line) => line && !line.horizontal);
  if (horizontal.length !== 2 || vertical.length !== 2) return false;
  for (const pair of [horizontal, vertical]) {
    const [a, b] = pair;
    if (
      !a ||
      !b ||
      Math.max(a.length, b.length) / Math.min(a.length, b.length) > 2.5
    )
      return false;
    const delta = Math.abs(a.direction - b.direction) % Math.PI;
    if (Math.min(delta, Math.PI - delta) > (Math.PI * 25) / 180) return false;
  }
  return horizontal.every(
    (a) => a && vertical.every((b) => b && intersects(a, b)),
  );
}

export function projectInkResourceBindings(
  nodes: Node[],
): InkSigilProjection[] {
  const ids = new Set<string>();
  const bindings = new Map<SketchStroke, InkResourceBinding>();
  for (const node of nodes) {
    if (node.type !== 'sketch' || !Array.isArray(node.data.strokes)) continue;
    for (const stroke of node.data.strokes as SketchStroke[]) {
      const binding: unknown = stroke.resourceBinding;
      if (binding === undefined) continue;
      if (!isInkResourceBinding(binding)) {
        console.warn(
          '[ink-sigil] Ignoring malformed persisted resource binding',
          {
            nodeId: node.id,
            strokeId: stroke.id,
          },
        );
        continue;
      }
      bindings.set(stroke, binding);
      for (const id of binding.strokeIds) ids.add(id);
    }
  }
  if (!ids.size) return [];
  const strokes = getInkSigilStrokes(nodes, ids);
  const byId = new Map(strokes.map((source) => [source.stroke.id, source]));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  return strokes.flatMap(({ stroke }) => {
    const binding = bindings.get(stroke);
    if (!binding || binding.strokeIds[0] !== stroke.id) return [];
    const sources = binding.strokeIds.flatMap((id) => {
      const source = byId.get(id);
      return source ? [source] : [];
    });
    const target = nodesById.get(binding.targetNodeId);
    return [
      {
        binding,
        sources,
        bounds: inkSigilBounds(sources),
        sourceValid:
          sources.length === 4 &&
          inkSigilFingerprint(sources) === binding.fingerprint,
        target:
          target &&
          isInkResourceType(target.type) &&
          target.type === binding.targetType
            ? target
            : undefined,
        label: target ? inkResourceLabel(target) : binding.label,
      },
    ];
  });
}

export function selectedInkResourceReferences(
  projections: readonly InkSigilProjection[],
  selection: Record<string, readonly string[]>,
): {
  references: InkResourceReference[];
  partialCount: number;
  brokenCount: number;
} {
  const references: InkResourceReference[] = [];
  let partialCount = 0;
  let brokenCount = 0;
  for (const projection of projections) {
    if (!projection.sourceValid) continue;
    const count = projection.sources.filter((source) =>
      selection[source.nodeId]?.includes(source.stroke.id),
    ).length;
    if (count === 0) continue;
    if (count !== 4) {
      partialCount++;
      continue;
    }
    if (!projection.target) {
      brokenCount++;
      continue;
    }
    const { strokeIds: _strokeIds, ...binding } = projection.binding;
    references.push({
      ...binding,
      label: projection.label,
      sourceBounds: { ...projection.bounds },
      sources: projection.sources.map((source) => ({
        nodeId: source.nodeId,
        strokeId: source.stroke.id,
      })),
    });
  }
  return { references, partialCount, brokenCount };
}

export function inkSigilLayout(
  bounds: InkSigilBounds,
  measuredLabelWidth?: number,
  measuredLabelHeight?: number,
) {
  const fontSize = Math.min(34, Math.max(16, bounds.height * 0.82));
  const gap = 8;
  const lineHeight = fontSize * INK_SIGIL_LABEL_LINE_HEIGHT;
  const labelWidth = measuredLabelWidth ?? INK_SIGIL_LABEL_MAX_WIDTH;
  const labelHeight = measuredLabelHeight ?? lineHeight;
  const labelY = bounds.y + (bounds.height - lineHeight) / 2;
  const top = Math.min(bounds.y, labelY);
  return {
    fontSize,
    labelWidth,
    labelHeight,
    labelX: bounds.x + bounds.width + gap,
    labelY,
    semanticBounds: {
      ...bounds,
      y: top,
      width: bounds.width + gap + labelWidth,
      height: Math.max(bounds.y + bounds.height, labelY + labelHeight) - top,
    },
  };
}

export function inkResourceAttachments(
  references: readonly InkResourceReference[],
  selectedIds: readonly string[],
): ChatAttachment[] {
  const seen = new Set(selectedIds);
  return references.flatMap((reference) => {
    if (seen.has(reference.targetNodeId)) return [];
    seen.add(reference.targetNodeId);
    return [
      {
        type: reference.targetType === 'note' ? 'text' : reference.targetType,
        source: 'selection' as const,
        originNodeId: reference.targetNodeId,
        label: reference.label,
      },
    ];
  });
}

export function inkSelectionNodeIds(
  nodes: readonly WireSelectionNode[],
): string[] {
  const ids: string[] = [];
  const visit = (entries: readonly WireSelectionNode[]) => {
    for (const entry of entries) {
      ids.push(entry.id);
      if (entry.children) visit(entry.children);
    }
  };
  visit(nodes);
  return ids;
}
