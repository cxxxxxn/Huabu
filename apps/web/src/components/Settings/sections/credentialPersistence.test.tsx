// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getIntegrationsConfig,
  putIntegrationsConfig,
} from '@/api/integrations';
import {
  getLLMImageConfig,
  getLLMModels,
  putLLMConfig,
  putLLMImageConfig,
  putLLMUtilityConfig,
} from '@/api/llm';
import { useIntegrationsStore } from '@/store/integrationsStore';
import { useLLMStore } from '@/store/llmStore';

import { ImageProviderSettings } from './ImageProviderSettings';
import { IntegrationsSettings } from './IntegrationsSettings';
import { BuiltinUtilityModelSettings, LLMSettings } from './LLMSettings';

import type * as LLMApi from '@/api/llm';

vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
vi.mock('@/components/Common/Toast', () => ({ toast: vi.fn() }));
vi.mock('@/components/Common/Loading', () => ({
  Loading: () => <span />,
}));
vi.mock('@/store/deploymentReadinessStore', () => ({
  useDeploymentReadinessStore: (
    selector: (state: {
      readiness: { credentials: { writable: boolean } };
    }) => unknown,
  ) => selector({ readiness: { credentials: { writable: true } } }),
}));
vi.mock('@/api/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof LLMApi>()),
  getLLMImageConfig: vi.fn(),
  getLLMModels: vi.fn(),
  putLLMConfig: vi.fn(),
  putLLMImageConfig: vi.fn(),
  putLLMUtilityConfig: vi.fn(),
}));
vi.mock('@/api/integrations', () => ({
  getIntegrationsConfig: vi.fn(),
  putIntegrationsConfig: vi.fn(),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const originalLLM = useLLMStore.getState();
const originalIntegrations = useIntegrationsStore.getState();
const config = {
  provider: 'openai',
  model: 'test-model',
  authenticated: true,
};
const imageConfig = { ...config, provider: 'azure-openai' };
const integrationsConfig = { hasTavilyKey: true, hasRapidApiKey: true };
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.resetAllMocks();
  useLLMStore.setState({
    ...originalLLM,
    config,
    utilityConfig: config,
    imageConfig,
    init: vi.fn(async () => {}),
    providers: ['openai', 'azure-openai'].map((id) => ({
      id,
      name: id,
      api: 'openai-completions',
      baseUrl: { overridable: true },
      builtIn: true,
      authType: 'api-key',
    })),
  });
  useIntegrationsStore.setState({
    ...originalIntegrations,
    config: integrationsConfig,
  });
  vi.mocked(getLLMModels).mockResolvedValue([]);
  vi.mocked(getLLMImageConfig).mockResolvedValue(imageConfig);
  vi.mocked(getIntegrationsConfig).mockResolvedValue(integrationsConfig);
  vi.mocked(putLLMConfig).mockImplementation(async (update) => ({
    ...config,
    provider: update.provider,
  }));
  vi.mocked(putLLMUtilityConfig).mockImplementation(async (update) => ({
    ...config,
    provider: update.provider,
  }));
  vi.mocked(putLLMImageConfig).mockResolvedValue(imageConfig);
  vi.mocked(putIntegrationsConfig).mockResolvedValue(integrationsConfig);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useLLMStore.setState(originalLLM, true);
  useIntegrationsStore.setState(originalIntegrations, true);
});

function button(scope: ParentNode, label: string) {
  const result = [...scope.querySelectorAll('button')].find(
    (element) =>
      element.textContent === label ||
      element.getAttribute('aria-label') === label,
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

function password(scope: ParentNode) {
  const result = scope.querySelector<HTMLInputElement>(
    'input[type="password"]',
  );
  if (!result) throw new Error('Missing credential editor');
  return result;
}

async function enterKey(scope: ParentNode) {
  const field = password(scope);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set?.call(field, 'draft-key');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return field;
}

const cases = [
  { surface: 'chat', provider: 'openai', remove: false },
  { surface: 'chat', provider: 'azure-openai', remove: false },
  { surface: 'utility', provider: 'openai', remove: false },
  { surface: 'utility', provider: 'azure-openai', remove: false },
  { surface: 'image', provider: 'azure-openai', remove: false },
  { surface: 'image', provider: 'azure-openai', remove: true },
  { surface: 'tavily', provider: '', remove: false },
  { surface: 'tavily', provider: '', remove: true },
  { surface: 'rapidapi', provider: '', remove: false },
  { surface: 'rapidapi', provider: '', remove: true },
] as const;

describe('credential persistence acknowledgements through real stores', () => {
  it.each(cases)(
    '$surface $provider (remove=$remove) keeps failed edits and closes only after a successful retry',
    async ({ surface, provider, remove }) => {
      useLLMStore.setState({
        config: { ...config, provider },
        utilityConfig: { ...config, provider },
      });
      const write =
        surface === 'chat'
          ? vi.mocked(putLLMConfig)
          : surface === 'utility'
            ? vi.mocked(putLLMUtilityConfig)
            : surface === 'image'
              ? vi.mocked(putLLMImageConfig)
              : vi.mocked(putIntegrationsConfig);
      let rejectWrite: ((error: Error) => void) | undefined;
      write.mockImplementationOnce(
        () =>
          new Promise<never>((_resolve, reject) => {
            rejectWrite = reject;
          }),
      );
      await act(async () =>
        root.render(
          surface === 'chat' ? (
            <LLMSettings />
          ) : surface === 'utility' ? (
            <BuiltinUtilityModelSettings />
          ) : surface === 'image' ? (
            <ImageProviderSettings />
          ) : (
            <IntegrationsSettings />
          ),
        ),
      );
      if (surface === 'image') {
        await act(async () =>
          button(container, 'settings.imageGeneration').click(),
        );
      }
      const title =
        surface === 'tavily'
          ? 'settings.webSearch'
          : surface === 'rapidapi'
            ? 'settings.youtubeTranscripts'
            : 'settings.apiKey';
      const row = [...container.querySelectorAll('.setting-row')].find(
        (element) => element.querySelector('p')?.textContent === title,
      );
      if (!row) throw new Error('Missing credential row');
      await act(async () => button(row, 'settings.updateKey').click());
      await enterKey(row);
      if (remove) {
        await act(async () => button(row, 'settings.removeKey').click());
      }
      const submit = button(row, remove ? 'actions.delete' : 'actions.save');
      await act(async () => {
        submit.click();
        submit.click();
      });
      expect(write).toHaveBeenCalledOnce();
      expect(submit.disabled).toBe(true);
      if (!remove) expect(password(row).value).toBe('draft-key');
      expect(getLLMModels).not.toHaveBeenCalled();

      if (!rejectWrite) throw new Error('Missing pending credential write');
      await act(async () =>
        rejectWrite?.(new Error('Credential write failed')),
      );
      expect(row.querySelector('[role="alert"]')?.textContent).toBe(
        'Credential write failed',
      );
      expect(submit.disabled).toBe(false);
      if (remove) {
        expect(row.textContent).toContain('settings.confirmRemoveKey');
      } else {
        expect(password(row).value).toBe('draft-key');
      }
      expect(getLLMModels).not.toHaveBeenCalled();
      const key =
        surface === 'tavily'
          ? 'tavilyApiKey'
          : surface === 'rapidapi'
            ? 'rapidApiKey'
            : 'apiKey';
      const expectedValue = remove ? null : 'draft-key';
      expect(write).toHaveBeenLastCalledWith(
        expect.objectContaining({ [key]: expectedValue }),
      );
      await act(async () => submit.click());
      expect(write).toHaveBeenCalledTimes(2);
      expect(row.querySelector('input[type="password"]')).toBeNull();
      expect(row.textContent).not.toContain('settings.confirmRemoveKey');
      expect(row.querySelector('[role="alert"]')).toBeNull();
      expect(getLLMModels).toHaveBeenCalledTimes(
        surface === 'utility' ||
          (surface === 'chat' && provider !== 'azure-openai')
          ? 1
          : 0,
      );
      await act(async () => button(row, 'settings.updateKey').click());
      expect(password(row).value).toBe('');
      await act(async () => button(row, 'actions.cancel').click());
      expect(write).toHaveBeenCalledTimes(2);
    },
  );

  it('does not treat a model catalogue failure as a failed credential write', async () => {
    vi.mocked(getLLMModels).mockRejectedValue(
      new Error('Catalogue unavailable'),
    );
    await act(async () => root.render(<LLMSettings />));
    await act(async () => button(container, 'settings.updateKey').click());
    await enterKey(container);
    await act(async () => button(container, 'actions.save').click());
    expect(putLLMConfig).toHaveBeenCalledWith({
      provider: 'openai',
      apiKey: 'draft-key',
    });
    expect(useLLMStore.getState().error).toBe('Catalogue unavailable');
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });
});
