// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLLMStore } from './llmStore';
import {
  startOAuthLogin,
  getLLMImageConfig,
  getLLMConfig,
  getLLMProviders,
  getLLMModels,
  getLLMUtilityConfig,
  pollOAuthLogin,
} from '../api/llm';

vi.mock('../api/llm', () => ({
  getLLMConfig: vi.fn(),
  getLLMImageConfig: vi.fn(),
  getLLMModels: vi.fn(),
  getLLMProviders: vi.fn(),
  getLLMUtilityConfig: vi.fn(),
  logoutOAuth: vi.fn(),
  pollOAuthLogin: vi.fn(),
  putLLMConfig: vi.fn(),
  putLLMImageConfig: vi.fn(),
  putLLMUtilityConfig: vi.fn(),
  startOAuthLogin: vi.fn(),
}));

describe('independent image configuration', () => {
  it('loads image settings without requesting Pi providers, credentials or models', async () => {
    vi.clearAllMocks();
    useLLMStore.setState({
      imageConfig: null,
      imageError: null,
      imageLoading: false,
    });
    vi.mocked(getLLMImageConfig).mockResolvedValue({
      provider: 'azure-openai',
      model: 'image-model',
      authenticated: true,
    });
    await useLLMStore.getState().loadImageConfig();
    expect(useLLMStore.getState().imageConfig?.model).toBe('image-model');
    expect(getLLMConfig).not.toHaveBeenCalled();
    expect(getLLMProviders).not.toHaveBeenCalled();
    expect(getLLMModels).not.toHaveBeenCalled();
  });

  it('surfaces image configuration read failures independently', async () => {
    vi.mocked(getLLMImageConfig).mockRejectedValueOnce(
      new Error('Image config unavailable'),
    );
    await useLLMStore.getState().loadImageConfig();
    expect(useLLMStore.getState().imageError).toBe('Image config unavailable');
  });
});

describe('LLM store OAuth login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useLLMStore.setState({
      config: null,
      oauthPending: false,
      oauthUserCode: null,
      oauthVerificationUri: null,
      error: null,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stores the device code without opening a browser window', async () => {
    vi.mocked(startOAuthLogin).mockResolvedValue({
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      interval: 5,
    });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    await useLLMStore.getState().startOAuth();

    expect(useLLMStore.getState()).toMatchObject({
      oauthPending: true,
      oauthUserCode: 'ABCD-1234',
      oauthVerificationUri: 'https://github.com/login/device',
    });
    expect(open).not.toHaveBeenCalled();
  });

  it('logs into the selected utility provider and refreshes both model tiers after completion', async () => {
    useLLMStore.setState({
      config: { provider: 'openai', model: 'chat-model', authenticated: true },
      utilityConfig: {
        provider: 'github-copilot',
        model: 'utility-model',
        authenticated: false,
      },
    });
    vi.mocked(startOAuthLogin).mockResolvedValue({
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      interval: 5,
    });
    vi.mocked(pollOAuthLogin).mockResolvedValue({ status: 'complete' });
    vi.mocked(getLLMConfig).mockResolvedValue({
      provider: 'openai',
      model: 'chat-model',
      authenticated: true,
    });
    vi.mocked(getLLMUtilityConfig).mockResolvedValue({
      provider: 'github-copilot',
      model: 'utility-model',
      authenticated: true,
    });
    vi.mocked(getLLMModels).mockResolvedValue([]);

    await useLLMStore.getState().startOAuth('github-copilot');
    expect(startOAuthLogin).toHaveBeenCalledWith('github-copilot');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pollOAuthLogin).toHaveBeenCalledWith('github-copilot');
    expect(getLLMModels).toHaveBeenCalledWith('openai');
    expect(getLLMModels).toHaveBeenCalledWith('github-copilot');
    expect(useLLMStore.getState().utilityConfig?.authenticated).toBe(true);
    expect(useLLMStore.getState().config?.model).toBe('chat-model');
    expect(useLLMStore.getState().oauthPending).toBe(false);
  });
});
