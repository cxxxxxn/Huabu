// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  canDirectlyManipulateWithPointer,
  canStartInkSigilBinding,
  isNodePlacementTap,
} from '@/components/Panels/Canvas/canvasInputPolicy';
import { getDragActivationDistance } from '@/handler/canvasGestureSession';
import {
  dismissInkSigil,
  resolvePendingInkSigilTap,
  useInkSigilStore,
} from '@/store/inkSigilStore';

import type { CanvasPointerRouterContext } from '@/handler/canvasPointerRouterContext';
import type { PointerRecognizer } from '@/handler/pointerRouter';

/** Select-mode binding taps; Draw and Pen-mode finger navigation retain their existing paths. */
export function createInkSigilRecognizer(): PointerRecognizer<
  PointerEvent,
  CanvasPointerRouterContext
> {
  let start: PointerEvent | null = null;
  let pending: ReturnType<typeof useInkSigilStore.getState>['pending'] = null;
  let moved = false;
  let captureTarget: HTMLDivElement | null = null;
  const reset = () => {
    const pointerId = start?.pointerId;
    const element = captureTarget;
    start = null;
    pending = null;
    captureTarget = null;
    moved = false;
    if (pointerId !== undefined && element?.hasPointerCapture(pointerId))
      element.releasePointerCapture(pointerId);
  };
  const suppress = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const isTap = (event: PointerEvent) =>
    start !== null &&
    isNodePlacementTap(
      start.clientX,
      start.clientY,
      event.clientX,
      event.clientY,
      getDragActivationDistance(start.pointerType),
    );

  return {
    id: 'ink-sigil',
    canClaim: (event, ctx) =>
      start === null &&
      !ctx.explicitToolActive &&
      useInkSigilStore.getState().pending !== null &&
      event.button === 0 &&
      event.isPrimary &&
      canDirectlyManipulateWithPointer(event.pointerType, ctx.inputMode) &&
      canStartInkSigilBinding(event.target as Element | null),
    onDown: (event, ctx) => {
      start = event;
      pending = useInkSigilStore.getState().pending;
      moved = false;
      captureTarget = ctx.wrapper;
      captureTarget.setPointerCapture(event.pointerId);
      suppress(event);
      return 'claim';
    },
    onMove: (event) => {
      suppress(event);
      if (!isTap(event)) {
        moved = true;
        if (useInkSigilStore.getState().pending === pending) dismissInkSigil();
      }
    },
    onUp: (event) => {
      suppress(event);
      if (useInkSigilStore.getState().pending === pending) {
        if (!moved && isTap(event)) {
          resolvePendingInkSigilTap(event.clientX, event.clientY);
        } else {
          dismissInkSigil();
        }
      }
      reset();
    },
    onCancel: (event) => {
      suppress(event);
      if (useInkSigilStore.getState().pending === pending) dismissInkSigil();
      reset();
    },
  };
}
