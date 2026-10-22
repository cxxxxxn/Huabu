// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/Common/Button';
import { SettingRow } from '@/components/Settings/Common/SettingRow';
import {
  getElectronBridge,
  type ElectronLocalAgentState,
} from '@/hooks/useElectron';
import { useAcpProfilesStore } from '@/store/acpProfilesStore';

const STATUS_KEYS = {
  disabled: 'settings.localAgentDisabled',
  connecting: 'settings.localAgentConnecting',
  connected: 'settings.localAgentConnected',
  reconnecting: 'settings.localAgentReconnecting',
  stopping: 'settings.localAgentStopping',
  'authorization-required': 'settings.localAgentAuthorizationRequired',
  error: 'settings.localAgentError',
} as const;

export function LocalAgentConnectionSetting() {
  const { t } = useTranslation();
  const bridge = getElectronBridge();
  const api = bridge?.isRemoteServer ? bridge.localAgent : undefined;
  const refresh = useAcpProfilesStore((state) => state.refresh);
  const [state, setState] = useState<ElectronLocalAgentState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    let active = true;
    let receivedEvent = false;
    const unsubscribe = api.onState((next) => {
      receivedEvent = true;
      setState(next);
      setError(null);
      if (next.status === 'connected') void refresh({ background: true });
    });
    void api.getState().then(
      (next) => {
        if (active && !receivedEvent) setState(next);
      },
      (reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api, refresh]);

  if (!api) return null;
  const busy = pending || state?.status === 'stopping';
  const needsRetry =
    state?.status === 'error' || state?.status === 'authorization-required';
  const changeConnection = async (enabled: boolean) => {
    setPending(true);
    setError(null);
    try {
      setState(await api.setEnabled(enabled));
      await refresh({ background: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  };
  const message = error ?? state?.error;

  return (
    <SettingRow
      title={t('settings.localAgentTitle')}
      description={t('settings.localAgentDescription')}
      layout="stacked"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span role="status" className="text-fg-muted text-xs">
          {t(state ? STATUS_KEYS[state.status] : 'settings.loadingAgents')}
        </span>
        <div className="flex flex-wrap gap-2">
          {state?.enabled && needsRetry ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void changeConnection(true)}
            >
              {t('settings.localAgentReconnect')}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={busy || (!state && !error)}
            onClick={() => {
              if (state) {
                void changeConnection(!state.enabled);
              } else {
                setPending(true);
                void api
                  .getState()
                  .then(
                    (next) => {
                      setState(next);
                      setError(null);
                    },
                    (reason: unknown) =>
                      setError(
                        reason instanceof Error
                          ? reason.message
                          : String(reason),
                      ),
                  )
                  .finally(() => setPending(false));
              }
            }}
          >
            {t(
              !state && error
                ? 'settings.retrySave'
                : state?.enabled
                  ? 'settings.localAgentDisconnect'
                  : 'settings.localAgentConnect',
            )}
          </Button>
        </div>
      </div>
      {message ? (
        <p
          role="alert"
          className="text-danger mt-2 text-xs [overflow-wrap:anywhere]"
        >
          {message}
        </p>
      ) : null}
    </SettingRow>
  );
}
