// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  afterEach,
  assert,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { isAgentletFolderPickerSupported } from '@/hooks/useAgentletFolderPicker';
import { i18n } from '@/i18n';
import { useAcpProfilesStore } from '@/store/acpProfilesStore';
import { useWorkspaceStore } from '@/store/workspaceStore';

import { FolderPickerButton } from './FolderPickerButton';
import { PathInput } from './PathInput';

import type * as WorkspaceApi from '@/api/workspace';
import type * as Electron from '@/hooks/useElectron';

const api = vi.hoisted(() => ({ pick: vi.fn(), bridge: vi.fn() }));
vi.mock('@/hooks/useElectron', async (importOriginal) => ({
  ...(await importOriginal<typeof Electron>()),
  getElectronBridge: api.bridge,
}));
vi.mock('@/components/Common/Loading', () => ({
  Loading: () => <span>Loading</span>,
}));
vi.mock('@/api/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceApi>()),
  pickFolder: api.pick,
}));

const devices = [
  {
    agentletId: 'local',
    hostname: 'same-host',
    displayName: 'Local',
    version: '1',
    connectedAt: '',
    profileCount: 0,
  },
  {
    agentletId: 'remote',
    hostname: 'same-host',
    displayName: 'Remote',
    version: '1',
    connectedAt: '',
    profileCount: 0,
  },
];
let root: Root;
let container: HTMLDivElement;
const onPicked = vi.fn();
const onError = vi.fn();
const onPickingChange = vi.fn();

async function render(targetAgentletId = 'local', enabled = true) {
  await act(async () =>
    root.render(
      <FolderPickerButton
        targetAgentletId={targetAgentletId}
        enabled={enabled}
        onPicked={onPicked}
        onError={onError}
        onPickingChange={onPickingChange}
      />,
    ),
  );
}

async function click() {
  const button = container.querySelector('button');
  assert(button);
  await act(async () => button.click());
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  vi.clearAllMocks();
  api.bridge.mockReturnValue(null);
  api.pick.mockResolvedValue({ ok: true, path: '/picked' });
  useAcpProfilesStore.setState({
    connectedDevices: devices,
    folderPickerAgentletId: 'local',
  });
  useWorkspaceStore.setState({
    capabilities: { nativePicker: true, canChangeWorkspace: true },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('Agentlet-aware folder picking', () => {
  it.each([
    ['local', 'local', true],
    ['remote', 'local', false],
    ['same-host', 'local', false],
    ['missing', 'local', false],
    ['local', null, false],
    ['', 'local', false],
  ])(
    'matches target %s against picker %s without guessing from hostname',
    (target, folderPickerAgentletId, expected) => {
      expect(
        isAgentletFolderPickerSupported(target, {
          connectedDevices: devices,
          folderPickerAgentletId,
        }),
      ).toBe(expected);
    },
  );

  it('supports a uniquely resolved legacy hostname', () => {
    expect(
      isAgentletFolderPickerSupported('same-host', {
        connectedDevices: [devices[0]],
        folderPickerAgentletId: 'local',
      }),
    ).toBe(true);
  });

  it.each(['remote', 'missing', 'same-host', ''])(
    'hides the button for an unconfirmed target: %s',
    async (target) => {
      await render(target);
      expect(container.querySelector('button')).toBeNull();
      expect(api.pick).not.toHaveBeenCalled();
    },
  );

  it('requires a GUI and known picker identity', async () => {
    useWorkspaceStore.setState({
      capabilities: { nativePicker: false, canChangeWorkspace: true },
    });

    await render();
    expect(container.querySelector('button')).toBeNull();
    useWorkspaceStore.setState({
      capabilities: { nativePicker: true, canChangeWorkspace: true },
    });
    useAcpProfilesStore.setState({ folderPickerAgentletId: null });
    await render();
    expect(container.querySelector('button')).toBeNull();
  });

  it('disables remote Electron even with a matching identity and Server GUI', async () => {
    api.bridge.mockReturnValue({ isRemoteServer: true });
    await render();
    expect(container.querySelector('button')).toBeNull();
  });

  it('supports local Electron native dialogs when the Server has no GUI', async () => {
    api.bridge.mockReturnValue({ isRemoteServer: false, dialog: {} });
    useWorkspaceStore.setState({
      capabilities: { nativePicker: false, canChangeWorkspace: true },
    });
    await render();
    expect(container.querySelector('button')).not.toBeNull();
  });

  it('returns the selected path without persisting it', async () => {
    await render();
    await click();
    expect(onPicked).toHaveBeenCalledWith('/picked');
    expect(onPickingChange.mock.calls).toEqual([[true], [false]]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('treats cancellation as a no-op and surfaces picker failures', async () => {
    await render();
    api.pick.mockResolvedValueOnce({ ok: false, reason: 'cancelled' });
    await click();
    expect(onPicked).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    api.pick.mockResolvedValueOnce({ ok: false, reason: 'no-picker' });
    await click();
    expect(onError).toHaveBeenCalledWith(
      'No folder picker is available on this machine.',
    );
    api.pick.mockRejectedValueOnce(new Error('Picker failed'));
    await click();
    expect(onError).toHaveBeenCalledWith('Picker failed');
  });

  it('blocks duplicate requests and discards a result after the target changes', async () => {
    let resolve!: (result: { ok: true; path: string }) => void;
    api.pick.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await render();
    await click();
    await click();
    expect(api.pick).toHaveBeenCalledOnce();
    await render('remote');
    await act(async () => resolve({ ok: true, path: '/wrong-machine' }));
    expect(onPicked).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      'The target device changed. Select the folder again.',
    );
  });

  it('discards a result after the picker device disconnects', async () => {
    let resolve!: (result: { ok: true; path: string }) => void;
    api.pick.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await render();
    await click();
    await act(async () =>
      useAcpProfilesStore.setState({ connectedDevices: [] }),
    );
    await act(async () => resolve({ ok: true, path: '/stale' }));
    expect(onPicked).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
  });

  it('reuses the same picker inside PathInput and preserves workspace picking', async () => {
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        <PathInput value="" onChange={onChange} targetAgentletId="remote" />,
      ),
    );
    expect(container.querySelector('input')).not.toBeNull();
    expect(container.querySelector('button')).toBeNull();
    await act(async () =>
      root.render(
        <PathInput value="" onChange={onChange} targetAgentletId="local" />,
      ),
    );
    await click();
    expect(onChange).toHaveBeenCalledWith('/picked');
    await act(async () =>
      root.render(<PathInput value="" onChange={onChange} />),
    );
    expect(container.querySelector('button')).not.toBeNull();
  });
});
