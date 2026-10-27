// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { discardPendingSaves, drainPendingSaves } from '@/store/canvasStore';

import { SpaceNavigationGuard } from './SpaceNavigationGuard';

vi.mock('@/store/canvasStore', () => ({
  default: { getState: () => ({ canvasId: 'A' }) },
  drainPendingSaves: vi.fn(),
  discardPendingSaves: vi.fn(),
}));
vi.mock('@/components/Common/Loading', () => ({ Loading: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof createMemoryRouter>;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(drainPendingSaves).mockRejectedValue(new Error('disk unavailable'));
  vi.mocked(discardPendingSaves).mockResolvedValue(undefined);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  router = createMemoryRouter(
    [
      {
        element: (
          <>
            <SpaceNavigationGuard />
            <Outlet />
          </>
        ),
        children: [{ path: '*', element: <p>Space content</p> }],
      },
    ],
    { initialEntries: ['/canvas/A'] },
  );
  await act(async () =>
    root.render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  router.dispose();
  host.remove();
});

async function navigate(path = '/canvas/B') {
  await act(async () => router.navigate(path));
}

async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(
    (item) => item.textContent === label,
  );
  if (!button) throw new Error(`Missing ${label}`);
  await act(async () => button.click());
}

it('keeps the original route until the user decides, and defaults focus to staying', async () => {
  await navigate();
  expect(router.state.location.pathname).toBe('/canvas/A');
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(document.activeElement?.textContent).toBe('app.stayInSpace');
  await click('app.stayInSpace');
  expect(router.state.location.pathname).toBe('/canvas/A');
  expect(discardPendingSaves).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  vi.mocked(drainPendingSaves).mockResolvedValue(undefined);
  await navigate();
  expect(router.state.location.pathname).toBe('/canvas/B');
});

it.each(['/canvas/B', '/spaces'])(
  'discards only after confirmation before leaving for %s',
  async (path) => {
    await navigate(path);
    expect(discardPendingSaves).not.toHaveBeenCalled();
    await click('app.discardAndLeave');
    expect(discardPendingSaves).toHaveBeenCalledExactlyOnceWith('A');
    expect(router.state.location.pathname).toBe(path);
  },
);

it('Escape stays without discarding', async () => {
  await navigate();
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
  );
  expect(router.state.location.pathname).toBe('/canvas/A');
  expect(discardPendingSaves).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('keeps navigation blocked while discarding and surfaces discard errors', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(discardPendingSaves).mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await navigate();
  await click('app.discardAndLeave');
  expect(router.state.location.pathname).toBe('/canvas/A');
  expect(
    [...document.querySelectorAll('button')].every((button) => button.disabled),
  ).toBe(true);
  await act(async () => reject(new Error('discard failed')));
  expect(router.state.location.pathname).toBe('/canvas/A');
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    'app.discardFailed',
  );
  await click('app.stayInSpace');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('does not block hash or search changes within the same Space', async () => {
  await navigate('/canvas/A?node=n1#note');
  expect(drainPendingSaves).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
