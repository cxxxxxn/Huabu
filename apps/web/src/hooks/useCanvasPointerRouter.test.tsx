// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as inkSigil from '@/store/inkSigilStore';
import { useToolStore } from '@/store/toolStore';

import { useCanvasPointerRouter } from './useCanvasPointerRouter';
import { observeInputPointer, useInputModeStore } from './useInputMode';

import type { CanvasPointerRouterContext } from '@/handler/canvasPointerRouterContext';
import type { PointerRecognizer } from '@/handler/pointerRouter';
import type {
  EffectiveInputMode,
  InputModePreference,
} from '@/store/toolStore';
import type { ReactFlowInstance } from '@xyflow/react';

let root: Root;
let container: HTMLDivElement;
let wrapper: HTMLDivElement;
const initialTools = useToolStore.getState();
const initialInput = useInputModeStore.getState();
const onDown = vi.fn();
const recognizers: PointerRecognizer<
  PointerEvent,
  CanvasPointerRouterContext
>[] = [
  {
    id: 'test-pen',
    canClaim: (_event, context) => context.inputMode === 'pen',
    onDown: (event, context) => {
      onDown(event, context.inputMode);
      return 'claim';
    },
  },
];

// Simulate the trusted window capture listener; DOM-created pen events are untrusted.
const observePen = () => observeInputPointer('pen');

function Harness({ inputMode }: { inputMode: EffectiveInputMode }) {
  useCanvasPointerRouter(
    { current: wrapper },
    { current: {} as ReactFlowInstance },
    {
      inputMode,
      explicitToolActive: false,
      onTouchTakeover: vi.fn(),
      onEmptyCanvasTap: vi.fn(),
      onNodeTap: vi.fn(),
    },
    recognizers,
  );
  return null;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  onDown.mockClear();
  inkSigil.resetInkSigilSession();
  useToolStore.setState({ inputModePreference: 'auto', penObserved: false });
  useInputModeStore.setState({ mode: 'touch' });
  container = document.createElement('div');
  wrapper = document.createElement('div');
  document.body.append(container, wrapper);
  root = createRoot(container);
  window.addEventListener('pointerdown', observePen, true);
});

afterEach(() => {
  act(() => root.unmount());
  window.removeEventListener('pointerdown', observePen, true);
  container.remove();
  wrapper.remove();
  useToolStore.setState(initialTools);
  useInputModeStore.setState(initialInput);
  vi.unstubAllGlobals();
  inkSigil.resetInkSigilSession();
  vi.restoreAllMocks();
});

describe('useCanvasPointerRouter live input policy', () => {
  it.each([
    ['mouse', 'mouse'],
    ['pen', 'pen'],
    ['touch', 'finger'],
  ] as const)(
    'resolves a pending Select-mode binding with %s without native selection',
    (pointerType, inputMode) => {
      useToolStore.setState({ inputModePreference: inputMode });
      inkSigil.useInkSigilStore.setState({
        pending: {
          canvasId: 'space',
          strokeIds: ['s0', 's1', 's2', 's3'],
          fingerprint: '1234567890abcdef',
        },
      });
      const resolve = vi
        .spyOn(inkSigil, 'resolvePendingInkSigilTap')
        .mockReturnValue(true);
      act(() => root.render(<Harness inputMode={inputMode} />));
      const node = document.createElement('div');
      node.className = 'react-flow__node';
      wrapper.append(node);
      const nativeDown = vi.fn();
      const nativeClick = vi.fn();
      node.addEventListener('pointerdown', nativeDown);
      node.addEventListener('click', nativeClick);
      for (const type of ['pointerdown', 'pointerup']) {
        act(() =>
          node.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerType,
              pointerId: 1,
              isPrimary: true,
              button: 0,
              clientX: 120,
              clientY: 140,
            }),
          ),
        );
      }
      node.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }),
      );
      expect(resolve).toHaveBeenCalledExactlyOnceWith(120, 140);
      expect(nativeDown).not.toHaveBeenCalled();
      expect(nativeClick).not.toHaveBeenCalled();
    },
  );

  it.each(['pointermove', 'pointercancel'])(
    'cancels Select-mode binding on %s rather than binding after a drag or cancellation',
    (eventType) => {
      useToolStore.setState({ inputModePreference: 'mouse' });
      inkSigil.useInkSigilStore.setState({
        pending: {
          canvasId: 'space',
          strokeIds: ['s0', 's1', 's2', 's3'],
          fingerprint: '1234567890abcdef',
        },
      });
      const resolve = vi
        .spyOn(inkSigil, 'resolvePendingInkSigilTap')
        .mockReturnValue(true);
      act(() => root.render(<Harness inputMode="mouse" />));
      for (const [type, x] of [
        ['pointerdown', 0],
        [eventType, 30],
        ['pointerup', 0],
      ] as const) {
        act(() =>
          wrapper.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerType: 'mouse',
              pointerId: 1,
              isPrimary: true,
              button: 0,
              clientX: x,
            }),
          ),
        );
      }
      expect(resolve).not.toHaveBeenCalled();
      expect(inkSigil.useInkSigilStore.getState().pending).toBeNull();
    },
  );

  it.each(['auto', 'finger', 'mouse'] satisfies InputModePreference[])(
    'resolves the first pen contact before gating and claiming under %s',
    (preference) => {
      useToolStore.setState({ inputModePreference: preference });
      act(() =>
        root.render(
          <Harness inputMode={preference === 'mouse' ? 'mouse' : 'finger'} />,
        ),
      );
      const event = new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerType: 'pen',
        pointerId: 1,
        isPrimary: true,
        button: 0,
      });
      act(() => wrapper.dispatchEvent(event));

      expect(useToolStore.getState().penObserved).toBe(true);
      expect(useToolStore.getState().inputModePreference).toBe(preference);
      if (preference === 'auto') {
        expect(event.defaultPrevented).toBe(false);
        expect(onDown).toHaveBeenCalledExactlyOnceWith(event, 'pen');
      } else {
        expect(event.defaultPrevented).toBe(true);
        expect(onDown).not.toHaveBeenCalled();
      }
    },
  );
});
