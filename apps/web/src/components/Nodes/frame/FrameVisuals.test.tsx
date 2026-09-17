// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FrameHeader } from './FrameHeader';
import { FrameSurface } from './FrameSurface';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Frame visual primitives', () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  it('renders the production surface independently of canvas state', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() =>
      root?.render(
        <FrameSurface accent={null} borderRadius={32}>
          Frame content
        </FrameSurface>,
      ),
    );

    const surface = container.firstElementChild as HTMLElement | null;
    expect(surface?.classList.contains('bg-surface')).toBe(true);
    expect(surface?.classList.contains('border-3')).toBe(true);
    expect(surface?.style.borderRadius).toBe('32px');
  });

  it('keeps the title before the icon-free instruction badge', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() =>
      root?.render(
        <FrameHeader
          metrics={{
            left: 20,
            top: 10,
            height: 43,
            fontSize: 36,
            maxWidth: 800,
          }}
          accent="#ffffff"
          instructionKind="prompt"
        >
          <span data-frame-title>Prompt</span>
        </FrameHeader>,
      ),
    );

    const header = container.firstElementChild;
    expect(header?.children).toHaveLength(3);
    expect(header?.children[0].getAttribute('aria-hidden')).toBe('true');
    expect(
      header?.children[1].querySelector('[data-frame-title]'),
    ).not.toBeNull();
    expect(header?.children[2].textContent).toBe('node.promptFrameBadgeGlobal');
    expect(header?.classList.contains('pointer-events-none')).toBe(true);
    expect(header?.children[2].classList.contains('pointer-events-auto')).toBe(
      true,
    );
    expect(header?.children[2].getAttribute('title')).toBe(
      'node.promptFrameBadgeGlobalDescription',
    );
    expect(header?.querySelector('svg')).toBeNull();
  });
});
