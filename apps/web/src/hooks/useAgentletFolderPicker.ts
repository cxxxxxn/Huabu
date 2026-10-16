// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useAcpProfilesStore } from '@/store/acpProfilesStore';
import { useFolderPickerSupported } from '@/store/workspaceStore';
import { resolveConnectedDevice } from '@/utils/agentletDevice';

export function isAgentletFolderPickerSupported(
  target: string,
  state: Pick<
    ReturnType<typeof useAcpProfilesStore.getState>,
    'connectedDevices' | 'folderPickerAgentletId'
  >,
): boolean {
  const device = resolveConnectedDevice(target, state.connectedDevices);
  return !!device && device.agentletId === state.folderPickerAgentletId;
}

/** Undefined targets retain the workspace picker; explicit targets must match its filesystem. */
export function useAgentletFolderPicker(target?: string): boolean {
  const supported = useFolderPickerSupported();
  const matches = useAcpProfilesStore(
    (state) =>
      target === undefined || isAgentletFolderPickerSupported(target, state),
  );
  return supported && matches;
}
