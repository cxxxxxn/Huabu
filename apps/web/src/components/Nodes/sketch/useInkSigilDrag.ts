// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useReactFlow } from '@xyflow/react';
import { useCallback, useEffect, useRef } from 'react';

import { toast } from '@/components/Common/Toast';
import {
  beginCanvasGesture,
  endCanvasGesture,
  updateCanvasGesture,
} from '@/handler/canvasGestureSession';
import { i18n } from '@/i18n';
import { useGesturePreviewStore } from '@/store/gesturePreviewStore';
import { dismissInkSigil, reopenInkSigil } from '@/store/inkSigilStore';

import { buildMoveStrokesCommands, commitStrokeCommands } from './sketchMerge';

import type { CanvasNodeId } from '@huabu/shared';
import type { InkSigilProjection } from '@huabu/shared/canvas-engine';
import type { Node } from '@xyflow/react';
import type { PointerEvent as ReactPointerEvent } from 'react';

type Selection = ReturnType<
  typeof useGesturePreviewStore.getState
>['sketchStrokeSelection'];
type Drag = {
  pointerId: number;
  target: HTMLButtonElement;
  projection: InkSigilProjection;
  start: { x: number; y: number };
  selection: Selection;
  previousSelection: Selection;
  previousPolygon: ReturnType<
    typeof useGesturePreviewStore.getState
  >['sketchSelectionPolygon'];
  moved: boolean;
  offset: { dx: number; dy: number };
};

export function useInkSigilDrag(
  nodes: Node[],
  canvasId: string | null,
  interactive: boolean,
) {
  const { screenToFlowPosition } = useReactFlow();
  const dragRef = useRef<Drag | null>(null);

  const finish = useCallback((restoreSelection = true) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    endCanvasGesture(drag.pointerId);
    const preview = useGesturePreviewStore.getState();
    if (preview.sketchStrokeSelection === drag.selection) {
      useGesturePreviewStore.setState({
        sketchStrokeSelection: restoreSelection ? drag.previousSelection : {},
        sketchSelectionPolygon: restoreSelection ? drag.previousPolygon : null,
        sketchStrokeMovePreview: null,
        sketchStrokeMoveCarriedNodeIds: [],
      });
    }
    if (drag.target.hasPointerCapture(drag.pointerId)) {
      drag.target.releasePointerCapture(drag.pointerId);
    }
  }, []);

  useEffect(() => {
    const cancel = () => finish();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dragRef.current) {
        event.preventDefault();
        cancel();
      }
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') cancel();
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key, true);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key, true);
      document.removeEventListener('visibilitychange', visibility);
      finish(false);
    };
  }, [nodes, canvasId, interactive, finish]);

  const onPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    projection: InkSigilProjection,
  ) => {
    event.stopPropagation();
    const preview = useGesturePreviewStore.getState();
    const pointerType = event.pointerType;
    if (
      !interactive ||
      !event.isPrimary ||
      event.button !== 0 ||
      preview.inkSubmissionPreparing ||
      dragRef.current ||
      (pointerType !== 'mouse' &&
        pointerType !== 'pen' &&
        pointerType !== 'touch')
    )
      return;
    if (
      !beginCanvasGesture('sketch-stroke-move', event.pointerId, pointerType, {
        x: event.clientX,
        y: event.clientY,
      })
    )
      return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const selection: Selection = {};
    for (const source of projection.sources) {
      (selection[source.nodeId] ??= []).push(source.stroke.id);
    }
    dragRef.current = {
      pointerId: event.pointerId,
      target: event.currentTarget,
      projection,
      start: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      selection,
      previousSelection: preview.sketchStrokeSelection,
      previousPolygon: preview.sketchSelectionPolygon,
      moved: false,
      offset: { dx: 0, dy: 0 },
    };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (useGesturePreviewStore.getState().inkSubmissionPreparing) {
      finish();
      return;
    }
    if (
      updateCanvasGesture(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      }) !== 'locked'
    )
      return;
    const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    drag.moved = true;
    drag.offset = { dx: flow.x - drag.start.x, dy: flow.y - drag.start.y };
    dismissInkSigil();
    useGesturePreviewStore.setState({
      sketchStrokeSelection: drag.selection,
      sketchSelectionPolygon: null,
      sketchStrokeMovePreview: drag.offset,
      sketchStrokeMoveCarriedNodeIds: [],
    });
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    onPointerMove(event);
    if (dragRef.current !== drag) return;
    finish();
    if (!drag.moved) {
      reopenInkSigil(drag.projection);
      return;
    }
    try {
      const commands = Object.entries(drag.selection).flatMap(
        ([nodeId, strokeIds]) =>
          buildMoveStrokesCommands(
            nodeId as CanvasNodeId,
            new Set(strokeIds),
            drag.offset.dx,
            drag.offset.dy,
          ),
      );
      commitStrokeCommands(commands);
    } catch (error) {
      console.error('[ink-sigil] move failed', error);
      toast(i18n.t('sigil.moveFailed'), { tone: 'danger' });
    }
  };
  const onPointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerId === dragRef.current?.pointerId) finish();
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture: onPointerCancel,
  };
}
