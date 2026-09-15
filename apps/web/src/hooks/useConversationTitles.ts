// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useEffect } from 'react';

import {
  needsConversationTitleRefresh,
  refreshConversationTitles,
  useConversationTitleStore,
} from '@/store/conversationTitleStore';

import type { CanvasPreviewWorkspace } from '@/store/previewWorkspace/model';

/** One workspace subscription includes cold tabs; renderers never fetch titles. */
export function useConversationTitles(workspace: CanvasPreviewWorkspace) {
  const targets = JSON.stringify(
    Object.values(workspace.tabs)
      .flatMap(({ target }) =>
        target.kind === 'chat' ? [[target.canvasId, target.threadId]] : [],
      )
      .sort(),
  );
  const epoch = useConversationTitleStore((state) => state.refreshEpoch);
  useEffect(() => {
    const addresses = JSON.parse(targets) as [string, string][];
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async (unresolvedOnly: boolean) => {
      const batches = new Map<string, string[]>();
      for (const [canvasId, threadId] of addresses) {
        if (
          unresolvedOnly &&
          !needsConversationTitleRefresh(canvasId, threadId)
        )
          continue;
        const ids = batches.get(canvasId) ?? [];
        ids.push(threadId);
        batches.set(canvasId, ids);
      }
      await Promise.all(
        [...batches].map(([canvasId, ids]) =>
          refreshConversationTitles(canvasId, ids),
        ),
      );
    };
    // Generation can outlive the answer stream. Retry only unresolved titles,
    // for a finite window; focus/reopen and later turns start a fresh window.
    const delays = [1000, 3000, 10000, 30000, 60000];
    const run = async (attempt: number) => {
      await refresh(attempt > 0);
      if (!cancelled && attempt < delays.length)
        timer = setTimeout(() => {
          void run(attempt + 1);
        }, delays[attempt]);
    };
    void run(0);
    const onFocus = () => {
      void refresh(false);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [targets, epoch]);
}
