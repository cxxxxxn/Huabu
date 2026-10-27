// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SignInGate } from './SignInGate';
import { AUTH_REQUIRED_EVENT } from '../../api/_client';
import { useIdentityStore } from '../../store/identityStore';

// The brand animation draws on a canvas the test DOM does not provide.
vi.mock('../../pages/WorkspaceLoadingScreen', () => ({
  WorkspaceLoadingScreen: () => null,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key} ${Object.values(values).join(' ')}` : key,
  }),
}));

const MEMBER = {
  provider: 'bubble',
  principal: { principalId: 'carol', kind: 'user', displayName: 'Carol' },
  member: true,
  owner: false,
};
const ENTRA = {
  driver: 'entra',
  interactive: true,
  issuer: 'https://login.example/tenant/v2.0',
  authorizationUrl: 'https://login.example/tenant/authorize',
  clientId: 'spa',
  scopes: ['api://huabu/access'],
};

type Route = (init?: RequestInit) => Response;
let routes: Record<string, Route>;
let calls: Array<{ url: string; init?: RequestInit }>;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  calls = [];
  routes = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const key = `${init?.method ?? 'GET'} ${url}`;
      const route = routes[key];
      if (!route) throw new Error(`Unexpected request ${key}`);
      return route(init);
    }),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  useIdentityStore.setState({ identity: null });
  sessionStorage.clear();
  window.history.replaceState(null, '', '/spaces');
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => {
    root.render(
      <SignInGate>
        <p>app</p>
      </SignInGate>,
    );
  });
  // Let the identity checks settle.
  for (let i = 0; i < 5; i++) await act(async () => {});
}

describe('SignInGate', () => {
  it('renders the app at once for a resolved member', async () => {
    routes['GET /api/identity'] = () => json(MEMBER);
    await mount();
    expect(container.textContent).toBe('app');
    expect(useIdentityStore.getState().identity).toEqual(MEMBER);
  });

  it('leaves a login prompt to the browser when the Server does not run Bubble', async () => {
    routes['GET /api/identity'] = () => json({}, 401);
    routes['GET /bubble/v1/auth/authenticators'] = () => json({}, 404);
    await mount();
    expect(container.textContent).toBe('app');
  });

  it('explains a Bubble Server that offers no browser login instead of rendering the app', async () => {
    routes['GET /api/identity'] = () => json({}, 401);
    routes['GET /bubble/v1/auth/authenticators'] = () =>
      json({ authenticators: [{ driver: 'master-key', interactive: false }] });
    await mount();
    expect(container.textContent).toContain('auth.noSignInMethods');
    expect(container.textContent).not.toContain('app');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('offers each interactive Bubble login and tells a non-member they lack access', async () => {
    routes['GET /api/identity'] = () => json({}, 401);
    routes['GET /bubble/v1/auth/authenticators'] = () =>
      json({
        authenticators: [ENTRA, { driver: 'master-key', interactive: false }],
      });
    await mount();
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual([
      'auth.continueWith Microsoft Entra ID',
    ]);

    routes['GET /api/identity'] = () => json({ ...MEMBER, member: false });
    await act(async () => {
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    });
    for (let i = 0; i < 5; i++) await act(async () => {});
    expect(container.textContent).toContain('auth.noAccessTitle');
    expect(container.textContent).toContain('Carol');
  });

  it('completes a provider redirect by handing the token to the Server', async () => {
    sessionStorage.setItem(
      'huabu.oidc.pending',
      JSON.stringify({
        state: 'expected',
        verifier: 'verifier',
        authenticator: ENTRA,
        returnTo: '/canvas/mine',
      }),
    );
    window.history.replaceState(
      null,
      '',
      '/auth/callback?code=the-code&state=expected',
    );
    routes[
      'GET https://login.example/tenant/v2.0/.well-known/openid-configuration'
    ] = () => json({ token_endpoint: 'https://login.example/token' });
    routes['POST https://login.example/token'] = () =>
      json({ access_token: 'access' });
    routes['POST /api/identity/session'] = () =>
      new Response(null, { status: 204 });
    routes['GET /api/identity'] = () => json(MEMBER);
    await mount();

    expect(container.textContent).toBe('app');
    expect(window.location.pathname).toBe('/canvas/mine');
    const exchange = calls.find(
      (call) => call.url === 'https://login.example/token',
    );
    expect(
      Object.fromEntries(new URLSearchParams(String(exchange?.init?.body))),
    ).toMatchObject({
      grant_type: 'authorization_code',
      code: 'the-code',
      code_verifier: 'verifier',
      client_id: 'spa',
      redirect_uri: `${window.location.origin}/auth/callback`,
    });
    const session = calls.find((call) => call.url === '/api/identity/session');
    expect(new Headers(session?.init?.headers).get('Authorization')).toBe(
      'Bearer access',
    );
    expect(sessionStorage.getItem('huabu.oidc.pending')).toBeNull();
  });

  it('ignores a redirect whose state it did not issue', async () => {
    sessionStorage.setItem(
      'huabu.oidc.pending',
      JSON.stringify({
        state: 'expected',
        verifier: 'v',
        authenticator: ENTRA,
        returnTo: '/',
      }),
    );
    window.history.replaceState(
      null,
      '',
      '/auth/callback?code=forged&state=other',
    );
    routes['GET /api/identity'] = () => json(MEMBER);
    await mount();
    expect(calls.map((call) => call.url)).toEqual(['/api/identity']);
  });
});
