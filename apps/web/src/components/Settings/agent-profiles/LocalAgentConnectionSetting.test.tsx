// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getElectronBridge,
  type ElectronLocalAgentState,
} from '@/hooks/useElectron';

import { LocalAgentConnectionSetting } from './LocalAgentConnectionSetting';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/hooks/useElectron', () => ({ getElectronBridge: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/store/acpProfilesStore', () => ({
  useAcpProfilesStore: (
    selector: (state: { refresh: typeof refresh }) => unknown,
  ) => selector({ refresh }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
let onState: ((state: ElectronLocalAgentState) => void) | undefined;
const initial: ElectronLocalAgentState = {
  enabled: false,
  status: 'disabled',
  error: null,
};
const api = {
  getState: vi.fn(async () => initial),
  setEnabled: vi.fn(
    async (): Promise<ElectronLocalAgentState> => ({
      enabled: true,
      status: 'connecting',
      error: null,
    }),
  ),
  onState: vi.fn((callback: (state: ElectronLocalAgentState) => void) => {
    onState = callback;
    return vi.fn();
  }),
};

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(getElectronBridge).mockReturnValue({
    isElectron: true,
    isRemoteServer: true,
    platform: 'darwin',
    titleBarHeight: 36,
    versions: { node: '', chrome: '', electron: '' },
    localAgent: api,
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('local Agent settings', () => {
  it('does not expose local actions in a browser', async () => {
    vi.mocked(getElectronBridge).mockReturnValue(null);
    await act(async () => root.render(<LocalAgentConnectionSetting />));
    expect(container.textContent).toBe('');
    expect(api.getState).not.toHaveBeenCalled();
  });

  it('connects without a token input and updates independently from Settings actions', async () => {
    await act(async () => root.render(<LocalAgentConnectionSetting />));
    expect(container.querySelector('input')).toBeNull();
    await act(async () => container.querySelector('button')?.click());
    expect(api.setEnabled).toHaveBeenCalledExactlyOnceWith(true);
    expect(container.textContent).toContain('settings.localAgentConnecting');
    await act(async () =>
      onState?.({ enabled: true, status: 'connected', error: null }),
    );
    expect(container.textContent).toContain('settings.localAgentConnected');
    expect(container.textContent).toContain('settings.localAgentDisconnect');
    await act(async () => container.querySelector('button')?.click());
    expect(api.setEnabled).toHaveBeenLastCalledWith(false);
  });

  it('shows authorization failure with reconnect and disconnect controls', async () => {
    await act(async () => root.render(<LocalAgentConnectionSetting />));
    await act(async () =>
      onState?.({
        enabled: true,
        status: 'authorization-required',
        error: 'Authorization rejected',
      }),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Authorization rejected',
    );
    expect(container.textContent).toContain('settings.localAgentReconnect');
    expect(container.textContent).toContain('settings.localAgentDisconnect');
  });

  it('surfaces IPC failures and leaves the action available for retry', async () => {
    api.setEnabled.mockRejectedValueOnce(new Error('Connection unavailable'));
    await act(async () => root.render(<LocalAgentConnectionSetting />));
    await act(async () => container.querySelector('button')?.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Connection unavailable',
    );
    expect(container.querySelector('button')?.disabled).toBe(false);
  });
});
