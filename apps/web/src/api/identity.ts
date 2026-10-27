// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { apiFetch } from './_client';
import { API_CONFIG } from '../config/api';

import type { IdentityResponse } from '@huabu/shared';

/** One way Bubble accepts a human login, as its credential-free discovery reports it. */
export interface InteractiveAuthenticator {
  driver: string;
  issuer: string;
  authorizationUrl: string;
  clientId: string;
  scopes: string[];
  audience?: string;
}

/** The caller as the Server resolves it, or `null` when it asks for a login. */
export async function getIdentity(): Promise<IdentityResponse | null> {
  const response = await fetch(`${API_CONFIG.API_URL}/identity`);
  if (response.status === 401) return null;
  if (!response.ok)
    throw new Error(`Identity request failed: ${response.status}`);
  return (await response.json()) as IdentityResponse;
}

/**
 * Bubble's browser logins, or `null` when this Server does not run Bubble,
 * which is how a local deployment's login prompt is told apart from Bubble's.
 */
export async function listInteractiveAuthenticators(): Promise<
  InteractiveAuthenticator[] | null
> {
  const response = await fetch(
    `${API_CONFIG.BASE_URL}/bubble/v1/auth/authenticators`,
  );
  if (!response.ok) return null;
  const body = (await response.json()) as {
    authenticators?: Array<
      Partial<InteractiveAuthenticator> & { interactive?: boolean }
    >;
  };
  return (body.authenticators ?? []).flatMap((entry) =>
    entry.interactive &&
    entry.driver &&
    entry.issuer &&
    entry.authorizationUrl &&
    entry.clientId
      ? [
          {
            driver: entry.driver,
            issuer: entry.issuer,
            authorizationUrl: entry.authorizationUrl,
            clientId: entry.clientId,
            scopes: entry.scopes ?? [],
            ...(entry.audience ? { audience: entry.audience } : {}),
          },
        ]
      : [],
  );
}

/** Hand an access token to the Server, which keeps it in an HttpOnly cookie. */
export async function startSession(accessToken: string): Promise<void> {
  await apiFetch<void>('/identity/session', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    fallbackMessage: 'Sign-in was not accepted',
  });
}

export async function endSession(): Promise<void> {
  await apiFetch<void>('/identity/session', { method: 'DELETE' });
}

/** End the Server session and start again from the sign-in screen. */
export async function signOut(): Promise<void> {
  await endSession().catch(() => {});
  window.location.assign('/');
}
