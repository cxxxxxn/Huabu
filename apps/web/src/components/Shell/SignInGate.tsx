// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AUTH_REQUIRED_EVENT } from '../../api/_client';
import {
  getIdentity,
  listInteractiveAuthenticators,
  signOut,
  startSession,
  type InteractiveAuthenticator,
} from '../../api/identity';
import { APP_NAME } from '../../config/app';
import { WorkspaceLoadingScreen } from '../../pages/WorkspaceLoadingScreen';
import { useIdentityStore } from '../../store/identityStore';
import { beginLogin, completeLogin } from '../../utils/oidcLogin';
import { Button } from '../Common/Button';

import type { IdentityResponse } from '@huabu/shared';
import type { ReactNode } from 'react';

type GateState =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | {
      kind: 'signIn';
      authenticators: InteractiveAuthenticator[];
      error?: string;
    }
  | { kind: 'noAccess'; identity: IdentityResponse };

const PROVIDER_NAMES: Record<string, string> = {
  entra: 'Microsoft Entra ID',
  auth0: 'Auth0',
};

/**
 * Admits the app once the Server knows who is calling. A local deployment
 * resolves at once and renders exactly as before; under Bubble identity a
 * caller without a session signs in through the provider Bubble names, and
 * one without Huabu access is told so instead of meeting failing requests.
 */
export function SignInGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: 'checking' });
  const setIdentity = useIdentityStore((s) => s.setIdentity);

  const check = useCallback(
    async (loginError?: string) => {
      let identity: IdentityResponse | null;
      try {
        identity = await getIdentity();
      } catch {
        // An unreachable Server is the app's own error to report, as before.
        setState({ kind: 'ready' });
        return;
      }
      if (identity) {
        setIdentity(identity);
        setState(
          identity.member ? { kind: 'ready' } : { kind: 'noAccess', identity },
        );
        return;
      }
      const authenticators = await listInteractiveAuthenticators();
      // Without Bubble a login prompt belongs to the browser (Basic Auth).
      if (authenticators.length === 0) {
        setState({ kind: 'ready' });
        return;
      }
      setState({ kind: 'signIn', authenticators, error: loginError });
    },
    [setIdentity],
  );

  useEffect(() => {
    void (async () => {
      let loginError: string | undefined;
      try {
        const token = await completeLogin();
        if (token) await startSession(token);
      } catch (error) {
        loginError = error instanceof Error ? error.message : String(error);
      }
      await check(loginError);
    })();
  }, [check]);

  useEffect(() => {
    const recheck = () => void check();
    window.addEventListener(AUTH_REQUIRED_EVENT, recheck);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, recheck);
  }, [check]);

  if (state.kind === 'ready') return <>{children}</>;
  if (state.kind === 'checking') return <WorkspaceLoadingScreen />;
  return <SignInScreen state={state} />;
}

/** The sign-in and no-access screens, in the Welcome page's frame. */
export function SignInScreen({
  state,
}: {
  state: Exclude<GateState, { kind: 'checking' | 'ready' }>;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<string | null>(null);

  const title =
    state.kind === 'signIn'
      ? t('auth.signInTitle', { appName: APP_NAME })
      : t('auth.noAccessTitle');
  const intro =
    state.kind === 'signIn'
      ? t('auth.signInIntro')
      : t('auth.noAccessIntro', {
          name:
            state.identity.principal.displayName ??
            state.identity.principal.email ??
            state.identity.principal.principalId,
          appName: APP_NAME,
        });

  return (
    <div className="bg-bg-default flex h-full items-center justify-center">
      <div className="w-full max-w-md px-6">
        <div className="mb-10 text-center">
          <img
            src="/favicon.svg"
            alt={APP_NAME}
            className="mx-auto mb-4 h-16 w-16"
          />
          <h1 className="text-fg-default text-2xl font-bold">{title}</h1>
          <p className="text-fg-subtle mt-2 text-sm">{intro}</p>
        </div>

        {state.kind === 'signIn' ? (
          <div className="space-y-2">
            {state.authenticators.map((authenticator) => (
              <Button
                key={`${authenticator.driver}:${authenticator.issuer}`}
                variant="outline"
                tone="neutral"
                size="lg"
                className="w-full"
                disabled={pending !== null}
                onClick={() => {
                  setPending(authenticator.issuer);
                  void beginLogin(authenticator).catch(() => setPending(null));
                }}
              >
                {pending === authenticator.issuer
                  ? t('auth.signingIn')
                  : t('auth.continueWith', {
                      provider:
                        PROVIDER_NAMES[authenticator.driver] ??
                        authenticator.driver,
                    })}
              </Button>
            ))}
          </div>
        ) : (
          <Button
            variant="outline"
            tone="neutral"
            size="lg"
            className="w-full"
            onClick={() => void signOut()}
          >
            {t('auth.signOut')}
          </Button>
        )}

        {state.kind === 'signIn' && state.error && (
          <p
            className="text-danger-fg mt-3 text-center text-xs"
            role="alert"
            aria-live="assertive"
          >
            {t('auth.signInFailed', { message: state.error })}
          </p>
        )}
      </div>
    </div>
  );
}
