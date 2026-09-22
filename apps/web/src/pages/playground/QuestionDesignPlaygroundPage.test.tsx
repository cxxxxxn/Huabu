// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import QuestionDesignPlaygroundPage from './QuestionDesignPlaygroundPage';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error('Expected playground element');
  return value;
}

describe('Question design playground', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(
      () => {},
    );
    act(() => root.render(<QuestionDesignPlaygroundPage />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function click(text: string, scope: ParentNode = container) {
    const button = Array.from(scope.querySelectorAll('button')).find(
      (element) => element.textContent?.trim() === text,
    );
    if (!button) throw new Error(`Missing button: ${text}`);
    act(() => button.click());
    return button;
  }

  function directions() {
    return container.querySelectorAll('.qd-directions .qd-card');
  }

  it('renders three directions with stable agent identity and all six state fixtures', () => {
    expect(directions()).toHaveLength(3);
    expect(
      Array.from(directions()).map((card) =>
        card.getAttribute('data-direction'),
      ),
    ).toEqual(['topic', 'handoff', 'compact']);
    expect(container.querySelectorAll('.qd-matrix .qd-card')).toHaveLength(6);
    for (const card of directions()) {
      expect(card.textContent).toContain('按产品整理网站内容框架');
      expect(card.textContent).toContain('等你授权');
      expect(card.querySelector('[aria-label="Agent: Huabu"]')).not.toBeNull();
    }
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('keeps opening a permission preview separate from granting permission', () => {
    const first = directions()[0];
    const opener = click('查看请求', first);
    const preview = required(
      container.querySelector<HTMLElement>('.qd-preview'),
    );
    expect(preview.dataset.open).toBe('true');
    expect(document.activeElement).toBe(preview);
    expect(first.getAttribute('data-state')).toBe('approval');
    click('模拟允许', preview);
    expect(
      Array.from(directions()).every(
        (card) => card.getAttribute('data-state') === 'running',
      ),
    ).toBe(true);
    click('模拟本轮结束', preview);
    expect(directions()[0].textContent).toContain('本轮结束');
    click('模拟标为已查看', preview);
    expect(directions()[0].textContent).toContain('已查看');
    expect(opener.isConnected).toBe(true);
  });

  it('supports alternate identity, long titles, overview and local dark theme', () => {
    click('外部 Agent 图标');
    click('长标题');
    click('旧版概览形态');
    click('深色预览');
    expect(
      container.querySelector('.qd-page')?.classList.contains('dark'),
    ).toBe(true);
    for (const card of directions()) {
      expect(card.getAttribute('data-overview')).toBe('true');
      expect(card.textContent).toContain('梳理产品网站的信息架构');
      expect(card.textContent).toContain('等你授权');
      expect(
        card.querySelector('[aria-label="Agent: Research Agent"]'),
      ).not.toBeNull();
    }
    expect(container.querySelectorAll('.qd-prompt')).toHaveLength(0);
  });

  it('switches the matrix independently of the main comparison state', () => {
    click(
      '紧凑对话条',
      required(container.querySelector('[aria-label="全状态设计方向"]')),
    );
    expect(
      Array.from(container.querySelectorAll('.qd-matrix .qd-card')).every(
        (card) => card.getAttribute('data-direction') === 'compact',
      ),
    ).toBe(true);
    expect(directions()[0].getAttribute('data-state')).toBe('approval');
    click(
      '运行出错',
      required(container.querySelector('[aria-label="对话状态"]')),
    );
    expect(directions()[0].textContent).toContain('查看原因');
    expect(
      container.querySelector('.qd-matrix [data-state="draft"]'),
    ).not.toBeNull();
  });

  it('keeps compact status in its header and distinguishes conversation identity from Note content', () => {
    const card = required(
      container.querySelector('.qd-directions [data-direction="compact"]'),
    );
    expect(
      card.querySelector('.qd-compact-heading .qd-status')?.textContent,
    ).toContain('等你授权');
    expect(card.querySelector('.qd-agent-name')?.textContent).toBe(
      '对话 · Huabu',
    );
    expect(card.querySelector('.qd-compact-bottom .qd-status')).toBeNull();
    expect(card.querySelector('.qd-compact-detail')).toBeNull();
    expect(card.textContent).not.toContain('链接读取超时');
    click('查看授权请求', card);
    const preview = required(container.querySelector('.qd-preview'));
    click('返回（不作授权决定）', preview);
    expect(card.getAttribute('data-state')).toBe('approval');
  });
});
