// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FarZoomText } from '@/components/Nodes/semanticZoom/FarZoomText';

describe('far-zoom word boundaries', () => {
  it.each([
    'Huabu',
    'Huabu workspace',
    '评估 Huabu 边界',
    'café Agent’s macOS',
    '版本2026',
  ])('preserves text and whole Latin words: %s', (text) => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<FarZoomText text={text} />);
    expect(host.textContent).toBe(text);
    for (const word of host.querySelectorAll<HTMLElement>(
      '[data-study-word]',
    )) {
      expect(word.style.whiteSpace).toBe('normal');
      expect(word.style.textOverflow).toBe('');
      expect(word.style.overflowWrap).toBe('anywhere');
    }
  });

  it('leaves Chinese text free to wrap and does not split Huabu into fragments', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<FarZoomText text="评估Huabu边界" />);
    expect(host.querySelectorAll('[data-study-word]')).toHaveLength(1);
    expect(host.querySelector('[data-study-word]')?.textContent).toBe('Huabu');
    expect(host.firstChild?.textContent).toBe('评估');
    expect(host.lastChild?.textContent).toBe('边界');
  });
});
