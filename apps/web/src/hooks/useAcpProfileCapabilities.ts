// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useCallback, useEffect, useState } from 'react';

import { loadAcpProfileCapabilities } from '@/api/acp';

import type { AcpProfileCapabilitiesResponse } from '@huabu/shared';

export function useAcpProfileCapabilities(
  profileId: string | null,
  enabled = true,
) {
  const [state, setState] = useState<{
    profileId: string | null;
    data: AcpProfileCapabilitiesResponse | null;
    loading: boolean;
    error: Error | null;
  }>({ profileId: null, data: null, loading: false, error: null });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (!profileId || !enabled) return;
    setState({ profileId, data: null, loading: true, error: null });
    void loadAcpProfileCapabilities(profileId).then(
      (data) => {
        if (!cancelled)
          setState({ profileId, data, loading: false, error: null });
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({
            profileId,
            data: null,
            loading: false,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [profileId, enabled, attempt]);

  const current = enabled && !!profileId && state.profileId === profileId;
  return {
    data: current ? state.data : null,
    loading: enabled && !!profileId && (!current || state.loading),
    error: current ? state.error : null,
    retry,
  };
}
