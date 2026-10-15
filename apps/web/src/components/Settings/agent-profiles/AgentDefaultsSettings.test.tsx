// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentDefaultsSettings } from './AgentDefaultsSettings';

import type {
  AgentDefaults,
  AgentDefaultsResponse,
  AgentProfileView,
} from '@huabu/shared';
import type { Root } from 'react-dom/client';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  loadCapabilities: vi.fn(),
  state: {
    profiles: [] as AgentProfileView[],
    loaded: true,
    error: null as Error | null,
    refresh: vi.fn(async () => {}),
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { id?: string }) =>
      values?.id ? `${key}:${values.id}` : key,
  }),
}));
vi.mock('@/api/acp', () => ({
  loadAcpProfileCapabilities: mocks.loadCapabilities,
}));
vi.mock('@/store/acpProfilesStore', () => ({
  useAcpProfilesStore: (
    selector: (
      state: typeof mocks.state & {
        loadDefaults: typeof mocks.get;
        saveDefaults: typeof mocks.update;
      },
    ) => unknown,
  ) =>
    selector({
      ...mocks.state,
      loadDefaults: mocks.get,
      saveDefaults: mocks.update,
    }),
}));
vi.mock('@/components/Common/Select', () => ({
  Select: ({
    options,
    value,
    onChange,
    ariaLabel,
    disabled,
  }: {
    options: { value: string; label: string; disabled?: boolean }[];
    value: string;
    onChange: (value: string) => void;
    ariaLabel: string;
    disabled: boolean;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option
          key={option.value}
          value={option.value}
          disabled={option.disabled}
        >
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const initial: AgentDefaultsResponse = {
  defaults: { profileId: 'external', functionalModel: 'fast' },
  selectionState: 'available',
  modelCapability: 'supported',
};
const observation = {
  source: 'profile',
  sessionMeta: {
    availableModes: [],
    currentModeId: null,
    availableModels: [
      { modelId: 'fast', name: 'Fast' },
      { modelId: 'other', name: 'Other' },
    ],
    currentModelId: 'other',
    configOptions: [],
    selections: {},
    sessionInfo: null,
    usage: null,
    updatedAt: 1,
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue(initial);
  mocks.update.mockImplementation(async (defaults: AgentDefaults) => ({
    ...initial,
    defaults,
  }));
  mocks.loadCapabilities.mockResolvedValue(observation);
  mocks.state.profiles = [
    {
      id: 'external',
      alias: 'External Agent',
      agentletId: 'machine',
      workingDirPath: '/work',
      launch: { kind: 'acp-harness', harnessId: 'copilot' },
    },
  ];
  mocks.state.loaded = true;
  mocks.state.error = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render() {
  await act(async () => root.render(<AgentDefaultsSettings />));
}
function modelSelect() {
  return container.querySelector<HTMLSelectElement>(
    'select[aria-label="settings.agentDefaultsModel"]',
  );
}
async function select(value: string, model = false) {
  await act(async () => {
    const element = model ? modelSelect() : container.querySelector('select');
    if (!element) throw new Error('Missing selector');
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('Utility Agent model catalogue', () => {
  it('loads a Profile catalogue automatically and shows a selector, not an input', async () => {
    await render();
    expect(mocks.loadCapabilities).toHaveBeenCalledExactlyOnceWith('external');
    expect(container.querySelector('input')).toBeNull();
    expect(modelSelect()?.textContent).toContain('Fast');
    expect(modelSelect()?.value).toBe('fast');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('normalizes modern grouped config options through the shared selector builder', async () => {
    mocks.loadCapabilities.mockResolvedValue({
      ...observation,
      sessionMeta: {
        ...observation.sessionMeta,
        availableModels: [],
        configOptions: [
          {
            id: 'model_id',
            name: 'Model',
            category: 'model',
            type: 'select',
            currentValue: 'fast',
            options: [
              {
                group: 'premium',
                name: 'Premium',
                options: [{ value: 'fast', name: 'Fast model' }],
              },
            ],
          },
        ],
      },
    });
    await render();
    expect(modelSelect()?.textContent).toContain('Fast model');
    await select('fast', true);
    expect(mocks.update).toHaveBeenCalledWith({
      profileId: 'external',
      functionalModel: 'fast',
    });
  });

  it('saves a chosen model immediately without adopting the probe current value', async () => {
    await render();
    expect(modelSelect()?.value).toBe('fast');
    await select('other', true);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      profileId: 'external',
      functionalModel: 'other',
    });
  });

  it('keeps the empty value for following the default model', async () => {
    await render();
    await select('', true);
    expect(mocks.update).toHaveBeenCalledWith({
      profileId: 'external',
      functionalModel: '',
    });
    expect(modelSelect()?.value).toBe('');
  });

  it('shows loading without saving or blocking the Profile picker', async () => {
    mocks.loadCapabilities.mockReturnValue(new Promise(() => {}));
    await render();
    expect(modelSelect()?.disabled).toBe(true);
    expect(container.querySelector('select')?.disabled).toBe(false);
    expect(container.textContent).toContain('chat.loadingAgentOptionsProgress');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('reports an empty model list separately from errors and retains a saved model', async () => {
    mocks.loadCapabilities.mockResolvedValue({
      ...observation,
      sessionMeta: { ...observation.sessionMeta, availableModels: [] },
    });
    await render();
    expect(container.textContent).toContain('settings.agentDefaultsNoModels');
    expect(modelSelect()?.value).toBe('fast');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('retains unavailable saved IDs rather than silently choosing another model', async () => {
    mocks.get.mockResolvedValue({
      ...initial,
      defaults: { profileId: 'external', functionalModel: 'retired' },
    });
    await render();
    expect(modelSelect()?.value).toBe('retired');
    expect(container.textContent).toContain(
      'settings.agentDefaultsModelUnavailable',
    );
    expect(
      modelSelect()?.querySelector<HTMLOptionElement>('option[value="retired"]')
        ?.disabled,
    ).toBe(true);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('surfaces discovery failure and retries explicitly', async () => {
    mocks.loadCapabilities.mockRejectedValueOnce(new Error('Please log in'));
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Please log in',
    );
    await act(async () => {
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'chat.retryAgentOptions')
        ?.click();
    });
    expect(mocks.loadCapabilities).toHaveBeenCalledTimes(2);
    expect(modelSelect()?.textContent).toContain('Fast');
  });

  it('does not offer model overrides for custom command Profiles even if previously reported supported', async () => {
    mocks.state.profiles[0].launch = {
      kind: 'acp-command',
      command: 'copilot --acp',
    };
    await render();
    expect(modelSelect()?.disabled).toBe(true);
    expect(mocks.loadCapabilities).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      'settings.agentDefaultsModelUnsupported',
    );
  });

  it('keeps the standard inline row and puts wrapping feedback outside the control column', async () => {
    mocks.state.profiles[0].launch = {
      kind: 'acp-command',
      command: 'copilot --acp',
    };
    await render();
    const row = modelSelect()?.parentElement?.parentElement?.parentElement;
    const profileRow =
      container.querySelector('select')?.parentElement?.parentElement;
    expect(row?.className).toBe(profileRow?.className);
    expect(row?.classList.contains('items-center')).toBe(true);
    expect(row?.classList.contains('flex-col')).toBe(false);
    expect(modelSelect()?.parentElement?.classList.contains('w-40')).toBe(true);
    const warning = [...container.querySelectorAll('[role="status"]')].find(
      (element) =>
        element.textContent === 'settings.agentDefaultsModelUnsupported',
    );
    expect(warning?.parentElement?.previousElementSibling).toBe(row);
    expect(
      warning?.parentElement?.classList.contains('[overflow-wrap:anywhere]'),
    ).toBe(true);
    expect(row?.querySelector('[role="status"]')).toBeNull();
  });

  it('clears a prior Profile model when choosing a different external Profile', async () => {
    mocks.state.profiles.push({ ...mocks.state.profiles[0], id: 'second' });
    await render();
    await select('second');
    expect(mocks.update).toHaveBeenLastCalledWith({
      profileId: 'second',
      functionalModel: '',
    });
    expect(mocks.loadCapabilities).toHaveBeenLastCalledWith('second');
  });

  it('does not apply a late catalogue after switching Profiles', async () => {
    let finish!: (value: typeof observation) => void;
    mocks.loadCapabilities.mockImplementationOnce(
      () =>
        new Promise<typeof observation>((resolve) => {
          finish = resolve;
        }),
    );
    mocks.state.profiles.push({ ...mocks.state.profiles[0], id: 'second' });
    await render();
    await select('second');
    await act(async () =>
      finish({
        ...observation,
        sessionMeta: {
          ...observation.sessionMeta,
          availableModels: [{ modelId: 'wrong', name: 'Wrong' }],
        },
      }),
    );
    expect(modelSelect()?.textContent).not.toContain('Wrong');
  });

  it('leaves Built-In Pi on its existing LLM settings path', async () => {
    mocks.get.mockResolvedValue({
      ...initial,
      defaults: { profileId: 'huabu', functionalModel: '' },
    });
    await render();
    expect(modelSelect()).toBeNull();
    expect(mocks.loadCapabilities).not.toHaveBeenCalled();
  });

  it('preserves missing Profile selections and does not probe them', async () => {
    mocks.get.mockResolvedValue({
      ...initial,
      defaults: { profileId: 'deleted', functionalModel: '' },
      selectionState: 'deleted',
    });
    await render();
    expect(container.textContent).toContain('settings.agentDefaultsDeleted');
    expect(modelSelect()?.disabled).toBe(true);
    expect(mocks.loadCapabilities).not.toHaveBeenCalled();
  });

  it('does not treat an unloaded catalogue as a deleted Profile', async () => {
    mocks.state.loaded = false;
    mocks.state.profiles = [];
    await render();
    expect(container.textContent).not.toContain(
      'settings.agentDefaultsDeleted',
    );
    expect(modelSelect()?.disabled).toBe(true);
    expect(container.querySelector('select')?.disabled).toBe(false);
    expect(mocks.loadCapabilities).not.toHaveBeenCalled();
  });

  it('retains failed model drafts and offers save retry', async () => {
    mocks.update.mockRejectedValueOnce(new Error('disk is read-only'));
    await render();
    await select('other', true);
    expect(container.textContent).toContain('disk is read-only');
    expect(modelSelect()?.value).toBe('other');
    await act(async () => {
      [...container.querySelectorAll('button')]
        .find(
          (button) => button.textContent === 'settings.agentDefaultsRetrySave',
        )
        ?.click();
    });
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('does not let an old save response replace a newer selection', async () => {
    let finish!: (value: AgentDefaultsResponse) => void;
    mocks.update.mockImplementationOnce(
      () =>
        new Promise<AgentDefaultsResponse>((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    await select('other', true);
    await select('fast', true);
    await act(async () =>
      finish({
        ...initial,
        defaults: { profileId: 'external', functionalModel: 'other' },
      }),
    );
    expect(modelSelect()?.value).toBe('fast');
  });

  it('shows configuration load errors without an editable fallback', async () => {
    mocks.get.mockRejectedValue(new Error('Invalid Agent defaults file'));
    await render();
    expect(container.textContent).toContain('Invalid Agent defaults file');
    expect(modelSelect()).toBeNull();
    expect(mocks.loadCapabilities).not.toHaveBeenCalled();
  });
});
