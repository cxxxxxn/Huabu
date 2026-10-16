// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SettingsComponentsPlaygroundPage from './SettingsComponentsPlaygroundPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('lottie-react', () => ({ default: () => null }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <SettingsComponentsPlaygroundPage />
      </MemoryRouter>,
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function click(name: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (element) =>
      element.textContent === name ||
      element.getAttribute('aria-label') === name,
  );
  if (!button) throw new Error(`Missing control: ${name}`);
  await act(async () => button.click());
}

async function edit(label: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  );
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  if (!input || !setter) throw new Error(`Missing input: ${label}`);
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Settings component playground', () => {
  it('shows eight independent specimens instead of a Settings dialog', () => {
    expect(container.querySelectorAll('.settings-specimen')).toHaveLength(8);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain('拟议组合 · 尚未抽取');
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/playground/components',
    );
  });

  it('renders production field controls without a separate styling mode', async () => {
    expect(container.textContent).toContain('正式组件样式');
    expect(container.textContent).not.toContain('参考风格');
    expect(
      container.querySelectorAll('.settings-select .lucide-chevrons-up-down'),
    ).toHaveLength(3);
    expect(
      container
        .querySelector('.settings-demo-row')
        ?.classList.contains('setting-row'),
    ).toBe(true);
    expect(
      container
        .querySelector('#specimen-endpoint')
        ?.classList.contains('text-[13px]'),
    ).toBe(true);
    await edit('操作区草稿', 'local draft');
    expect(
      container.querySelector<HTMLInputElement>('[aria-label="操作区草稿"]')
        ?.value,
    ).toBe('local draft');
  });

  it('uses a real stacked connection-guide scenario and differentiated control widths', () => {
    expect(container.querySelector('#rows textarea')).toBeNull();
    expect(
      container.querySelector('.settings-demo-row-stacked')?.textContent,
    ).toContain('连接运行 Agent 的机器');
    expect(
      container.querySelector('#controls .settings-control-compact'),
    ).not.toBeNull();
    expect(
      container.querySelectorAll('#controls .settings-control-standard'),
    ).toHaveLength(2);
  });

  it('keeps credential status and its action in one natural-width group', () => {
    const group = container.querySelector('.settings-credential-actions');
    expect(
      group?.querySelector('.settings-credential-badge')?.textContent,
    ).toContain('已配置');
    expect(group?.querySelector('button')?.disabled).toBe(true);
    expect(group?.closest('.settings-demo-row')?.textContent).toContain(
      '不代表验证有效',
    );
    expect(group?.closest('.settings-control-standard')).toBeNull();
  });

  it('keeps the draft after failure and restores it on cancel', async () => {
    await edit('操作区草稿', 'changed draft');
    await click('保存');
    expect(
      container.querySelector('#actions [role="alert"]')?.textContent,
    ).toContain('草稿已保留');
    expect(
      container.querySelector<HTMLInputElement>('[aria-label="操作区草稿"]')
        ?.value,
    ).toBe('changed draft');
    await click('取消');
    expect(
      container.querySelector<HTMLInputElement>('[aria-label="操作区草稿"]')
        ?.value,
    ).toBe('草稿内容');
    expect(container.querySelector('#actions [role="alert"]')).toBeNull();
  });

  it('can preview success without touching a settings store', async () => {
    await edit('操作区草稿', 'saved fixture');
    await click('模拟保存失败');
    await click('保存');
    expect(
      container.querySelector('#actions [role="status"]')?.textContent,
    ).toContain('已保存（演示）');
    await edit('操作区草稿', 'second draft');
    await click('取消');
    expect(
      container.querySelector<HTMLInputElement>('[aria-label="操作区草稿"]')
        ?.value,
    ).toBe('saved fixture');
  });

  it('reveals dependent fields and resets fixture state', async () => {
    await click('启用高级选项');
    expect(container.querySelector('#sections [role="group"]')).not.toBeNull();
    await click('空态');
    expect(container.querySelector('#entities')?.textContent).toContain(
      '还没有可用 Agent',
    );
    await click('重置示例');
    expect(container.querySelector('#sections [role="group"]')).toBeNull();
    expect(container.querySelector('#entities')?.textContent).toContain(
      '示例 Agent A',
    );
  });

  it('uses the document theme for portaled menus and restores it on unmount', async () => {
    const initial = document.documentElement.classList.contains('dark');
    await click(initial ? '浅色预览' : '深色预览');
    expect(document.documentElement.classList.contains('dark')).toBe(!initial);
    await act(async () => root.render(null));
    expect(document.documentElement.classList.contains('dark')).toBe(initial);
  });
});
