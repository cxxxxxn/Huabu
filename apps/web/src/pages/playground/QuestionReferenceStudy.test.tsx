// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  ReferenceQuestionCard,
  REFERENCE_VARIANTS,
} from './QuestionReferenceStudy';

const agent = { kind: 'internal', alias: 'Huabu', mode: 'operate' } as const;

describe('reference-led Question cards', () => {
  it.each(REFERENCE_VARIANTS)(
    '$id retains identity, status and a compact two-row layout',
    ({ id }) => {
      const html = renderToStaticMarkup(
        <ReferenceQuestionCard
          variant={id}
          state="approval"
          agent={agent}
          title="产品网站内容框架"
          onOpen={() => {}}
        />,
      );
      expect(html).toContain('qr-header');
      expect(html).toContain('qr-identity');
      expect(html).toContain('等你授权');
      expect(html).toContain('<h3');
      expect(html).not.toContain('question-agent-badge');
      expect(html).not.toContain('qn-status-zone');
      expect(html).not.toContain('progressbar');
    },
  );

  it('retains the question at half size and identity plus a state glyph at tiny sizes', () => {
    const render = (zoom: number) =>
      renderToStaticMarkup(
        <ReferenceQuestionCard
          variant="chip"
          state="error"
          agent={agent}
          title="产品网站内容框架"
          zoom={zoom}
          onOpen={() => {}}
        />,
      );
    expect(render(0.5)).toContain('<h3');
    expect(render(0.1)).not.toContain('<h3');
    expect(render(0.1)).toContain('qr-minimal');
    expect(render(0.1)).toContain('lucide-circle-alert');
    expect(render(0.1)).toContain(
      'aria-label="打开：产品网站内容框架 · 出错 · Huabu"',
    );
  });

  it('never presents a fabricated activity unless explicitly enabled and labeled', () => {
    const render = (examples: boolean) =>
      renderToStaticMarkup(
        <ReferenceQuestionCard
          variant="activity"
          state="running"
          agent={agent}
          title="产品网站"
          examples={examples}
          onOpen={() => {}}
        />,
      );
    expect(render(false)).not.toContain('正在读取产品资料');
    expect(render(true)).toContain('示例 · ');
    expect(render(true)).toContain('正在读取产品资料');
  });
});
