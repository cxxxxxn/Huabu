// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createConnectionCommand,
  getRuntimeConfig,
  updateRuntimeConfig,
  toast,
} = vi.hoisted(() => ({
  createConnectionCommand: vi.fn(),
  getRuntimeConfig: vi.fn(),
  updateRuntimeConfig: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
vi.mock('@/api/acp', () => ({
  createAgentletConnectionCommand: createConnectionCommand,
  getExternalAgentRuntimeConfig: getRuntimeConfig,
  updateExternalAgentRuntimeConfig: updateRuntimeConfig,
}));
vi.mock('@/components/Common/Toast', () => ({ toast }));

import { ExternalAgentRuntimeSettings } from './ExternalAgentRuntimeSettings';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const originalExecCommand = Object.getOwnPropertyDescriptor(
  document,
  'execCommand',
);
const content =
  "HUABU_PUBLIC_ORIGIN='https://huabu.example' HUABU_CONNECTION_TOKEN='secret' pnpm start:daemon --max-agents 10";
beforeEach(() => {
  getRuntimeConfig.mockResolvedValue({ idleTimeoutSecs: 600, maxAgents: 10 });
  updateRuntimeConfig.mockResolvedValue({
    idleTimeoutSecs: 1800,
    maxAgents: 10,
  });
  createConnectionCommand.mockResolvedValue({
    content,
    source: 'environment',
    warnings: [],
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
  if (originalExecCommand)
    Object.defineProperty(document, 'execCommand', originalExecCommand);
  else Reflect.deleteProperty(document, 'execCommand');
});
async function render() {
  await act(async () => root.render(<ExternalAgentRuntimeSettings />));
}
function button(key: string) {
  const found = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === key,
  );
  if (!found) throw new Error(`Button not found: ${key}`);
  return found;
}

describe('ExternalAgentRuntimeSettings', () => {
  it('shows preparation and responsive How to connect without token editors or automatic reveals', async () => {
    await render();
    expect(container.textContent).toContain('settings.agentletHowToConnect');
    expect(container.textContent).toContain('git clone');
    expect(container.textContent).toContain('pnpm install');
    expect(container.textContent).toContain(
      'settings.agentletGeneratedTokenWarning',
    );
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.querySelector('#agentlet-connection-token')).toBeNull();
    expect(container.textContent).not.toContain('secret');
    expect(createConnectionCommand).not.toHaveBeenCalled();
    const controls = button('settings.agentletCommandCopy').parentElement;
    expect(controls?.classList.contains('flex-wrap')).toBe(true);
    expect(controls?.classList.contains('w-full')).toBe(true);
    expect(controls?.parentElement?.classList.contains('w-full')).toBe(true);
  });

  it('preserves the process limit when saving idle timeout', async () => {
    await render();
    await act(async () => button('settings.tenMinutesDefault').click());
    const selected = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent === 'settings.thirtyMinutes',
    );
    if (!selected) throw new Error('Thirty-minute option not found');
    await act(async () => selected.click());
    expect(updateRuntimeConfig).toHaveBeenCalledWith({
      idleTimeoutSecs: 1800,
      maxAgents: 10,
    });
    expect(toast).toHaveBeenCalledWith(
      'settings.externalAgentIdleTimeoutSaved',
      { tone: 'success' },
    );
  });

  it.each([
    [
      'settings.agentletCommandCopy',
      'command',
      'settings.agentletCommandCopied',
    ],
    [
      'settings.agentletEnvFileCopy',
      'env-file',
      'settings.agentletEnvFileCopied',
    ],
  ])(
    'copies only on explicit action without rendering returned secret text',
    async (key, format, copied) => {
      await render();
      await act(async () => button(key).click());
      expect(createConnectionCommand).toHaveBeenCalledWith('posix', format);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(content);
      expect(container.textContent).not.toContain('secret');
      expect(container.textContent).not.toContain('https://huabu.example');
      expect(toast).toHaveBeenCalledWith(copied, { tone: 'success' });
    },
  );

  it('uses the explicit PowerShell choice instead of browser platform inference', async () => {
    await render();
    const selector = container.querySelector<HTMLButtonElement>(
      '[aria-label="settings.agentletTargetShell"]',
    );
    if (!selector) throw new Error('Shell selector not found');
    await act(async () => selector.click());
    const powershell = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent === 'PowerShell',
    );
    if (!powershell) throw new Error('PowerShell choice not found');
    await act(async () => powershell.click());
    await act(async () => button('settings.agentletCommandCopy').click());
    expect(createConnectionCommand).toHaveBeenCalledWith(
      'powershell',
      'command',
    );
  });

  it.each([
    ['generated', [], 'settings.agentletCommandCopiedGenerated'],
    ['environment', ['loopback'], 'settings.agentletCommandCopiedLoopback'],
    ['environment', ['insecure'], 'settings.agentletCommandCopiedInsecure'],
  ])(
    'surfaces generated token and transport warnings',
    async (source, warnings, key) => {
      createConnectionCommand.mockResolvedValue({ content, source, warnings });
      await render();
      await act(async () => button('settings.agentletCommandCopy').click());
      expect(toast).toHaveBeenCalledWith(key, { tone: 'warning' });
    },
  );

  it('reports HTTP/clipboard failure explicitly and re-enables both copy actions', async () => {
    createConnectionCommand.mockRejectedValueOnce(
      new Error('copy endpoint failed'),
    );
    await render();
    await act(async () => button('settings.agentletCommandCopy').click());
    expect(toast).toHaveBeenCalledWith('copy endpoint failed', {
      tone: 'danger',
    });
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(
      new Error('clipboard blocked'),
    );
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        throw new Error('clipboard blocked');
      }),
    });
    await act(async () => button('settings.agentletEnvFileCopy').click());
    expect(toast).toHaveBeenCalledWith('clipboard blocked', { tone: 'danger' });
    expect(button('settings.agentletCommandCopy').disabled).toBe(false);
    expect(button('settings.agentletEnvFileCopy').disabled).toBe(false);
    expect(container.textContent).not.toContain('secret');
    expect(document.querySelector('textarea')).toBeNull();
  });
});
