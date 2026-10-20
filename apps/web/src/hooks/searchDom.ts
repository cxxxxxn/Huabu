// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Shared DOM-walk helpers for the search subsystem.
 *
 * Independent of the registered `::highlight()` set so callers can
 * seek the n-th occurrence of a query string in a subtree and scroll
 * it into view without touching the visual highlight layer.
 *
 * Used by:
 *   - `InPreviewSearchBar` for Next / Prev navigation inside the
 *     expanded preview.
 *   - `CanvasSearchResults` for conversation-thread result navigation.
 */

/**
 * Find the `nth` (0-based) case-insensitive occurrence of `query`
 * inside `root`'s text nodes and return it as a `Range`, or `null`
 * if there aren't that many matches.
 *
 * Walks in document order. When the preview declares one or more
 * `[data-preview-search-content]` roots, only those document surfaces are
 * searched; otherwise the whole root is used as a compatibility fallback.
 * Hidden content and explicitly excluded chrome are always skipped.
 */
export function findNthRange(
  root: HTMLElement,
  query: string,
  nth: number,
): Range | null {
  let index = 0;
  for (const { node, offset, length } of walkTextMatches(root, query)) {
    if (index++ !== nth) continue;
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + length);
    return range;
  }
  return null;
}

/**
 * Find case-insensitive occurrences of `query` in user-facing preview text.
 * Exported so counting, highlighting, and match navigation share exactly the
 * same search boundary and visibility rules.
 */
export function findRanges(
  root: HTMLElement,
  query: string,
  maxRanges = Number.POSITIVE_INFINITY,
): Range[] {
  const ranges: Range[] = [];
  if (maxRanges <= 0) return ranges;
  for (const { node, offset, length } of walkTextMatches(root, query)) {
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + length);
    ranges.push(range);
    if (ranges.length >= maxRanges) break;
  }
  return ranges;
}

/** Count all searchable occurrences without allocating DOM Range objects. */
export function countMatches(root: HTMLElement, query: string): number {
  let count = 0;
  const matches = walkTextMatches(root, query);
  while (!matches.next().done) count += 1;
  return count;
}

function* walkTextMatches(
  root: HTMLElement,
  query: string,
): Generator<{ node: Node; offset: number; length: number }> {
  const needle = query.toLowerCase();
  if (!needle) return;
  for (const searchRoot of getSearchRoots(root)) {
    const walker = document.createTreeWalker(searchRoot, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        isSearchableTextNode(node, searchRoot)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    });
    let current = walker.nextNode();
    while (current) {
      const text = (current.textContent ?? '').toLowerCase();
      let from = 0;
      while (true) {
        const idx = text.indexOf(needle, from);
        if (idx === -1) break;
        yield { node: current, offset: idx, length: needle.length };
        from = idx + Math.max(1, needle.length);
      }
      current = walker.nextNode();
    }
  }
}

function getSearchRoots(root: HTMLElement): HTMLElement[] {
  if (root.matches('[data-preview-search-content]')) return [root];
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>('[data-preview-search-content]'),
  );
  const topLevelCandidates = candidates.filter(
    (candidate) =>
      !candidate.parentElement?.closest('[data-preview-search-content]'),
  );
  return topLevelCandidates.length > 0 ? topLevelCandidates : [root];
}

function isSearchableTextNode(node: Node, boundary: HTMLElement): boolean {
  let element = node.parentElement;
  while (element) {
    const tag = element.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return false;
    if (
      element.hidden ||
      element.getAttribute('aria-hidden') === 'true' ||
      element.hasAttribute('data-search-exclude')
    ) {
      return false;
    }
    if (
      element.style.display === 'none' ||
      element.style.visibility === 'hidden' ||
      element.classList.contains('hidden') ||
      element.classList.contains('invisible')
    ) {
      return false;
    }
    if (element === boundary) break;
    element = element.parentElement;
  }
  return true;
}

/**
 * Scroll the given `Range` into the centre of the viewport unless it
 * already sits comfortably inside it. Uses instant (non-smooth)
 * scrolling so search navigation feels snappy.
 *
 * Note: `scrollIntoView` walks up through every scrollable ancestor,
 * so this works for nested scrollers (e.g. a preview body inside a
 * panel inside the page).
 */
export function scrollRangeIntoView(range: Range): void {
  const rect = range.getBoundingClientRect();
  const target = rect.top + rect.height / 2;
  let visibleTop = 0;
  let visibleBottom = window.innerHeight;
  for (
    let parent = range.startContainer.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY))
      continue;
    const bounds = parent.getBoundingClientRect();
    if (bounds.height === 0) continue;
    visibleTop = Math.max(visibleTop, bounds.top);
    visibleBottom = Math.min(visibleBottom, bounds.bottom);
  }
  const inset = Math.min(80, Math.max(0, visibleBottom - visibleTop) / 4);
  // `rect.width === 0` happens for ranges inside not-yet-laid-out
  // text (e.g. pdf.js text-layer spans before their first paint);
  // treat that as "needs scroll" so the parent element comes into
  // view and the next observer pass can refine the position.
  if (
    rect.width === 0 ||
    target < visibleTop + inset ||
    target > visibleBottom - inset
  ) {
    range.startContainer.parentElement?.scrollIntoView({
      block: 'center',
      behavior: 'auto',
    });
  }
}

/**
 * Repeatedly try to find + scroll-to the n-th occurrence of `query`
 * inside `getRoot()`'s current value, retrying on every subtree
 * mutation until success or `timeoutMs` elapses.
 *
 * Needed because the preview content the user wants to jump into
 * mounts asynchronously:
 *   - Milkdown waits one frame after mount before rendering text.
 *   - pdf.js renders the text layer per-page after rasterising.
 *   - Office iframes mount inert and load on a delay.
 *
 * `getRoot` is a thunk (not a static element) so the caller can
 * keep returning the freshest mounted panel as React swaps it.
 *
 * Observer scope is **narrowed on the fly**: we start by watching
 * `document.body` (because the panel may not be mounted yet), and
 * as soon as `getRoot()` returns a real element we re-bind to it.
 * This is the difference between firing the rAF callback on every
 * keystroke / animation anywhere in the app and only firing it on
 * actual text-layer mounts inside the panel we care about.
 *
 * `onTimeout` fires when the watchdog elapses without ever landing
 * on a match — used by callers to surface a "couldn't locate the
 * match in this preview" hint instead of leaving the user wondering
 * why the panel didn't move.
 *
 * Returns a cancel function the caller should run when the
 * navigation intent changes (e.g. user clicks a different row).
 */
export function scheduleScrollToMatch(
  getRoot: () => HTMLElement | null,
  query: string,
  nth: number,
  options?: {
    timeoutMs?: number;
    onTimeout?: () => void;
    onMatch?: (range: Range) => void;
    fallbackToFirst?: boolean;
  },
): () => void {
  if (!query) return () => {};
  const timeoutMs = options?.timeoutMs ?? 8000;
  const onTimeout = options?.onTimeout;

  let cancelled = false;
  let observer: MutationObserver | null = null;
  let observedTarget: Node | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let rafId = 0;
  let resolved = false;
  const preparedChatRoots = new WeakSet<HTMLElement>();
  let preparedChatRoot: HTMLElement | null = null;

  const cleanup = (): void => {
    preparedChatRoot?.dispatchEvent(new Event('chat-search-finished'));
    preparedChatRoot = null;
    observer?.disconnect();
    observer = null;
    observedTarget = null;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const tryScroll = (): boolean => {
    if (cancelled) return true;
    const root = getRoot();
    if (!root) return false;
    if (root.matches('[data-chat-thread-root]')) {
      if (root.closest('[data-preview-active="false"]')) return false;
      if (!preparedChatRoots.has(root)) {
        const request = new Event('chat-reveal-search', { cancelable: true });
        root.dispatchEvent(request);
        if (!request.defaultPrevented) return false;
        preparedChatRoots.add(root);
        preparedChatRoot = root;
      }
      if (
        root.hasAttribute('data-chat-cached-earlier') ||
        root.hasAttribute('data-chat-has-older') ||
        root.hasAttribute('data-chat-history-loading')
      )
        return false;
    }
    // Document source ordinals can differ from rendered Markdown. Conversation
    // ordinals must never fall back to an unrelated, more recent occurrence.
    const range =
      findNthRange(root, query, nth) ??
      (root.matches('[data-chat-thread-root]') ||
      options?.fallbackToFirst === false
        ? null
        : findNthRange(root, query, 0));
    if (!range) return false;
    scrollRangeIntoView(range);
    options?.onMatch?.(range);
    return true;
  };

  const onMutation: MutationCallback = () => {
    if (cancelled || rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      // Narrow the observer to the panel root as soon as one exists.
      // Until then we have to listen on body — the panel might mount
      // in response to a `jumpToResult` call running in the same
      // tick this schedule was registered.
      ensureNarrowedObserver();
      if (tryScroll()) {
        resolved = true;
        cleanup();
      }
    });
  };

  const ensureNarrowedObserver = (): void => {
    const root = getRoot();
    const desired: Node = root ?? document.body;
    if (observedTarget === desired) return;
    observer?.disconnect();
    observer = new MutationObserver(onMutation);
    observer.observe(desired, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'data-chat-cached-earlier',
        'data-chat-has-older',
        'data-chat-history-loading',
        'data-preview-active',
      ],
    });
    observedTarget = desired;
  };

  if (tryScroll()) {
    cleanup();
    return () => {
      cancelled = true;
    };
  }

  ensureNarrowedObserver();

  timer = setTimeout(() => {
    cleanup();
    if (!resolved && !cancelled) onTimeout?.();
  }, timeoutMs);

  return () => {
    cancelled = true;
    cleanup();
  };
}
