// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { UserMessage } from './UserMessage';

let container: HTMLDivElement | undefined;

afterEach(() => {
  container?.remove();
  container = undefined;
});

describe('UserMessage', () => {
  it('renders an honest label for an empty Ink request', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<UserMessage content="" inputKind="ink-intent" />);
    });

    expect(container.textContent).toContain('Ink request');
    expect(container.querySelector('[data-chat-user-message]')).not.toBeNull();
    act(() => root.unmount());
  });

  it('renders inferred intent as Agent-derived Ink text', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <UserMessage
          content=""
          inputKind="ink-intent"
          inferredIntent="Expand the third comparison step"
        />,
      );
    });

    expect(container.textContent).toContain('Expand the third comparison step');
    expect(container.textContent).not.toContain('Ink request');
    expect(
      container.querySelector(
        '[aria-label="Inferred Ink request: Expand the third comparison step"]',
      ),
    ).not.toBeNull();
    act(() => root.unmount());
  });
});
