// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it, vi } from 'vitest';

import {
  anchorViewportCentre,
  fitNodesOnCanvas,
  getReliableNodeBounds,
  revealBoundsInViewport,
  revealNodesOnCanvas,
} from './focusNodesOnCanvas';

import type { ReactFlowInstance } from '@xyflow/react';

const createInstance = () => {
  const internalNodes = {
    first: {
      measured: {},
      style: { width: 200, height: 120 },
      internals: { positionAbsolute: { x: 1000, y: 500 } },
    },
    second: {
      measured: { width: 80, height: 60 },
      style: {},
      internals: { positionAbsolute: { x: 1400, y: 800 } },
    },
  };
  const fitBounds = vi.fn().mockResolvedValue(true);
  const setViewport = vi.fn().mockResolvedValue(true);
  const instance = {
    getInternalNode: (id: string) =>
      internalNodes[id as keyof typeof internalNodes],
    fitBounds,
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport,
  } as unknown as ReactFlowInstance;
  return { instance, fitBounds, setViewport };
};

describe('reliable canvas node bounds', () => {
  it('uses persisted style dimensions for unmeasured nodes', () => {
    const { instance } = createInstance();

    expect(getReliableNodeBounds(instance, ['first', 'second'])).toEqual({
      x: 1000,
      y: 500,
      width: 480,
      height: 360,
    });
  });

  it('fits the resolved bounds', async () => {
    const { instance, fitBounds } = createInstance();

    await expect(
      fitNodesOnCanvas(instance, ['first', 'second'], 0.2),
    ).resolves.toBe(true);

    expect(fitBounds).toHaveBeenCalledWith(
      { x: 1000, y: 500, width: 480, height: 360 },
      { padding: 0.2 },
    );
  });

  it('reports when no visible node bounds can be resolved', async () => {
    const { instance, fitBounds } = createInstance();

    await expect(fitNodesOnCanvas(instance, [])).resolves.toBe(false);
    expect(fitBounds).not.toHaveBeenCalled();
  });

  it.each([
    { size: 1, zoom: 5 },
    { size: 1000000, zoom: 0.01 },
  ])(
    'fits overlay bounds within the shared zoom range at $zoom',
    async ({ size, zoom }) => {
      const { instance, setViewport, fitBounds } = createInstance();
      const node = instance.getInternalNode('first');
      if (!node) throw new Error('Expected fixture node');
      node.measured = { width: size, height: size };
      const wrapper = document.createElement('div');
      Object.defineProperties(wrapper, {
        clientWidth: { value: 1600 },
        clientHeight: { value: 1000 },
      });
      wrapper.style.setProperty('--canvas-inset-left', '260px');
      wrapper.style.setProperty('--canvas-inset-right', '420px');
      document.body.appendChild(wrapper);
      const query = vi
        .spyOn(document, 'querySelector')
        .mockReturnValue(wrapper);
      try {
        await expect(fitNodesOnCanvas(instance, ['first'])).resolves.toBe(true);
        expect(setViewport).toHaveBeenCalledWith({
          x: 720 - (1000 + size / 2) * zoom,
          y: 500 - (500 + size / 2) * zoom,
          zoom,
        });
        expect(fitBounds).not.toHaveBeenCalled();
      } finally {
        query.mockRestore();
        wrapper.remove();
      }
    },
  );

  it('minimally reveals clipped nodes without changing zoom', () => {
    const { instance, setViewport } = createInstance();
    const wrapper = { clientWidth: 600, clientHeight: 500 } as HTMLElement;

    expect(revealNodesOnCanvas(instance, wrapper, ['first'], 250)).toBe(true);
    expect(setViewport).toHaveBeenCalledWith(
      { x: -624, y: -144, zoom: 1 },
      { duration: 250, interpolate: 'linear', ease: expect.any(Function) },
    );
    const ease = setViewport.mock.calls[0][1].ease as (
      progress: number,
    ) => number;
    expect(ease(0)).toBe(0);
    expect(ease(0.25)).toBeCloseTo(0.146447, 6);
    expect(ease(0.5)).toBeCloseTo(0.5);
    expect(ease(0.75)).toBeCloseTo(0.853553, 6);
    expect(ease(1)).toBe(1);
  });

  it.each([
    { targetX: 100, expectedX: 84 },
    { targetX: 500, expectedX: -44 },
  ])(
    'reveals an obscured target at 200% without zooming ($targetX)',
    ({ targetX, expectedX }) => {
      const { instance, setViewport } = createInstance();
      const node = instance.getInternalNode('first');
      if (!node) throw new Error('Expected fixture node');
      node.internals.positionAbsolute = { x: targetX, y: 100 };
      vi.spyOn(instance, 'getViewport').mockReturnValue({
        x: 0,
        y: 0,
        zoom: 2,
      });
      const wrapper = document.createElement('div');
      Object.defineProperties(wrapper, {
        clientWidth: { value: 1800 },
        clientHeight: { value: 1000 },
      });
      wrapper.style.setProperty('--canvas-inset-left', '260px');
      wrapper.style.setProperty('--canvas-inset-right', '420px');
      document.body.appendChild(wrapper);
      try {
        expect(revealNodesOnCanvas(instance, wrapper, ['first'])).toBe(true);
        expect(setViewport).toHaveBeenCalledWith(
          { x: expectedX, y: 0, zoom: 2 },
          expect.objectContaining({ duration: 400, interpolate: 'linear' }),
        );
      } finally {
        wrapper.remove();
      }
    },
  );

  it('does not take over the viewport when nodes are already visible', () => {
    const { instance, setViewport } = createInstance();
    const wrapper = { clientWidth: 1600, clientHeight: 1000 } as HTMLElement;

    expect(revealNodesOnCanvas(instance, wrapper, ['first'])).toBe(false);
    expect(setViewport).not.toHaveBeenCalled();
  });
});

describe('canvas viewport anchoring', () => {
  it('reveals nodes between overlay panels without changing zoom', () => {
    expect(
      revealBoundsInViewport(
        { x: 0, y: 0, zoom: 1 },
        { x: 260, y: 0, width: 600, height: 700 },
        { x: 800, y: 100, width: 200, height: 120 },
      ),
    ).toEqual({ x: -164, y: 0, zoom: 1 });
    expect(
      revealBoundsInViewport(
        { x: 0, y: 0, zoom: 1 },
        { x: 260, y: 0, width: 600, height: 700 },
        { x: 100, y: 100, width: 200, height: 120 },
      ),
    ).toEqual({ x: 184, y: 0, zoom: 1 });
  });

  it('keeps the top left of oversized overlay targets accessible', () => {
    expect(
      revealBoundsInViewport(
        { x: 0, y: 0, zoom: 1 },
        { x: 260, y: 0, width: 300, height: 400 },
        { x: 100, y: 100, width: 800, height: 800 },
      ),
    ).toEqual({ x: 184, y: -76, zoom: 1 });
  });

  it('keeps the same flow point centred when the viewport grows', () => {
    expect(
      anchorViewportCentre(
        { x: 100, y: 40, zoom: 0.75 },
        { width: 800, height: 600 },
        { width: 1200, height: 700 },
      ),
    ).toEqual({ x: 300, y: 90, zoom: 0.75 });
  });

  it('does not move bounds that are already safely visible', () => {
    const viewport = { x: 0, y: 0, zoom: 1 };

    expect(
      revealBoundsInViewport(
        viewport,
        { x: 0, y: 0, width: 800, height: 600 },
        { x: 100, y: 100, width: 200, height: 120 },
      ),
    ).toBe(viewport);
  });

  it('uses the smallest pan needed to reveal clipped bounds', () => {
    expect(
      revealBoundsInViewport(
        { x: 0, y: 0, zoom: 1 },
        { x: 0, y: 0, width: 600, height: 500 },
        { x: 500, y: 200, width: 140, height: 100 },
        20,
      ),
    ).toEqual({ x: -60, y: 0, zoom: 1 });
  });

  it('aligns oversized bounds to the leading edge without changing zoom', () => {
    expect(
      revealBoundsInViewport(
        { x: 10, y: 20, zoom: 2 },
        { x: 0, y: 0, width: 500, height: 400 },
        { x: 0, y: 10, width: 300, height: 80 },
      ),
    ).toEqual({ x: 24, y: 20, zoom: 2 });
  });
});
