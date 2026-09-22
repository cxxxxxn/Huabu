// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InsetQuestionCard } from './QuestionInsetStudy';
import { STATUS } from './QuestionStatusZoomStudy';

import type { QuestionStudyState } from './QuestionStatusZoomStudy';

const agent = { kind: 'internal', alias: 'Huabu', mode: 'operate' } as const;
const title = '按产品整理网站内容框架';
const render = (state: QuestionStudyState, zoom = 1, showSample = false) =>
  renderToStaticMarkup(
    <InsetQuestionCard
      state={state}
      agent={agent}
      title={title}
      zoom={zoom}
      showSample={showSample}
      onOpen={() => {}}
    />,
  );

describe('inset Question design study', () => {
  it.each(Object.keys(STATUS) as QuestionStudyState[])(
    'keeps identity and state in the header and the question in its own surface: %s',
    (state) => {
      const host = document.createElement('div');
      host.innerHTML = render(state);
      expect(host.querySelector('.qi-header')?.textContent).toContain(
        STATUS[state].label,
      );
      expect(host.querySelector('.qi-agent')?.textContent).toBe('Huabu');
      expect(host.querySelector('.qi-content h3')?.textContent).toBe(title);
      expect(host.querySelector('.qi-question svg')).toBeNull();
      expect(
        host.querySelector('button')?.getAttribute('aria-label'),
      ).toContain(title);
    },
  );
  it('omits redundant status guidance and empty detail rows in every default state', () => {
    expect(render('approval')).not.toContain('有待处理的权限请求');
    for (const state of [
      'draft',
      'running',
      'approval',
      'unread',
      'viewed',
      'error',
    ] as const)
      expect(render(state)).not.toContain('qi-detail');
    expect(render('unread')).not.toContain('任务完成');
    expect(render('error')).not.toContain('链接读取失败');
  });
  it('labels optional activity and reply examples and hides them before the question at smaller sizes', () => {
    expect(render('approval', 1, true)).toContain('请求访问产品网站的外部链接');
    expect(render('approval', 1, true)).toContain('活动样例');
    expect(render('running', 1, true)).toContain('活动样例');
    expect(render('unread', 1, true)).toContain('回答样例');
    expect(render('unread', 0.5, true)).not.toContain('qi-detail');
    expect(render('unread', 0.5, true)).toContain('<h3');
    expect(render('approval', 0.1)).not.toContain('qi-content');
    expect(render('approval', 0.1)).toContain('lucide-shield-question');
    expect(render('approval', 0.1)).toContain('qi-agent');
  });
});
