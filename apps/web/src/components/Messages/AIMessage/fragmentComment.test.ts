// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';

import {
  appendFragmentComment,
  commentTemplateLanguage,
  renderFragmentComment,
  type FragmentComment,
} from './fragmentComment';

const labels = { quote: 'Quote:', comment: 'Comment:', context: 'Context:' };
const fragment: FragmentComment = {
  sourceMessageId: 'answer-1',
  segmentIndex: 0,
  range: { from: 1, to: 8 },
  text: 'one\n\ntwo',
  contextBefore: '',
  contextAfter: '',
  comment: 'Keep this.',
};

describe('fragment comment templates', () => {
  it.each([
    ['请保留 API', 'en', 'zh-CN'],
    ['Please keep this', 'zh-CN', 'en'],
    ['你好', 'en', 'zh-CN'],
    ['123 👍', 'zh-CN', 'zh-CN'],
    ['123 👍', 'en', 'en'],
    ['/review', 'zh-CN', 'en'],
  ])('chooses a template for %s with UI %s', (comment, ui, expected) => {
    expect(commentTemplateLanguage(comment, ui)).toBe(expected);
  });

  it('quotes every line and preserves code, Unicode and user comments', () => {
    expect(
      renderFragmentComment(
        {
          ...fragment,
          text: '/review\n\nconst value = "你好";',
          comment: '  Keep\nthese lines.  ',
        },
        labels,
      ),
    ).toBe(
      'Quote:\n> /review\n> \n> const value = "你好";\n\nComment:\nKeep\nthese lines.',
    );
  });

  it('includes captured context without exposing local identity or offsets', () => {
    const rendered = renderFragmentComment(
      {
        ...fragment,
        contextBefore: 'first\noccurrence ',
        contextAfter: ' continues',
      },
      labels,
    );
    expect(rendered).toContain('Context:\nfirst occurrence […] continues');
    expect(rendered).not.toContain('answer-1');
    expect(rendered).not.toContain('from');
  });

  it.each(['', 'Draft', 'Draft\n', 'Draft\n\n'])(
    'appends to %j without losing text',
    (draft) => {
      const first = appendFragmentComment(
        draft,
        renderFragmentComment(fragment, labels),
      );
      const second = appendFragmentComment(
        first,
        renderFragmentComment({ ...fragment, comment: 'Explore.' }, labels),
      );
      expect(second.startsWith(draft)).toBe(true);
      expect(second).toContain('Comment:\nKeep this.');
      expect(second).toContain('Comment:\nExplore.');
      expect(second).not.toContain('\n\n\nQuote:');
    },
  );
});
