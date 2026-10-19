// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { create } from 'zustand';

import { createId } from '@huabu/shared';
import {
  detectInkHash,
  getInkSigilStrokes,
  inkResourceLabel,
  inkSigilFingerprint,
  INK_SIGIL_QUIET_MS,
  isInkResourceType,
  projectInkResourceBindings,
} from '@huabu/shared/canvas-engine';

import { toast } from '@/components/Common/Toast';
import { nodeIdAtScreenPoint } from '@/handler/canvasNodeAtPoint';
import { i18n } from '@/i18n';
import useCanvasStore, { saveCanvasForSubmission } from '@/store/canvasStore';
import { useToolStore } from '@/store/toolStore';

import type {
  CanvasNodeId,
  InkResourceBinding,
  SketchStroke,
} from '@huabu/shared';
import type { InkSigilProjection } from '@huabu/shared/canvas-engine';

export interface PendingInkSigil {
  canvasId: string;
  strokeIds: string[];
  fingerprint: string;
  bindingId?: string;
}

export const useInkSigilStore = create<{
  pending: PendingInkSigil | null;
  saving: boolean;
}>(() => ({ pending: null, saving: false }));

let quietTimer: ReturnType<typeof setTimeout> | undefined;
let recentStrokeIds: string[] = [];
let sessionCanvasId = '';
let interactionVersion = 0;
let pendingSaveCount = 0;

export function cancelInkSigilDetection(): void {
  interactionVersion++;
  clearTimeout(quietTimer);
  quietTimer = undefined;
}

export function dismissInkSigil(): void {
  cancelInkSigilDetection();
  recentStrokeIds = [];
  useInkSigilStore.setState({ pending: null });
}

export function resetInkSigilSession(): void {
  dismissInkSigil();
  sessionCanvasId = '';
}

export function notifyInkSigilStrokeCommitted(strokeId: string): void {
  cancelInkSigilDetection();
  const canvasId = useCanvasStore.getState().canvasId;
  if (sessionCanvasId !== canvasId) recentStrokeIds = [];
  sessionCanvasId = canvasId;
  recentStrokeIds = [...recentStrokeIds, strokeId].slice(-4);
  if (recentStrokeIds.length !== 4) return;
  const ids = [...recentStrokeIds];
  quietTimer = setTimeout(() => {
    quietTimer = undefined;
    const canvas = useCanvasStore.getState();
    if (
      canvas.canvasId !== canvasId ||
      useToolStore.getState().pendingNodeType !== 'sketch'
    )
      return;
    try {
      const byId = new Map(
        getInkSigilStrokes(canvas.nodes, new Set(ids)).map((source) => [
          source.stroke.id,
          source,
        ]),
      );
      const sources = ids.flatMap((id) => {
        const source = byId.get(id);
        return source ? [source] : [];
      });
      if (!detectInkHash(sources)) return;
      if (sources.some((source) => source.stroke.resourceBinding)) return;
      useInkSigilStore.setState({
        pending: {
          canvasId,
          strokeIds: ids,
          fingerprint: inkSigilFingerprint(sources),
        },
      });
    } catch (error) {
      console.error('[ink-sigil] detection failed', error);
      toast(i18n.t('sigil.detectionFailed'), { tone: 'danger' });
    }
  }, INK_SIGIL_QUIET_MS);
}

export function reopenInkSigil(projection: InkSigilProjection): void {
  if (!projection.sourceValid) return;
  cancelInkSigilDetection();
  useInkSigilStore.setState({
    pending: {
      canvasId: useCanvasStore.getState().canvasId,
      strokeIds: [...projection.binding.strokeIds],
      fingerprint: projection.binding.fingerprint,
      bindingId: projection.binding.id,
    },
  });
}

export async function bindPendingInkSigil(
  targetNodeId: string | null,
): Promise<void> {
  const { pending } = useInkSigilStore.getState();
  if (!pending) return;
  const canvas = useCanvasStore.getState();
  const target = canvas.nodes.find((node) => node.id === targetNodeId);
  const sourcesById = new Map(
    getInkSigilStrokes(canvas.nodes, new Set(pending.strokeIds)).map(
      (source) => [source.stroke.id, source],
    ),
  );
  const sources = pending.strokeIds.flatMap((id) => {
    const source = sourcesById.get(id);
    return source ? [source] : [];
  });
  if (
    canvas.canvasId !== pending.canvasId ||
    sources.length !== 4 ||
    inkSigilFingerprint(sources) !== pending.fingerprint ||
    (targetNodeId !== null && (!target || !isInkResourceType(target.type)))
  ) {
    dismissInkSigil();
    toast(i18n.t('sigil.unavailable'), { tone: 'danger' });
    return;
  }
  const owner = canvas.nodes.find((node) => node.id === sources[0].nodeId);
  if (!owner || !Array.isArray(owner.data.strokes)) {
    toast(i18n.t('sigil.unavailable'), { tone: 'danger' });
    return;
  }
  const binding: InkResourceBinding | undefined =
    target && isInkResourceType(target.type)
      ? {
          id:
            pending.bindingId ??
            sources[0].stroke.resourceBinding?.id ??
            createId('sigil'),
          strokeIds: [...pending.strokeIds],
          fingerprint: pending.fingerprint,
          targetNodeId: target.id,
          targetType: target.type,
          label: inkResourceLabel(target),
        }
      : undefined;
  const strokes = (owner.data.strokes as SketchStroke[]).map((stroke) => {
    if (stroke.id !== pending.strokeIds[0]) return stroke;
    const { resourceBinding: _old, ...ink } = stroke;
    return binding ? { ...ink, resourceBinding: binding } : ink;
  });
  pendingSaveCount++;
  useInkSigilStore.setState({ saving: true });
  let restoreVersion: number | undefined;
  try {
    canvas.executeCommands(
      [
        {
          type: 'MERGE_NODE_DATA',
          patches: [{ nodeId: owner.id as CanvasNodeId, patch: { strokes } }],
        },
      ],
      'ui',
    );
    if (useInkSigilStore.getState().pending === pending) {
      dismissInkSigil();
      restoreVersion = interactionVersion;
    }
    await saveCanvasForSubmission(pending.canvasId);
  } catch (error) {
    console.error('[ink-sigil] binding save failed', error);
    toast(i18n.t('sigil.saveFailed'), { tone: 'danger' });
    const retry = { ...pending, bindingId: binding?.id };
    if (
      restoreVersion !== undefined &&
      restoreVersion === interactionVersion &&
      !useInkSigilStore.getState().pending &&
      validatePendingInkSigil(retry)
    ) {
      useInkSigilStore.setState({ pending: retry });
    }
  } finally {
    pendingSaveCount--;
    useInkSigilStore.setState({ saving: pendingSaveCount > 0 });
  }
}

export function resolvePendingInkSigilTap(
  clientX: number,
  clientY: number,
): boolean {
  if (!useInkSigilStore.getState().pending) return false;
  const canvas = useCanvasStore.getState();
  const excluded = new Set(
    canvas.nodes
      .filter((node) => node.type === 'sketch')
      .map((node) => node.id),
  );
  const id = nodeIdAtScreenPoint(clientX, clientY, {
    excludeNodeIds: excluded,
  });
  const target = canvas.nodes.find((node) => node.id === id);
  if (target && isInkResourceType(target.type)) {
    void bindPendingInkSigil(target.id);
  } else {
    dismissInkSigil();
  }
  return true;
}

export function validatePendingInkSigil(
  pending = useInkSigilStore.getState().pending,
): boolean {
  if (!pending) return true;
  const canvas = useCanvasStore.getState();
  if (canvas.canvasId !== pending.canvasId) return false;
  if (pending.bindingId) {
    return projectInkResourceBindings(canvas.nodes).some(
      (projection) =>
        projection.binding.id === pending.bindingId && projection.sourceValid,
    );
  }
  const byId = new Map(
    getInkSigilStrokes(canvas.nodes, new Set(pending.strokeIds)).map(
      (source) => [source.stroke.id, source],
    ),
  );
  const sources = pending.strokeIds.flatMap((id) => {
    const source = byId.get(id);
    return source ? [source] : [];
  });
  return (
    sources.length === 4 && inkSigilFingerprint(sources) === pending.fingerprint
  );
}
