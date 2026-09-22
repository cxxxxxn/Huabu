// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InsetQuestionCard } from './QuestionInsetStudy';
import {
  QUESTION_REFERENCES,
  QuestionReferenceGallery,
} from './QuestionReferenceGallery';
import { STATUS } from './QuestionStatusZoomStudy';

import type { QuestionStudyState } from './QuestionStatusZoomStudy';

const agent = { kind: 'internal', alias: 'Huabu', mode: 'operate' } as const;
const title = '按产品整理网站内容框架';
const onOpen = () => {};

describe('reference gallery', () => {
  it('keeps hybrid running indicators at every size without adding icons to other states', () => {
    for (const state of Object.keys(STATUS) as QuestionStudyState[]) {
      for (const zoom of [1, 0.75, 0.5, 0.25, 0.1]) {
        const host = document.createElement('div');
        host.innerHTML = renderToStaticMarkup(
          <InsetQuestionCard
            appearance="compact-notice"
            state={state}
            agent={agent}
            title={title}
            zoom={zoom}
            onOpen={onOpen}
          />,
        );
        expect(host.querySelector('.qi-status')?.textContent ?? null).toBe(
          zoom >= 0.5
            ? state === 'unread'
              ? '待查看'
              : STATUS[state].label
            : state === 'running'
              ? ''
              : null,
        );
        expect(host.querySelector('.qi-card')?.getAttribute('title')).toBe(
          STATUS[state].label,
        );
        expect(host.querySelectorAll('.qi-status svg')).toHaveLength(
          state === 'running' ? 1 : 0,
        );
        expect(host.querySelectorAll('.qi-spin')).toHaveLength(
          state === 'running' ? 1 : 0,
        );
        expect(
          host.querySelector('button')?.getAttribute('aria-label'),
        ).toContain(STATUS[state].label);
        expect(host.querySelector('.qi-agent')).not.toBeNull();
        expect(host.querySelectorAll('button')).toHaveLength(1);
      }
    }
  });
  it('spotlights a compact hybrid with state text but no status icon or dismiss action', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(
      <QuestionReferenceGallery
        state="approval"
        agent={agent}
        title={title}
        onOpen={onOpen}
      />,
    );
    const focus = host.querySelector('.qg-notice-preview');
    expect(focus?.querySelectorAll('.qi-status')).toHaveLength(1);
    expect(focus?.querySelector('.qi-status')?.textContent).toBe('等你授权');
    expect(focus?.querySelector('.qi-status svg')).toBeNull();
    expect(focus?.querySelector('.qi-header .qi-agent')).not.toBeNull();
    expect(focus?.querySelector('.qi-card')?.getAttribute('title')).toBe(
      '等你授权',
    );
    expect(focus?.querySelectorAll('button')).toHaveLength(1);
    expect(focus?.querySelector('.qi-question')?.textContent).toBe(title);
    expect(focus?.querySelector('.qi-card')?.getAttribute('style')).toContain(
      '280px',
    );
  });
  it('maps eight visibly distinct references and keeps the same question in each', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(
      <QuestionReferenceGallery
        state="approval"
        agent={agent}
        title={title}
        onOpen={onOpen}
      />,
    );
    expect(host.querySelectorAll('.qg-proposal')).toHaveLength(8);
    const scales = host.querySelectorAll('.qg-hybrid-scales .qi-card');
    expect(scales).toHaveLength(5);
    for (const card of scales) {
      expect(card.getAttribute('data-state')).toBe('running');
      expect(card.querySelector('.qi-spin svg')).not.toBeNull();
    }
    const states = host.querySelectorAll('.qg-hybrid-states .qi-card');
    expect(states).toHaveLength(6);
    expect(
      Array.from(states, (card) => card.getAttribute('data-state')),
    ).toEqual(Object.keys(STATUS));
    for (const card of states) {
      expect(card.closest('details')).toBeNull();
      expect(card.getAttribute('data-appearance')).toBe('compact-notice');
      expect(card.querySelectorAll('button')).toHaveLength(1);
      expect(card.querySelector('.qi-question')?.textContent).toBe(title);
    }
    expect(host.querySelectorAll('.qg-stage .qi-card')).toHaveLength(8);
    expect(
      new Set(QUESTION_REFERENCES.map((reference) => reference.id)).size,
    ).toBe(8);
    for (const node of host.querySelectorAll('.qg-stage h3'))
      expect(node.textContent).toBe(title);
  });

  it.each(QUESTION_REFERENCES)(
    '$id preserves all six state semantics without redundant body text',
    ({ id }) => {
      for (const state of Object.keys(STATUS) as QuestionStudyState[]) {
        const host = document.createElement('div');
        host.innerHTML = renderToStaticMarkup(
          <InsetQuestionCard
            appearance={id}
            state={state}
            agent={agent}
            title={title}
            onOpen={onOpen}
          />,
        );
        expect(host.querySelectorAll('.qi-status')).toHaveLength(
          id === 'notice' ? 0 : 1,
        );
        if (id === 'notice') {
          expect(host.querySelector('.qi-card')?.getAttribute('title')).toBe(
            STATUS[state].label,
          );
          expect(
            host.querySelector('button')?.getAttribute('aria-label'),
          ).toContain(STATUS[state].label);
        } else {
          expect(host.querySelector('.qi-status')?.textContent).toBe(
            id === 'compact' && state === 'unread'
              ? '待查看'
              : STATUS[state].label,
          );
        }
        expect(
          host.querySelector('.qi-card')?.getAttribute('data-emphasized'),
        ).toBe(String(state === 'approval' || state === 'error'));
        expect(host.querySelectorAll('button')).toHaveLength(1);
        expect(host.querySelector('.qi-question svg')).toBeNull();
        expect(host.querySelector('.qi-detail')).toBeNull();
      }
    },
  );

  it.each(QUESTION_REFERENCES)(
    '$id retains identity and status at tiny size and labels optional samples',
    ({ id }) => {
      const render = (zoom: number) =>
        renderToStaticMarkup(
          <InsetQuestionCard
            appearance={id}
            state="approval"
            agent={agent}
            title={title}
            zoom={zoom}
            showSample
            attentionOnly={false}
            onOpen={onOpen}
          />,
        );
      expect(render(1)).toContain('活动样例');
      expect(render(1)).toContain('请求访问产品网站的外部链接');
      expect(render(0.1)).not.toContain('qi-content');
      expect(render(0.1)).toContain('qi-agent');
      if (id === 'notice') {
        expect(render(0.1)).not.toContain('lucide-shield-question');
      } else {
        expect(render(0.1)).toContain('lucide-shield-question');
      }
      expect(render(0.1)).toContain(
        `aria-label="打开：等你授权 · ${title} · Huabu"`,
      );
    },
  );
});
