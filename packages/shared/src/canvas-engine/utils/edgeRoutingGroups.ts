// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export interface RoutingRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type RouteDir = 'right' | 'left' | 'down' | 'up';
type Axis = 'x' | 'y';
type Connection = {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

const DIRECTION_SIDES = {
  down: ['bottom', 'top'],
  up: ['top', 'bottom'],
  right: ['right', 'left'],
  left: ['left', 'right'],
} as const;

/**
 * Infer local fan-out/fan-in axes without moving nodes or interpreting arrows.
 * Unlike layout seeding, routing accepts leading-, centre-, and trailing-edge
 * alignment, but requires non-overlapping peers on the perpendicular axis.
 */
export function getGroupRoutingDirections<E extends Connection>(
  rects: ReadonlyMap<string, RoutingRect>,
  edges: readonly E[],
): Map<E, RouteDir> {
  const neighbours = new Map<
    string,
    {
      rect: RoutingRect;
      peers: Map<string, RoutingRect>;
    }
  >();
  const connections: { edge: E; source: RoutingRect; target: RoutingRect }[] =
    [];
  for (const edge of edges) {
    const { source, target } = edge;
    const sourceRect = rects.get(source);
    const targetRect = rects.get(target);
    if (source === target || !sourceRect || !targetRect) continue;
    connections.push({ edge, source: sourceRect, target: targetRect });
    for (const [hub, hubRect, peer, peerRect] of [
      [source, sourceRect, target, targetRect],
      [target, targetRect, source, sourceRect],
    ] as const) {
      let entry = neighbours.get(hub);
      if (!entry) {
        entry = { rect: hubRect, peers: new Map() };
        neighbours.set(hub, entry);
      }
      entry.peers.set(peer, peerRect);
    }
  }

  type Votes = { x: number; y: number };
  const entryEvidence = new Map<string, Map<string, Votes>>();
  const retentionEvidence = new Map<string, Map<string, Votes>>();
  for (const [hubId, { rect: hub, peers: peerRects }] of neighbours) {
    const peers = [...peerRects].map(([id, rect]) => ({ id, rect }));
    const entryVotes = new Map<string, Votes>();
    const retentionVotes = new Map<string, Votes>();
    entryEvidence.set(hubId, entryVotes);
    retentionEvidence.set(hubId, retentionVotes);

    for (const dir of ['down', 'up', 'right', 'left'] as const) {
      const vertical = dir === 'down' || dir === 'up';
      const axis: Axis = vertical ? 'y' : 'x';
      const cross: Axis = vertical ? 'x' : 'y';
      const extent = vertical ? 'h' : 'w';
      const crossExtent = vertical ? 'w' : 'h';
      const candidates = peers.filter(({ rect }) => {
        switch (dir) {
          case 'down':
            return rect.y > hub.y + hub.h;
          case 'up':
            return rect.y + rect.h < hub.y;
          case 'right':
            return rect.x > hub.x + hub.w;
          case 'left':
            return rect.x + rect.w < hub.x;
        }
      });
      if (candidates.length < 2) continue;

      for (const alignment of [0, 0.5, 1]) {
        const anchor = (rect: RoutingRect) =>
          rect[axis] + rect[extent] * alignment;
        const sorted = [...candidates].sort(
          (a, b) => anchor(a.rect) - anchor(b.rect) || a.id.localeCompare(b.id),
        );
        // Compute both bands from geometry alone. History may retain a weak
        // preference, but must never expand and invalidate a strong subgroup.
        for (const retaining of [false, true]) {
          const votes = retaining ? retentionVotes : entryVotes;
          let start = 0;
          while (start < sorted.length) {
            const first = sorted[start];
            let end = start + 1;
            let minExtent = first.rect[extent];
            while (end < sorted.length) {
              minExtent = Math.min(minExtent, sorted[end].rect[extent]);
              const ratio = retaining ? 0.4 : 0.25;
              const tolerance = Math.max(
                4,
                Math.min(retaining ? 64 : 40, minExtent * ratio),
              );
              // A fixed band origin prevents a staircase from chaining into a row.
              if (anchor(sorted[end].rect) - anchor(first.rect) > tolerance)
                break;
              end++;
            }
            const band = sorted
              .slice(start, end)
              .sort(
                (a, b) =>
                  a.rect[cross] - b.rect[cross] || a.id.localeCompare(b.id),
              );
            const separated = band.every(
              (peer, i) =>
                i === 0 ||
                band[i - 1].rect[cross] + band[i - 1].rect[crossExtent] <=
                  peer.rect[cross],
            );
            if (band.length >= 2 && separated) {
              for (const { id } of band) {
                const vote = votes.get(id) ?? { x: 0, y: 0 };
                vote[axis] = Math.max(vote[axis], band.length);
                votes.set(id, vote);
              }
            }
            start = end;
          }
        }
      }
    }
  }

  const result = new Map<E, RouteDir>();
  for (const { edge, source, target } of connections) {
    for (const evidence of [entryEvidence, retentionEvidence]) {
      const a = evidence.get(edge.source)?.get(edge.target);
      const b = evidence.get(edge.target)?.get(edge.source);
      const x = Math.max(a?.x ?? 0, b?.x ?? 0);
      const y = Math.max(a?.y ?? 0, b?.y ?? 0);
      // Conflicting local explanations must not be resolved by traversal order.
      if (x === y || Math.max(x, y) < Math.min(x, y) * 1.5) {
        if (evidence === entryEvidence && (x > 0 || y > 0)) break;
        continue;
      }
      const direction =
        y > x
          ? target.y > source.y
            ? 'down'
            : 'up'
          : target.x > source.x
            ? 'right'
            : 'left';
      const [from, to] = DIRECTION_SIDES[direction];
      if (
        evidence === entryEvidence ||
        (edge.sourceHandle === `${from}-source` &&
          edge.targetHandle === `${to}-target`)
      ) {
        result.set(edge, direction);
        break;
      }
    }
  }
  return result;
}
