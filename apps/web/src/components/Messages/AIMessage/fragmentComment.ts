// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { MilkdownTextSelection } from '@/components/Milkdown/createMilkdown';

export interface FragmentComment extends MilkdownTextSelection {
  sourceMessageId: string;
  segmentIndex: number;
  comment: string;
}

export function commentTemplateLanguage(
  comment: string,
  uiLanguage: string,
): 'en' | 'zh-CN' {
  if (/\p{Script=Han}/u.test(comment)) return 'zh-CN';
  if (/[a-z]/i.test(comment)) return 'en';
  return uiLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export function renderFragmentComment(
  fragment: FragmentComment,
  labels: { quote: string; comment: string; context: string },
): string {
  const quote = fragment.text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
  const before = fragment.contextBefore.trim();
  const after = fragment.contextAfter.trim();
  const context =
    before || after
      ? `\n\n${labels.context}\n${[before, '[…]', after]
          .filter(Boolean)
          .map((part) => part.replace(/\s+/g, ' '))
          .join(' ')}`
      : '';
  return `${labels.quote}\n${quote}${context}\n\n${labels.comment}\n${fragment.comment.trim()}`;
}

export function appendFragmentComment(draft: string, rendered: string): string {
  return draft
    ? `${draft}${draft.endsWith('\n\n') ? '' : draft.endsWith('\n') ? '\n' : '\n\n'}${rendered}`
    : rendered;
}
