// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLLMStore } from '@/store/llmStore';

import { BuiltinUtilityModelSettings, LLMSettings } from './LLMSettings';

import type { LLMProviderInfo, LLMUtilityConfigUpdate } from '@huabu/shared';

vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
vi.mock('@/components/Common/Toast', () => ({ toast: vi.fn() }));
vi.mock('@/components/Common/Loading', () => ({
  Loading: () => <span data-testid="loading-models" />,
}));
vi.mock('@/components/Common/Select', () => ({
  Select: ({
    options,
    value,
    onChange,
    ariaLabel,
    disabled,
  }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (value: string) => void;
    ariaLabel?: string;
    disabled?: boolean;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const originalState = useLLMStore.getState();
const providers: LLMProviderInfo[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    api: 'openai-completions',
    baseUrl: { overridable: true },
    builtIn: true,
    authType: 'api-key',
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    api: 'openai-completions',
    baseUrl: { overridable: false },
    builtIn: true,
    authType: 'oauth',
  },
];
const mocks = {
  init: vi.fn(async () => {}),
  updateChat: vi.fn(async () => {}),
  updateUtility: vi.fn(async (_update: LLMUtilityConfigUpdate) => {}),
  loadUtilityModels: vi.fn(async (_provider: string) => {}),
  startOAuth: vi.fn(async (_provider?: string) => {}),
};
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  useLLMStore.setState({
    ...originalState,
    config: { provider: 'openai', model: 'chat-model', authenticated: true },
    utilityConfig: { provider: '', model: '', authenticated: false },
    providers,
    models: [
      {
        id: 'chat-model',
        name: 'Chat model',
        provider: 'openai',
        reasoning: false,
        input: ['text'],
      },
    ],
    utilityModels: [
      {
        id: 'utility-model',
        name: 'Utility model',
        provider: 'openai',
        reasoning: false,
        input: ['text', 'image'],
      },
    ],
    init: mocks.init,
    updateConfig: mocks.updateChat,
    updateUtilityConfig: mocks.updateUtility,
    loadUtilityModels: mocks.loadUtilityModels,
    startOAuth: mocks.startOAuth,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useLLMStore.setState(originalState, true);
  vi.restoreAllMocks();
});

async function render(utility = true) {
  await act(async () =>
    root.render(utility ? <BuiltinUtilityModelSettings /> : <LLMSettings />),
  );
}

describe('Built-In model settings ownership', () => {
  it('renders only chat configuration in the Built-In detail view', async () => {
    await render(false);
    expect(container.textContent).toContain('settings.chatModel');
    expect(container.querySelector('[role="switch"]')).toBeNull();
    expect(container.textContent).not.toContain('settings.utilityModel');
    expect(container.textContent).not.toContain('settings.followChatModel');
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it('initializes utility controls without a second card or chat configuration', async () => {
    await render();
    expect(mocks.init).toHaveBeenCalledOnce();
    expect(container.querySelector('section')).toBeNull();
    expect(container.textContent).not.toContain('settings.chatModel');
    expect(
      container.querySelector('[role="switch"]')?.getAttribute('aria-checked'),
    ).toBe('true');
    expect(mocks.updateUtility).not.toHaveBeenCalled();
    expect(mocks.updateChat).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'can choose a custom utility provider with chat configured: %s',
    async (configured) => {
      if (!configured) useLLMStore.setState({ config: null });
      await render();
      const toggle =
        container.querySelector<HTMLButtonElement>('[role="switch"]');
      if (!toggle) throw new Error('Missing automatic utility model switch');
      await act(async () => toggle.click());
      expect(mocks.loadUtilityModels).toHaveBeenCalledWith('openai');
      expect(mocks.updateUtility).toHaveBeenCalledWith({
        provider: 'openai',
        model: '',
      });
      expect(mocks.updateChat).not.toHaveBeenCalled();
    },
  );

  it('saves a utility model without changing the chat model', async () => {
    useLLMStore.setState({
      utilityConfig: { provider: 'openai', model: '', authenticated: true },
    });
    await render();
    const selector = container.querySelector<HTMLSelectElement>(
      'select[aria-label="settings.model"]',
    );
    if (!selector) throw new Error('Missing utility model selector');
    await act(async () => {
      selector.value = 'utility-model';
      selector.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(mocks.updateUtility).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'utility-model',
    });
    expect(mocks.updateChat).not.toHaveBeenCalled();
    expect(useLLMStore.getState().config?.model).toBe('chat-model');
  });

  it('authenticates the utility provider and displays its device-code flow in place', async () => {
    useLLMStore.setState({
      utilityConfig: {
        provider: 'github-copilot',
        model: '',
        authenticated: false,
      },
    });
    await render();
    const login = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'settings.login',
    );
    if (!login) throw new Error('Missing utility login action');
    await act(async () => login.click());
    expect(mocks.startOAuth).toHaveBeenCalledWith('github-copilot');
    await act(async () => {
      useLLMStore.setState({
        oauthPending: true,
        oauthUserCode: 'ABCD-1234',
        oauthVerificationUri: 'https://github.com/login/device',
      });
    });
    expect(container.textContent).toContain('ABCD-1234');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const signIn = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'settings.openGitHub',
    );
    if (!signIn) throw new Error('Missing verification page action');
    await act(async () => signIn.click());
    expect(open).toHaveBeenCalledWith(
      'https://github.com/login/device',
      '_blank',
      'noopener',
    );
    expect(container.textContent).not.toContain('settings.chatModel');
  });

  it('does not show an automatic model as configured while utility settings are loading', async () => {
    useLLMStore.setState({ utilityConfig: null });
    await render();
    expect(container.querySelector('[role="switch"]')).toBeNull();
    await act(async () =>
      useLLMStore.setState({ error: 'Cannot load utility configuration' }),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Cannot load utility configuration',
    );
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'chat.retryAgentOptions',
    );
    if (!retry) throw new Error('Missing utility configuration retry');
    await act(async () => retry.click());
    expect(mocks.init).toHaveBeenCalledTimes(2);
  });
});
