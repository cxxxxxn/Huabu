// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  questionStudyLayout,
  QuestionStatusSpecimen,
} from './QuestionStatusZoomStudy';

import type { QuestionStudyState } from './QuestionStatusZoomStudy';

const agent = { kind: 'internal', alias: 'Huabu', mode: 'operate' } as const;

describe('status-first Question zoom study', () => {
  it('removes details before the question and never shrinks the status mark below the proposal floor', () => {
    expect(questionStudyLayout(1)).toMatchObject({
      showDetail: true,
      showQuestion: true,
      showStatusText: true,
    });
    expect(questionStudyLayout(0.5)).toMatchObject({
      showDetail: false,
      showQuestion: true,
      showStatusText: true,
    });
    expect(questionStudyLayout(0.25)).toMatchObject({
      showDetail: false,
      showQuestion: true,
      showStatusText: false,
    });
    expect(questionStudyLayout(0.1)).toMatchObject({
      showDetail: false,
      showQuestion: false,
      showStatusText: false,
    });
    for (const zoom of [1, 0.75, 0.5, 0.25, 0.1, 0.05])
      expect(questionStudyLayout(zoom).markSize).toBeGreaterThanOrEqual(28);
  });

  it.each<QuestionStudyState>([
    'draft',
    'running',
    'approval',
    'unread',
    'viewed',
    'error',
  ])(
    'keeps an accessible production mark and a non-color status symbol for %s at 5%',
    (state) => {
      const html = renderToStaticMarkup(
        <QuestionStatusSpecimen
          zoom={0.05}
          state={state}
          agent={agent}
          title="网站内容框架"
          onOpen={() => {}}
        />,
      );
      expect(html).toContain('data-question-takeover-mark="true"');
      expect(html).toContain('role="button"');
      expect(html).toContain(
        state === 'approval' ? 'lucide-shield-question' : 'qs-state-symbol',
      );
      expect(html).toContain('网站内容框架');
      expect(html).not.toContain('<h3');
      expect(html).not.toContain('qs-agent-detail');
    },
  );

  it('shows only explicitly enabled sample AI details at full size', () => {
    const render = (zoom: number, showExample: boolean) =>
      renderToStaticMarkup(
        <QuestionStatusSpecimen
          zoom={zoom}
          state="running"
          agent={agent}
          title="网站内容框架"
          showExample={showExample}
          onOpen={() => {}}
        />,
      );
    expect(render(1, false)).not.toContain('AI 活动：');
    expect(render(1, true)).toContain('示例 · 非实时数据');
    expect(render(0.5, true)).not.toContain('AI 活动：');
    expect(render(0.5, true)).toContain('<h3');
  });
});
