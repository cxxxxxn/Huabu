// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { readFileSync } from 'node:fs';

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { NODE_TYPOGRAPHY } from '@/components/Nodes/design/nodeTypography';
import { resolveQuestionHeaderFit } from '@/components/Nodes/question/useQuestionHeaderFit';

import { STATUS } from './QuestionStatusZoomStudy';
import {
  QuestionZoomComparison,
  QuestionZoomSpecimen,
  questionZoomComparisonLayout,
} from './QuestionZoomComparison';

import type { QuestionStudyState } from './QuestionStatusZoomStudy';

const agent = {
  kind: 'external',
  alias: 'Research Agent',
  icon: { shape: 'flower', color: 'red' },
} as const;
const title = '优化节点边路由算法';
const onOpen = () => {};
const directions = ['card', 'fusion', 'adaptive', 'rail'] as const;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error('Missing specimen element');
  return value;
}

function statusTokens(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(
    Array.from(
      block.matchAll(/(--(?:info|warning|success|danger)[\w-]*):\s*([^;]+);/g),
      ([, name, value]) => [name, value.trim()],
    ),
  );
}

describe('Question zoom comparison proposals', () => {
  it('matches the documentation attention and approval animation keyframes', () => {
    const css = readFileSync(
      'src/pages/playground/QuestionZoomComparison.css',
      'utf8',
    );
    const docs = readFileSync(
      '../docs/src/sections/ai/AgentNodeStatusGuide.css',
      'utf8',
    );
    const keyframes = (source: string, name: string) => {
      const start = source.indexOf(`@keyframes ${name} {`);
      expect(start).toBeGreaterThanOrEqual(0);
      const body = source.slice(source.indexOf('{', start) + 1);
      return body.slice(0, body.indexOf('\n}')).replace(/\s+/g, '');
    };
    for (const name of ['attention-nudge', 'approval-halo']) {
      expect(keyframes(css, `qzc-${name}`)).toBe(
        keyframes(docs, `agent-status-${name}`),
      );
    }
    expect(css).toContain('qzc-attention-nudge 4s ease-in-out infinite');
    expect(css).toContain('qzc-approval-halo 2.4s ease-out infinite');
    expect(css).toContain('inset: -7px');
    expect(css).toContain(
      'border: 3px solid color-mix(in srgb, var(--warning) 30%, transparent)',
    );
  });

  it('C retains its status outline for every closed far state, replaced by the bubble when open', () => {
    for (const state of Object.keys(STATUS) as QuestionStudyState[]) {
      for (const isOpen of [false, true]) {
        const host = document.createElement('div');
        host.innerHTML = renderToStaticMarkup(
          <QuestionZoomSpecimen
            direction="adaptive"
            state={state}
            zoom={0.1}
            isOpen={isOpen}
            agent={agent}
            title={title}
            onOpen={onOpen}
          />,
        );
        const ring = host.querySelector<HTMLElement>('.qzc-adaptive-ring');
        if (isOpen) {
          expect(ring).toBeNull();
          expect(host.querySelector('.qzc-active-bubble')).not.toBeNull();
        } else {
          const color =
            required(ring).style.getPropertyValue('--qzc-ring-color');
          expect(color).not.toBe('transparent');
          expect(color).not.toBe('');
          if (['running', 'approval', 'error'].includes(state)) {
            expect(
              required(ring).classList.contains(`question-agent-ring-${state}`),
            ).toBe(true);
          }
        }
      }
    }
  });

  it('C preserves closed status rings and far avatar motion independently of opening', () => {
    for (const state of Object.keys(STATUS) as QuestionStudyState[]) {
      for (const zoom of [1, 0.1]) {
        for (const isOpen of [false, true]) {
          const host = document.createElement('div');
          host.innerHTML = renderToStaticMarkup(
            <QuestionZoomSpecimen
              direction="adaptive"
              state={state}
              zoom={zoom}
              isOpen={isOpen}
              agent={agent}
              title={title}
              onOpen={onOpen}
            />,
          );
          const node = required(host.querySelector('article'));
          expect(
            host.querySelectorAll(
              '.question-agent-ring-running, .question-agent-ring-approval, .question-agent-ring-error',
            ),
          ).toHaveLength(
            !isOpen && ['running', 'approval', 'error'].includes(state) ? 1 : 0,
          );
          expect(node.dataset.attention).toBe(
            String(
              zoom === 0.1 &&
                !isOpen &&
                (state === 'unread' || state === 'error'),
            ),
          );
          expect(node.dataset.approvalMotion).toBe(
            String(zoom === 0.1 && state === 'approval'),
          );
          expect(
            host.querySelectorAll('.agent-icon-working-body'),
          ).toHaveLength(zoom === 0.1 && state === 'running' ? 1 : 0);
        }
      }
    }
  });

  it('C stops reviewed outcome motion but retains unresolved conflict attention until open', () => {
    for (const state of ['unread', 'error', 'viewed'] as const) {
      for (const conflictCount of [0, 2]) {
        for (const isOpen of [false, true]) {
          const host = document.createElement('div');
          host.innerHTML = renderToStaticMarkup(
            <QuestionZoomSpecimen
              direction="adaptive"
              state={state}
              zoom={0.1}
              isOpen={isOpen}
              reviewed
              conflictCount={conflictCount}
              agent={agent}
              title={title}
              onOpen={onOpen}
            />,
          );
          expect(
            required(host.querySelector('article')).dataset.attention,
          ).toBe(String(!isOpen && conflictCount > 0));
        }
      }
    }
  });

  it('keeps the exact adopted light palette in the global token source', () => {
    const css = readFileSync('src/index.css', 'utf8');
    expect(statusTokens(css, ':root')).toEqual({
      '--info': '#2e90ff',
      '--info-light': '#8ac2ff',
      '--info-bg': '#f2f8ff',
      '--info-bg-hover': '#dbeafe',
      '--warning': '#d97a2b',
      '--warning-light': '#e2b38d',
      '--warning-bg': '#fdf6f1',
      '--warning-bg-hover': '#f7e5d6',
      '--success': '#1b5e20',
      '--success-light': '#a4c9a4',
      '--success-bg': '#f3f9f3',
      '--success-bg-hover': '#deeedd',
      '--danger': '#b82132',
      '--danger-light': '#e3b2a9',
      '--danger-bg': '#fcf8f8',
      '--danger-bg-hover': '#fbe2e1',
    });
  });

  it('preserves production dark status tokens rather than adopting the experiment', () => {
    const css = readFileSync('src/index.css', 'utf8');
    expect(statusTokens(css, '.dark')).toEqual({
      '--info': '#60a5fa',
      '--info-light': '#93c5fd',
      '--info-bg': 'oklch(0.22 0.04 260)',
      '--info-bg-hover': 'oklch(0.28 0.05 260)',
      '--warning': '#fbbf24',
      '--warning-light': '#f59e0b',
      '--warning-bg': 'oklch(0.22 0.05 80)',
      '--warning-bg-hover': 'oklch(0.28 0.06 80)',
      '--success': '#4ade80',
      '--success-light': '#22c55e',
      '--success-bg': 'oklch(0.22 0.04 150)',
      '--success-bg-hover': 'oklch(0.28 0.05 150)',
      '--danger': 'oklch(0.704 0.191 22.216)',
      '--danger-light': '#f87171',
      '--danger-bg': 'oklch(0.28 0.06 25)',
      '--danger-bg-hover': 'oklch(0.28 0.06 25)',
    });
  });

  it('inherits the production default and scopes only former light colors to the comparison', () => {
    const css = readFileSync(
      'src/pages/playground/QuestionZoomComparison.css',
      'utf8',
    );
    expect(css).not.toContain("[data-palette='harmonized']");
    const legacy = statusTokens(css, ".qzc-study[data-palette='theme']");
    expect(legacy).toEqual({
      '--warning-light': '#f7c85c',
      '--warning-bg': '#fef6e7',
      '--warning-bg-hover': '#fbe7ad',
      '--success': '#16a34a',
      '--success-light': '#6faf4f',
      '--success-bg': '#f0fdf4',
      '--success-bg-hover': '#dcfce7',
      '--danger': '#e43636',
      '--danger-light': '#cf8181',
      '--danger-bg-hover': '#fee2e2',
    });
    expect(statusTokens(css, ".dark .qzc-study[data-palette='theme']")).toEqual(
      Object.fromEntries(Object.keys(legacy).map((key) => [key, 'inherit'])),
    );
    expect(css).not.toContain('oklch(');
  });

  it('defaults to the production palette and allows comparing the former theme without changing lifecycle', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <QuestionZoomComparison
            state="unread"
            agent={agent}
            title={title}
            onOpen={onOpen}
          />,
        ),
      );
      const section = required(host.querySelector<HTMLElement>('.qzc-study'));
      const toggle = required(
        Array.from(host.querySelectorAll('button')).find(
          (button) => button.textContent === '配色：新版',
        ),
      );
      expect(section.dataset.palette).toBe('harmonized');
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
      const previews = host.querySelectorAll<HTMLElement>(
        '[data-palette-tone]',
      );
      expect(previews).toHaveLength(4);
      for (const preview of previews) {
        const tone = preview.dataset.paletteTone;
        expect(preview.style.getPropertyValue('--qzc-preview-bg-hover')).toBe(
          `var(--${tone}-bg-hover)`,
        );
        expect(preview.querySelectorAll('.qzc-palette-shades i')).toHaveLength(
          4,
        );
        expect(preview.querySelector('.qzc-palette-sample')).not.toBeNull();
      }
      await act(async () => toggle.click());
      expect(section.dataset.palette).toBe('theme');
      expect(toggle.textContent).toBe('配色：原主题');
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
      expect(
        required(host.querySelector<HTMLElement>('.qzc-live .qzc-node')).dataset
          .state,
      ).toBe('unread');
      await act(async () => toggle.click());
      expect(section.dataset.palette).toBe('harmonized');
      expect(toggle.textContent).toBe('配色：新版');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
  it('reserves a larger D rail inset and measures the shared title typography accurately', () => {
    for (const zoom of [1, 0.5, 0.25]) {
      const layout = questionZoomComparisonLayout('rail', zoom, 72);
      expect(layout.contentLeft).toBe(32 * zoom);
      expect(layout.contentRight).toBe(24 * zoom);
      expect(layout.contentWidth).toBe(384 * zoom);
      expect(layout.avatarX).toBe(layout.contentLeft);
      expect(layout.padding).toBe(20 * zoom);
      expect(layout.width).toBe(440 * zoom);
      expect(layout.titleGap).toBe(16 * zoom);
      expect(layout.avatar).toBe(24 * zoom);
      expect(layout.titleSize).toBe(NODE_TYPOGRAPHY.cardTitle.size * zoom);
      expect(layout.titleWeight).toBe(NODE_TYPOGRAPHY.cardTitle.weight);
      expect(layout.titleLineHeight).toBe(NODE_TYPOGRAPHY.cardTitle.lineHeight);
      expect(layout.statusSize).toBe(14 * zoom);
    }
    for (const zoom of [1, 0.5, 0.1]) {
      const host = document.createElement('div');
      host.innerHTML = renderToStaticMarkup(
        <QuestionZoomSpecimen
          direction="rail"
          zoom={zoom}
          state="running"
          agent={agent}
          title={title}
          onOpen={onOpen}
        />,
      );
      const probe = required(
        host.querySelector<HTMLElement>('.qzc-title-probe'),
      );
      expect(probe.style.width).toBe('384px');
      expect(probe.style.left).toBe('32px');
      expect(
        required(host.querySelector<HTMLElement>('.qzc-title')).style.left,
      ).toBe('32px');
      expect(
        required(host.querySelector<HTMLElement>('.qzc-title')).style.right,
      ).toBe('24px');
      if (zoom >= 0.25) {
        const header = required(host.querySelector<HTMLElement>('.qzc-header'));
        expect(header.style.left).toBe('32px');
        expect(header.style.right).toBe('24px');
      }
    }
    const far = questionZoomComparisonLayout('rail', 0.1);
    const reference = questionZoomComparisonLayout('adaptive', 0.1);
    for (const key of [
      'width',
      'height',
      'avatarX',
      'avatarY',
      'avatar',
    ] as const) {
      expect(far[key]).toBe(reference[key]);
    }
  });
  it.each(directions)(
    '%s keeps Copilot inset without changing the avatar slot or theme running blue',
    (direction) => {
      for (const zoom of [1, 0.4, 0.1, 0.01]) {
        for (const isOpen of [false, true]) {
          const host = document.createElement('div');
          host.innerHTML = renderToStaticMarkup(
            <QuestionZoomSpecimen
              direction={direction}
              zoom={zoom}
              state="running"
              agent={agent}
              title={title}
              onOpen={onOpen}
              useCopilotIcon
              isOpen={isOpen}
            />,
          );
          const avatar = required(
            host.querySelector<HTMLElement>('.qzc-avatar'),
          );
          const icon = required(host.querySelector('.qzc-copilot-icon'));
          expect(Number(icon.getAttribute('width'))).toBeCloseTo(
            parseFloat(avatar.style.width) * 0.72,
          );
          expect(Number(icon.getAttribute('height'))).toBeCloseTo(
            parseFloat(avatar.style.height) * 0.72,
          );
          expect(
            required(host.querySelector('article')).style.getPropertyValue(
              '--question-agent-running-ring',
            ),
          ).toBe('var(--info)');
          expect(host.querySelectorAll('.qzc-avatar-art')).toHaveLength(1);
        }
      }
    },
  );
  it('toggles current-open across all previews without selecting or acknowledging them', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let opened = 0;
    try {
      await act(async () =>
        root.render(
          <QuestionZoomComparison
            state="unread"
            agent={agent}
            title={title}
            onOpen={() => {
              opened++;
            }}
          />,
        ),
      );
      const toggle = (name: string) => {
        const button = required(
          Array.from(host.querySelectorAll('button')).find(
            (b) => b.textContent?.trim() === name,
          ),
        );
        act(() => button.click());
        return button;
      };
      expect(host.querySelectorAll('.qzc-selection-outline')).toHaveLength(0);
      expect(
        Array.from(host.querySelectorAll('button')).some(
          (b) => b.textContent?.trim() === '选中',
        ),
      ).toBe(false);
      expect(host.querySelectorAll('.qzc-node[data-open="true"]')).toHaveLength(
        0,
      );
      expect(toggle('当前打开').getAttribute('aria-pressed')).toBe('true');
      expect(host.querySelectorAll('.qzc-node[data-open="true"]')).toHaveLength(
        72,
      );
      expect(
        host
          .querySelector('[data-live="adaptive"] .qzc-node')
          ?.getAttribute('data-state'),
      ).toBe('unread');
      expect(opened).toBe(0);
      expect(toggle('当前打开').getAttribute('aria-pressed')).toBe('false');
      expect(host.querySelectorAll('.qzc-selection-outline')).toHaveLength(0);
      expect(host.querySelectorAll('.qzc-node[data-open="true"]')).toHaveLength(
        0,
      );
      act(() =>
        required(host.querySelector<HTMLButtonElement>('.qzc-open')).click(),
      );
      expect(opened).toBe(1);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });

  it('keeps card layout unchanged while zooming and restores it after the far-mode hysteresis band', async () => {
    // HappyDOM has no layout; intrinsic fit is covered by the measurement tests.
    const rects = vi
      .spyOn(HTMLElement.prototype, 'getClientRects')
      .mockReturnValue([] as unknown as DOMRectList);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const render = async (zoom: number) => {
      await act(async () =>
        root.render(
          <QuestionZoomSpecimen
            direction="adaptive"
            state="running"
            zoom={zoom}
            agent={agent}
            title={title}
            onOpen={onOpen}
          />,
        ),
      );
      return required(host.querySelector('article'));
    };
    try {
      for (const zoom of [1, 0.75, 0.5, 0.4, 0.35, 0.3, 0.25]) {
        const node = await render(zoom);
        expect(node.dataset.presentation).toBe('overview');
        expect(node.style.width).toBe('440px');
        expect(node.style.transform).toBe(`scale(${zoom})`);
        expect(
          required(host.querySelector<HTMLElement>('.qzc-title')).style
            .fontSize,
        ).toBe('28px');
        expect(
          required(host.querySelector<HTMLElement>('.qzc-title-probe')).style
            .width,
        ).toBe('408px');
        const header = required(host.querySelector<HTMLElement>('.qzc-header'));
        expect(header.style.left).toBe('16px');
        expect(header.style.right).toBe('16px');
        expect(
          required(host.querySelector<HTMLElement>('.qzc-status')).style
            .display,
        ).not.toBe('none');
      }
      for (const zoom of [0.24, 0.1, 0.26, 0.29]) {
        const node = await render(zoom);
        expect(node.dataset.presentation).toBe('minimal');
        expect(node.style.width).toBe('128px');
        expect(
          required(host.querySelector<HTMLElement>('.qzc-title')).style
            .visibility,
        ).toBe('hidden');
        expect(
          required(host.querySelector<HTMLElement>('.qzc-status')).style
            .display,
        ).toBe('none');
        expect(
          required(host.querySelector<HTMLElement>('.qzc-adaptive-ring')).style
            .opacity,
        ).toBe('1');
      }
      const restored = await render(0.3);
      expect(restored.dataset.presentation).toBe('overview');
      expect(restored.style.width).toBe('440px');
      expect(
        required(host.querySelector<HTMLElement>('.qzc-adaptive-ring')).style
          .opacity,
      ).toBe('0');
    } finally {
      act(() => root.unmount());
      host.remove();
      rects.mockRestore();
    }
  });
  it.each(directions)(
    '%s preserves all six state meanings at five scales',
    (direction) => {
      for (const state of Object.keys(STATUS) as QuestionStudyState[]) {
        for (const zoom of [1, 0.75, 0.5, 0.25, 0.1]) {
          const host = document.createElement('div');
          host.innerHTML = renderToStaticMarkup(
            <QuestionZoomSpecimen
              direction={direction}
              state={state}
              zoom={zoom}
              agent={agent}
              title={title}
              onOpen={onOpen}
            />,
          );
          expect(
            host.querySelector('article')?.getAttribute('title'),
          ).toContain(STATUS[state].label);
          expect(
            host.querySelector('button')?.getAttribute('aria-label'),
          ).toContain(title);
          expect(host.querySelectorAll('button')).toHaveLength(1);
          expect(host.querySelector('.qzc-title')?.textContent).toBe(title);
          expect(host.querySelectorAll('.qzc-status svg')).toHaveLength(
            direction !== 'fusion' &&
              (direction !== 'rail' || state === 'running')
              ? 1
              : 0,
          );
          expect(
            host.querySelectorAll('.qzc-avatar .qzc-approval-badge'),
          ).toHaveLength(direction !== 'card' && state === 'approval' ? 1 : 0);
          expect(
            host.querySelectorAll('.question-agent-ring-running'),
          ).toHaveLength(direction !== 'card' && state === 'running' ? 1 : 0);
          expect(host.querySelectorAll('.qzc-spinner')).toHaveLength(
            direction !== 'fusion' && state === 'running' ? 1 : 0,
          );
          if (direction === 'fusion' && state === 'running') {
            expect(
              (
                host.querySelector('article') as HTMLElement
              ).style.getPropertyValue('--question-agent-running-ring'),
            ).toBe('var(--info)');
          }
        }
      }
    },
  );

  it('keeps cards intact until switching to the far mark', () => {
    expect(questionZoomComparisonLayout('card', 0.1)).toMatchObject({
      width: 40,
      height: 6.4,
      shellOpacity: 1,
    });
    expect(questionZoomComparisonLayout('fusion', 0.1)).toMatchObject({
      width: 12.8,
      height: 12.8,
      radius: 6.4,
      shellOpacity: 0,
    });
    expect(questionZoomComparisonLayout('fusion', 1).shellOpacity).toBe(1);
    expect(
      questionZoomComparisonLayout('fusion', 0.35).shellOpacity,
    ).toBeGreaterThan(0);
    expect(questionZoomComparisonLayout('fusion', 0.3).shellOpacity).toBe(1);
    expect(questionZoomComparisonLayout('fusion', 0.25).shellOpacity).toBe(1);
    expect(questionZoomComparisonLayout('fusion', 0.24).shellOpacity).toBe(0);
  });

  it.each(Object.keys(STATUS) as QuestionStudyState[])(
    'removes only the distant shell for %s, retaining the avatar and activation target',
    (state) => {
      const host = document.createElement('div');
      host.innerHTML = renderToStaticMarkup(
        <QuestionZoomSpecimen
          direction="fusion"
          state={state}
          zoom={0.1}
          agent={agent}
          title={title}
          onOpen={onOpen}
        />,
      );
      expect(
        (host.querySelector('article') as HTMLElement).style.getPropertyValue(
          '--qzc-shell-opacity',
        ),
      ).toBe('0');
      expect(host.querySelectorAll('.qzc-avatar')).toHaveLength(1);
      expect(host.querySelectorAll('.qzc-ring')).toHaveLength(1);
      expect(
        host.querySelector('button')?.getAttribute('aria-label'),
      ).toContain(STATUS[state].label);
    },
  );

  it.each(directions)(
    '%s scales fixed authored geometry throughout card mode without a morph',
    (direction) => {
      const base = questionZoomComparisonLayout(direction, 1, 144);
      for (const zoom of [1, 0.75, 0.5, 0.45, 0.4, 0.35, 0.3, 0.26, 0.25]) {
        const next = questionZoomComparisonLayout(direction, zoom, 144);
        for (const key of [
          'width',
          'height',
          'avatar',
          'avatarX',
          'avatarY',
          'titleSize',
          'metaSize',
        ] as const) {
          expect(next[key]).toBeCloseTo(base[key] * zoom);
        }
        expect(next.shellOpacity).toBe(1);
        expect(next.collapse).toBe(0);
      }
    },
  );

  it('offers only C/D with two live previews, ten scale specimens and sixty state/scale specimens', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(
      <QuestionZoomComparison
        state="running"
        agent={agent}
        title={title}
        onOpen={onOpen}
      />,
    );
    expect(host.querySelectorAll('[data-live] .qzc-node')).toHaveLength(2);
    expect(
      host.querySelectorAll('.qzc-direction > .qzc-scales .qzc-node'),
    ).toHaveLength(10);
    expect(host.querySelectorAll('.qzc-matrix .qzc-node')).toHaveLength(60);
    expect(host.querySelector('#zoom-card, #zoom-fusion')).toBeNull();
    expect(
      Array.from(host.querySelectorAll('[data-live]'), (node) =>
        node.getAttribute('data-live'),
      ),
    ).toEqual(['adaptive', 'rail']);
    expect(host.querySelector('input[type="range"]')?.getAttribute('min')).toBe(
      '1',
    );
  });

  it('C starts as a clean card and ends as a compact single mark', () => {
    expect(questionZoomComparisonLayout('adaptive', 1)).toMatchObject({
      width: 440,
      height: 72,
      padding: 20,
      contentLeft: 16,
      contentRight: 16,
      contentWidth: 408,
      avatar: 32,
      titleSize: 28,
      shellOpacity: 1,
    });
    expect(questionZoomComparisonLayout('adaptive', 1, 36).titleGap).toBe(16);
    expect(questionZoomComparisonLayout('adaptive', 0.1)).toMatchObject({
      width: 12.8,
      height: 12.8,
      shellOpacity: 0,
    });
    for (const zoom of [1, 0.5, 0.4, 0.3, 0.1]) {
      const host = document.createElement('div');
      host.innerHTML = renderToStaticMarkup(
        <QuestionZoomSpecimen
          direction="adaptive"
          zoom={zoom}
          state="approval"
          agent={agent}
          title={title}
          onOpen={onOpen}
        />,
      );
      const far = Number(
        (host.querySelector('.qzc-adaptive-ring') as HTMLElement).style.opacity,
      );
      expect(
        (host.querySelector('.qzc-status') as HTMLElement).style.opacity,
      ).toBe('');
      expect(
        (host.querySelector('.qzc-approval-badge') as HTMLElement).style
          .opacity,
      ).toBe(String(far));
      expect(host.querySelectorAll('.qzc-avatar-art')).toHaveLength(1);
    }
  });

  it.each(directions)('%s has no positive zoom or size floor', (direction) => {
    const base = questionZoomComparisonLayout(direction, 0.1);
    for (const zoom of [0.05, 0.01, 0.001, 0]) {
      const next = questionZoomComparisonLayout(direction, zoom);
      for (const key of [
        'width',
        'height',
        'avatar',
        'padding',
        'radius',
        'titleSize',
        'metaSize',
      ] as const) {
        expect(next[key]).toBeCloseTo((base[key] * zoom) / 0.1, 8);
      }
    }
    expect(questionZoomComparisonLayout(direction, 0.25).width).toBeGreaterThan(
      base.width,
    );
  });

  it('uses actual alias and status widths rather than a fixed visibility threshold', () => {
    const metrics = {
      width: 240,
      avatar: 32,
      gap: 8,
      icon: 16,
      label: 48,
      alias: 80,
    };
    expect(resolveQuestionHeaderFit(metrics)).toEqual({
      alias: true,
      status: true,
      statusText: true,
    });
    expect(resolveQuestionHeaderFit({ ...metrics, alias: 180 })).toEqual({
      alias: false,
      status: true,
      statusText: true,
    });
    expect(resolveQuestionHeaderFit({ ...metrics, width: 80 })).toEqual({
      alias: false,
      status: true,
      statusText: false,
    });
    expect(resolveQuestionHeaderFit({ ...metrics, width: 45 })).toEqual({
      alias: false,
      status: false,
      statusText: false,
    });
    expect(
      resolveQuestionHeaderFit({ ...metrics, alias: 8, width: 110, label: 20 }),
    ).toEqual({ alias: true, status: true, statusText: true });
    for (const scale of [0.75, 0.5, 0.25, 0.1, 0.01]) {
      const scaled = Object.fromEntries(
        Object.entries(metrics).map(([key, value]) => [key, value * scale]),
      ) as typeof metrics;
      expect(resolveQuestionHeaderFit(scaled)).toEqual(
        resolveQuestionHeaderFit(metrics),
      );
    }
  });

  it.each(directions)(
    '%s sizes the near card to wrapped content and removes unused title space',
    (direction) => {
      const empty = questionZoomComparisonLayout(direction, 1, 0);
      const short = questionZoomComparisonLayout(direction, 1, 36);
      const long = questionZoomComparisonLayout(direction, 1, 144);
      expect(empty.height).toBe(direction === 'adaptive' ? 72 : 64);
      expect(short.height).toBe(
        direction === 'adaptive' ? 124 : direction === 'rail' ? 116 : 112,
      );
      expect(long.height).toBe(
        direction === 'adaptive' ? 232 : direction === 'rail' ? 224 : 220,
      );
      expect(long.height - short.height).toBe(108);
      for (const zoom of [0.75, 0.5]) {
        expect(
          questionZoomComparisonLayout(direction, zoom, 144).height,
        ).toBeCloseTo(long.height * zoom);
      }
      if (direction !== 'card') {
        expect(
          questionZoomComparisonLayout(direction, 0.1, 144).height,
        ).toBeCloseTo(12.8);
      }
    },
  );

  it.each(directions)(
    '%s represents current-open without rewriting lifecycle state',
    (direction) => {
      for (const state of Object.keys(STATUS) as QuestionStudyState[]) {
        for (const zoom of [1, 0.75, 0.5, 0.25, 0.1]) {
          const host = document.createElement('div');
          host.innerHTML = renderToStaticMarkup(
            <QuestionZoomSpecimen
              direction={direction}
              zoom={zoom}
              state={state}
              isOpen
              agent={agent}
              title={title}
              onOpen={onOpen}
            />,
          );
          const node = host.querySelector('article');
          if (!node) throw new Error('Missing Question specimen');
          expect(node.dataset.state).toBe(state);
          expect(node.dataset.open).toBe('true');
          const tone = STATUS[state].tone;
          expect(node.style.getPropertyValue('--qzc-tone-light')).toBe(
            `var(--${tone === 'neutral' ? 'fg-subtle' : `${tone}-light`})`,
          );
          expect(node.style.getPropertyValue('--qzc-tone-bg')).toBe(
            `var(--${tone === 'neutral' ? 'bg-hover' : `${tone}-bg`})`,
          );
          expect(node.style.getPropertyValue('--qzc-edge')).toBe('');
          expect(host.querySelectorAll('.qzc-open-tail')).toHaveLength(1);
          expect(
            (host.querySelector('.qzc-open-tail') as SVGElement).style.opacity,
          ).toBe(
            String(questionZoomComparisonLayout(direction, zoom).shellOpacity),
          );
          expect(
            host.querySelector('button')?.getAttribute('aria-label'),
          ).toContain(`${STATUS[state].label} · 当前打开`);
          expect(host.querySelectorAll('.qzc-active-bubble')).toHaveLength(
            direction !== 'card' ? 1 : 0,
          );
          expect(
            host.querySelectorAll(
              '.question-agent-ring-running, .question-agent-ring-error, .question-agent-ring-approval',
            ),
          ).toHaveLength(0);
          const bubblePath = host.querySelector('.qzc-active-bubble path');
          if (bubblePath) {
            expect(bubblePath.getAttribute('fill')).toBe(
              'var(--qzc-shell-fill)',
            );
          }
          expect(host.querySelectorAll('.qzc-approval-badge')).toHaveLength(
            direction !== 'card' && state === 'approval' ? 1 : 0,
          );
        }
      }
    },
  );
});
