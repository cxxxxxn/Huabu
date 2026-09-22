// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  newQuestionLayout,
  NewQuestionSpecimen,
  QUESTION_DIRECTIONS,
} from './QuestionNewDirections';

const agent = { kind: 'internal', alias: 'Huabu', mode: 'operate' } as const;

describe('new Question directions', () => {
  it('prioritizes status, then title, then optional AI detail', () => {
    expect(newQuestionLayout(1)).toMatchObject({
      showTitle: true,
      showDetail: true,
      compact: false,
    });
    expect(newQuestionLayout(0.5)).toMatchObject({
      showTitle: true,
      showDetail: false,
      compact: false,
    });
    expect(newQuestionLayout(0.1)).toMatchObject({
      showTitle: false,
      showDetail: false,
      compact: true,
    });
  });

  it.each(QUESTION_DIRECTIONS)(
    '$id has its own shape without production avatar status rings',
    ({ id }) => {
      for (const zoom of [1, 0.5, 0.1]) {
        const html = renderToStaticMarkup(
          <NewQuestionSpecimen
            direction={id}
            state="approval"
            agent={agent}
            title="产品网站内容框架"
            zoom={zoom}
            onOpen={() => {}}
          />,
        );
        expect(html).toContain(`data-direction="${id}"`);
        expect(html).toContain('等你授权');
        expect(html).toContain('lucide-shield-question');
        expect(html).toContain('<button');
        expect(html).not.toContain('question-agent-badge');
        expect(html).not.toContain('qs-mark');
        expect(html.includes('<h3')).toBe(zoom >= 0.5);
        expect(html.includes('qn-identity')).toBe(zoom === 1);
      }
    },
  );

  it('only includes labeled AI samples when explicitly enabled and space permits', () => {
    const render = (zoom: number, showExample: boolean) =>
      renderToStaticMarkup(
        <NewQuestionSpecimen
          direction="ticket"
          state="running"
          agent={agent}
          title="产品网站"
          zoom={zoom}
          showExample={showExample}
          onOpen={() => {}}
        />,
      );
    expect(render(1, false)).not.toContain('AI 信息示例');
    expect(render(1, true)).toContain('AI 信息示例');
    expect(render(0.5, true)).not.toContain('AI 信息示例');
  });
});
