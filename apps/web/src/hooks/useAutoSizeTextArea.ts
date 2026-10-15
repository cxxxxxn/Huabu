// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useCallback, useLayoutEffect, type RefObject } from 'react';

export function useAutoSizeTextArea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  enabled = true,
): void {
  const resize = useCallback(() => {
    const textarea = ref.current;
    if (!enabled || !textarea) return;
    textarea.style.overflowY = 'hidden';
    textarea.style.height = 'auto';
    const borderHeight = textarea.offsetHeight - textarea.clientHeight;
    textarea.style.height = textarea.value
      ? `${textarea.scrollHeight + borderHeight}px`
      : '';
    textarea.style.overflowY = '';
  }, [enabled, ref]);

  useLayoutEffect(resize, [resize, value]);

  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!enabled || !parent || typeof ResizeObserver === 'undefined') return;
    let width = parent.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      resize();
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, [enabled, ref, resize]);
}
