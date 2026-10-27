// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import deepEqual from 'fast-deep-equal';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { isEditableTarget } from '@/hooks/shortcuts/isEditableTarget';
import {
  captureMessageListScrollAnchor,
  readChatViewport,
  readMessageListScrollBookmark,
  rememberChatViewport,
} from '@/store/previewWorkspace/scrollMemory';

import { AIMessage } from './AIMessage';
import {
  isMessageListNearBottom,
  positionMessageListOnOpen,
  rememberMessageListScrollAnchor,
  rememberMessageListScrollPosition,
  restoreMessageListScrollPosition,
} from './messageListScroll';
import { StatusMessage } from './StatusMessage';
import { useChatDisplayWindow } from './useChatDisplayWindow';
import { UserMessage } from './UserMessage';
import { Button } from '../Common/Button';
import { Loading } from '../Common/Loading';
import { ThinkingIndicator } from '../Common/ThinkingIndicator';

import type { MessageListPreferredPosition } from './messageListScroll';
import type { ChatMessage } from '../../store/chatTypes';

interface MessageListProps {
  messages: ChatMessage[];
  recentTurnCount?: number;
  activationId?: number;
  completedTurnId?: string;
  /** Changes when this panel's composer submits a message. */
  submissionNonce?: number;
  threadId?: string;
  isLoading: boolean;
  /**
   * True while the chat history is being hydrated from the server.
   * Rendered as a skeleton placeholder — distinct from `isLoading`
   * (which means the agent is actively producing a response).
   */
  isHistoryLoading?: boolean;
  /** Hide action buttons on AI messages (e.g. in operate mode). */
  hideAIActions?: boolean;
  /** Called when the user clicks retry on an interrupted status message. */
  onRetry?: () => void;
  /** Whether the server has complete display turns older than this window. */
  hasOlderHistory?: boolean;
  /** Number of turns the next expansion will request. */
  olderTurnBatchSize?: number;
  /** True while an older page is being prepended. */
  isLoadingOlderHistory?: boolean;
  /** A recoverable older-page error; current messages remain visible. */
  olderHistoryError?: string;
  /** Fetch and prepend the next older page. */
  onLoadOlderHistory?: () => void;
  /** Stable identity for the conversation currently rendered by the list. */
  viewKey?: string;
  /** Whether the containing panel is expanded and visible. */
  isActive?: boolean;
  /** Where to position the list when the conversation opens. */
  openPosition?: MessageListPreferredPosition;
  /** Identity of an explicit one-shot positioning request. */
  openPositionRequestNonce?: number;
  onOpenPositionHandled?: (nonce: number) => void;
}

export const MessageList = memo(function MessageList({
  messages: cachedMessages,
  recentTurnCount,
  activationId,
  completedTurnId,
  submissionNonce,
  threadId,
  isLoading,
  isHistoryLoading,
  hideAIActions,
  onRetry,
  hasOlderHistory,
  olderTurnBatchSize,
  isLoadingOlderHistory,
  olderHistoryError,
  onLoadOlderHistory,
  viewKey,
  isActive = true,
  openPosition = 'bottom',
  openPositionRequestNonce,
  onOpenPositionHandled,
}: MessageListProps) {
  const { t } = useTranslation();
  const [storedReturnState, setReturnState] = useState(() => ({
    viewKey,
    activationId,
    bookmark: readMessageListScrollBookmark(viewKey),
    viewport: readChatViewport(viewKey),
    dismissed: false,
  }));
  let returnState = storedReturnState;
  if (
    returnState.viewKey !== viewKey ||
    returnState.activationId !== activationId
  ) {
    returnState = {
      viewKey,
      activationId,
      bookmark: readMessageListScrollBookmark(viewKey),
      viewport: readChatViewport(viewKey),
      dismissed: false,
    };
    setReturnState(returnState);
  }
  const tail = cachedMessages.at(-1);
  const restoreViewport =
    recentTurnCount !== undefined &&
    returnState.viewport &&
    deepEqual(returnState.viewport.tail, tail)
      ? returnState.viewport
      : undefined;
  const displayWindow = useChatDisplayWindow(
    cachedMessages,
    recentTurnCount,
    viewKey,
    activationId,
    openPositionRequestNonce === undefined
      ? restoreViewport?.firstMessageId
      : undefined,
  );
  const messages = displayWindow.messages;
  const [returnError, setReturnError] = useState(false);
  const [pendingReturn, setPendingReturn] =
    useState<ReturnType<typeof readMessageListScrollBookmark>>();
  const [hasNewMessage, setHasNewMessage] = useState(false);
  const [isAwayFromBottom, setIsAwayFromBottom] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const previousMessagesRef = useRef(messages);
  const lastScrollTopRef = useRef(0);
  const scrollInteractionRef = useRef(0);
  const touchYRef = useRef<number | undefined>(undefined);
  const readingScrollRef = useRef<{
    top: number;
    height: number;
    viewportHeight: number;
    expires: number;
  } | null>(null);
  const readingScrollDistanceRef = useRef(0);
  const scrollbarPointerRef = useRef<number | undefined>(undefined);
  const observedSubmissionRef = useRef({ viewKey, submissionNonce });
  const positionedViewKeyRef = useRef<string | undefined>(undefined);
  const hasPositionedViewRef = useRef(false);
  const positionedActivationRef = useRef(activationId);
  const observedCompletionRef = useRef(completedTurnId);
  const explicitReadingRef = useRef(false);
  const [revealingSearch, setRevealingSearch] = useState(false);
  const requestedSearchPageRef = useRef<string | undefined>(undefined);
  const handledOpenRequestRef = useRef<number | undefined>(undefined);
  const prependAnchorRef = useRef<{
    messageId: string;
    viewportTop: number;
  } | null>(null);
  const prependObserverRef = useRef<ResizeObserver | null>(null);
  const prependSettleTimerRef = useRef<number | undefined>(undefined);

  const canScroll = useCallback(() => {
    const container = containerRef.current;
    return (
      !!container &&
      isActive &&
      !isHistoryLoading &&
      container.closest('[data-preview-active="false"]') === null
    );
  }, [isActive, isHistoryLoading]);

  const dismissReadingReturn = useCallback(() => {
    setReturnState((state) =>
      state.dismissed ? state : { ...state, dismissed: true },
    );
    setReturnError(false);
    readingScrollRef.current = null;
    readingScrollDistanceRef.current = 0;
  }, []);

  useLayoutEffect(() => {
    const previous = observedSubmissionRef.current;
    observedSubmissionRef.current = { viewKey, submissionNonce };
    if (
      previous.viewKey === viewKey &&
      previous.submissionNonce !== submissionNonce
    ) {
      dismissReadingReturn();
    }
  }, [viewKey, submissionNonce, dismissReadingReturn]);

  const syncScrollAnchoring = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    // Keep the browser out of Huabu-owned scrolling, but anchor ordinary reading.
    container.style.overflowAnchor =
      isAtBottomRef.current || prependAnchorRef.current ? 'none' : 'auto';
  }, []);

  const updateBottomAffordance = useCallback(() => {
    const container = containerRef.current;
    if (!container || !canScroll()) return;
    syncScrollAnchoring();
    const atBottom = isMessageListNearBottom(container);
    setIsAwayFromBottom(!atBottom);
    if (atBottom) setHasNewMessage(false);
    const bookmark = returnState.dismissed ? undefined : returnState.bookmark;
    const anchor = bookmark
      ? Array.from(
          container.querySelectorAll<HTMLElement>('[data-chat-message-id]'),
        ).find(
          (element) => element.dataset.chatMessageId === bookmark.messageId,
        )
      : undefined;
    const targetTop =
      anchor && bookmark
        ? Math.max(
            0,
            Math.min(
              container.scrollHeight - container.clientHeight,
              container.scrollTop +
                anchor.getBoundingClientRect().top -
                container.getBoundingClientRect().top -
                bookmark.offsetTop,
            ),
          )
        : undefined;
    if (
      targetTop !== undefined &&
      Math.abs(container.scrollTop - targetTop) <= 2
    ) {
      dismissReadingReturn();
    }
    lastScrollTopRef.current = container.scrollTop;
    if (recentTurnCount !== undefined) {
      const pendingAnchor = prependAnchorRef.current;
      rememberChatViewport(viewKey, {
        scrollTop: container.scrollTop,
        messageAnchor: pendingAnchor
          ? {
              messageId: pendingAnchor.messageId,
              offsetTop:
                pendingAnchor.viewportTop -
                container.getBoundingClientRect().top,
            }
          : atBottom
            ? undefined
            : captureMessageListScrollAnchor(container),
        firstMessageId: messages[0]?.id,
        tail,
        atBottom: !pendingAnchor && atBottom,
      });
    }
  }, [
    canScroll,
    returnState.bookmark,
    returnState.dismissed,
    viewKey,
    messages,
    tail,
    recentTurnCount,
    dismissReadingReturn,
    syncScrollAnchoring,
  ]);

  const finishPrependAnchoring = useCallback(() => {
    prependAnchorRef.current = null;
    prependObserverRef.current?.disconnect();
    prependObserverRef.current = null;
    if (prependSettleTimerRef.current !== undefined) {
      window.clearTimeout(prependSettleTimerRef.current);
      prependSettleTimerRef.current = undefined;
    }
    syncScrollAnchoring();
  }, [syncScrollAnchoring]);

  const schedulePrependAnchorSettlement = useCallback(() => {
    if (prependSettleTimerRef.current !== undefined) {
      window.clearTimeout(prependSettleTimerRef.current);
    }
    prependSettleTimerRef.current = window.setTimeout(
      finishPrependAnchoring,
      500,
    );
  }, [finishPrependAnchoring]);

  // Unchanged conversations keep their viewport; explicit navigation wins.
  useLayoutEffect(() => {
    if (!canScroll()) return;
    const container = containerRef.current;
    if (!container) return;
    const viewChanged =
      !hasPositionedViewRef.current || positionedViewKeyRef.current !== viewKey;
    const hasNewRequest =
      openPositionRequestNonce !== undefined &&
      handledOpenRequestRef.current !== openPositionRequestNonce;
    const activationChanged = positionedActivationRef.current !== activationId;
    if (!viewChanged && !hasNewRequest && !activationChanged) return;
    readingScrollRef.current = null;
    readingScrollDistanceRef.current = 0;
    finishPrependAnchoring();
    container.style.overflowAnchor = 'none';
    explicitReadingRef.current = hasNewRequest && openPosition === 'last-user';
    setReturnError(false);
    if (hasNewRequest) {
      setReturnState({
        viewKey,
        activationId,
        bookmark: undefined,
        viewport: undefined,
        dismissed: true,
      });
      setPendingReturn(undefined);
    }

    const savedViewport = !hasNewRequest ? restoreViewport : undefined;
    let restored = false;
    if (savedViewport?.atBottom) {
      positionMessageListOnOpen(container, 'bottom');
      restored = true;
    } else if (savedViewport || recentTurnCount === undefined) {
      restored = restoreMessageListScrollPosition(
        container,
        viewKey,
        savedViewport,
      );
    }
    if (savedViewport && !restored) setReturnError(true);
    if (savedViewport && restored) dismissReadingReturn();
    if (restored && savedViewport?.messageAnchor && !savedViewport.atBottom) {
      prependAnchorRef.current = {
        messageId: savedViewport.messageAnchor.messageId,
        viewportTop:
          container.getBoundingClientRect().top +
          savedViewport.messageAnchor.offsetTop,
      };
    }
    const restoredAtBottom =
      restored &&
      (savedViewport?.atBottom ?? isMessageListNearBottom(container));
    const position = restored
      ? restoredAtBottom
        ? 'bottom'
        : 'restored'
      : positionMessageListOnOpen(container, openPosition);
    isAtBottomRef.current = position !== 'last-user' && position !== 'restored';

    setHasNewMessage(
      restored &&
        !restoredAtBottom &&
        hasNewRequest &&
        openPosition === 'last-user',
    );
    previousMessagesRef.current = messages;
    updateBottomAffordance();
    positionedViewKeyRef.current = viewKey;
    positionedActivationRef.current = activationId;
    hasPositionedViewRef.current = true;
    if (openPositionRequestNonce !== undefined) {
      handledOpenRequestRef.current = openPositionRequestNonce;
      onOpenPositionHandled?.(openPositionRequestNonce);
    }
    if (!restored) return;
    const interaction = scrollInteractionRef.current;
    const frame = requestAnimationFrame(() => {
      const current = containerRef.current;
      if (
        !current ||
        !canScroll() ||
        interaction !== scrollInteractionRef.current
      ) {
        return;
      }
      if (savedViewport?.atBottom) positionMessageListOnOpen(current, 'bottom');
      else restoreMessageListScrollPosition(current, viewKey, savedViewport);
      isAtBottomRef.current =
        savedViewport?.atBottom ?? isMessageListNearBottom(current);
      updateBottomAffordance();
    });
    return () => cancelAnimationFrame(frame);
  }, [
    viewKey,
    isActive,
    isHistoryLoading,
    openPosition,
    openPositionRequestNonce,
    onOpenPositionHandled,
    finishPrependAnchoring,
    canScroll,
    messages,
    updateBottomAffordance,
    activationId,
    recentTurnCount,
    restoreViewport,
    dismissReadingReturn,
  ]);

  useLayoutEffect(() => {
    if (!pendingReturn || !canScroll()) return;
    if (pendingReturn !== returnState.bookmark) {
      setPendingReturn(undefined);
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    const anchor = Array.from(
      container.querySelectorAll<HTMLElement>('[data-chat-message-id]'),
    ).find(
      (element) => element.dataset.chatMessageId === pendingReturn.messageId,
    );
    if (anchor) {
      const viewportTop =
        container.getBoundingClientRect().top + pendingReturn.offsetTop;
      container.scrollTop += anchor.getBoundingClientRect().top - viewportTop;
      prependAnchorRef.current = {
        messageId: pendingReturn.messageId,
        viewportTop,
      };
      updateBottomAffordance();
      dismissReadingReturn();
    } else {
      setReturnError(true);
      setReturnState({
        viewKey,
        activationId,
        bookmark: undefined,
        viewport: undefined,
        dismissed: true,
      });
    }
    setPendingReturn(undefined);
  }, [
    pendingReturn,
    messages,
    canScroll,
    updateBottomAffordance,
    returnState.bookmark,
    viewKey,
    activationId,
    dismissReadingReturn,
  ]);

  useLayoutEffect(() => {
    const pending = prependAnchorRef.current;
    const container = containerRef.current;
    const content = contentRef.current;
    if (!pending || !container || !content) return;

    const restoreAnchor = () => {
      if (!canScroll() || prependAnchorRef.current !== pending) return;
      const anchor = Array.from(
        content.querySelectorAll<HTMLElement>('[data-chat-message-id]'),
      ).find((element) => element.dataset.chatMessageId === pending.messageId);
      if (!anchor) {
        finishPrependAnchoring();
        return;
      }
      const delta = anchor.getBoundingClientRect().top - pending.viewportTop;
      if (delta !== 0) {
        readingScrollRef.current = null;
        container.scrollTop += delta;
        rememberMessageListScrollPosition(viewKey, container.scrollTop);
      }
      schedulePrependAnchorSettlement();
      updateBottomAffordance();
    };

    restoreAnchor();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(restoreAnchor);
      observer.observe(content);
      prependObserverRef.current?.disconnect();
      prependObserverRef.current = observer;
    }
    const frame = requestAnimationFrame(restoreAnchor);
    return () => cancelAnimationFrame(frame);
  }, [
    messages,
    viewKey,
    finishPrependAnchoring,
    schedulePrependAnchorSettlement,
    canScroll,
    updateBottomAffordance,
  ]);

  // Find the in-flight assistant message for the *current* turn.
  //
  // We walk backwards from the tail and stop at the most recent `user`
  // message — any assistant message that appears before that user turn
  // belongs to a *previous* exchange and must not be tagged as
  // streaming. This matters during the "preparing prompt" phase
  // (external ACP agents): a fresh `user` + `prepared-prompt` pair is
  // already in the list, but the new assistant message isn't inserted
  // until the first content event arrives. Without this guard, naive
  // `findLast(role === 'assistant')` returns the *previous* turn's
  // assistant message and the `ThinkingIndicator` ends up attached to
  // the wrong bubble.
  const streamingAssistantId = (() => {
    if (!isLoading) return undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!m) continue;
      if (m.role === 'user') return undefined;
      if (m.role === 'assistant') return m.id;
    }
    return undefined;
  })();

  // Track whether the user is scrolled near the bottom
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el || !canScroll()) return;
    const readingScroll = readingScrollRef.current;
    if (readingScroll && performance.now() <= readingScroll.expires) {
      // Layout compensation and input can share a scroll event; do not count ambiguous movement.
      const layoutChanged =
        readingScroll.height !== el.scrollHeight ||
        readingScroll.viewportHeight !== el.clientHeight;
      const delta = layoutChanged ? 0 : el.scrollTop - readingScroll.top;
      readingScroll.top = el.scrollTop;
      readingScroll.height = el.scrollHeight;
      readingScroll.viewportHeight = el.clientHeight;
      if (delta > 0) {
        readingScrollDistanceRef.current += delta;
        if (
          readingScrollDistanceRef.current >= el.clientHeight &&
          el.clientHeight > 0
        ) {
          dismissReadingReturn();
        }
      } else if (delta < 0) {
        readingScrollDistanceRef.current = 0;
      }
    }
    // Layout growth can emit scroll events without a user leaving the bottom.
    if (el.scrollTop !== lastScrollTopRef.current) {
      scrollInteractionRef.current++;
      isAtBottomRef.current = isMessageListNearBottom(el);
    }
    if (recentTurnCount === undefined || !isAtBottomRef.current) {
      rememberMessageListScrollAnchor(el, viewKey);
    }
    updateBottomAffordance();
  }, [
    viewKey,
    canScroll,
    updateBottomAffordance,
    recentTurnCount,
    dismissReadingReturn,
  ]);

  const trackReadingScroll = (
    direction: number,
    target: EventTarget | null,
  ) => {
    const container = containerRef.current;
    if (
      !container ||
      !canScroll() ||
      returnState.dismissed ||
      !returnState.bookmark
    )
      return;
    let element = target instanceof HTMLElement ? target : null;
    while (element && element !== container) {
      if (
        element.scrollHeight > element.clientHeight &&
        /auto|scroll/.test(getComputedStyle(element).overflowY)
      )
        return;
      element = element.parentElement;
    }
    if (direction <= 0) {
      readingScrollRef.current = null;
      readingScrollDistanceRef.current = 0;
      return;
    }
    const anchor = Array.from(
      container.querySelectorAll<HTMLElement>('[data-chat-message-id]'),
    ).find(
      (row) => row.dataset.chatMessageId === returnState.bookmark?.messageId,
    );
    if (
      anchor &&
      anchor.getBoundingClientRect().top -
        container.getBoundingClientRect().top >
        returnState.bookmark.offsetTop + 2
    ) {
      readingScrollRef.current = null;
      readingScrollDistanceRef.current = 0;
      return;
    }
    // Only movement shortly after native input counts, never idle layout changes.
    readingScrollRef.current = {
      top: container.scrollTop,
      height: container.scrollHeight,
      viewportHeight: container.clientHeight,
      expires: performance.now() + 250,
    };
  };

  const takeOverScroll = useCallback(() => {
    if (!canScroll()) return;
    scrollInteractionRef.current++;
    isAtBottomRef.current = false;
    finishPrependAnchoring();
  }, [canScroll, finishPrependAnchoring]);

  const loadOlderHistory = useCallback(() => {
    const container = containerRef.current;
    if (!container || isLoadingOlderHistory) return;
    if (!displayWindow.hasCachedEarlier && !onLoadOlderHistory) return;
    readingScrollRef.current = null;
    isAtBottomRef.current = false;
    explicitReadingRef.current = true;
    const containerTop = container.getBoundingClientRect().top;
    const anchor = Array.from(
      container.querySelectorAll<HTMLElement>('[data-chat-message-id]'),
    ).find((element) => element.getBoundingClientRect().bottom > containerTop);
    if (anchor?.dataset.chatMessageId) {
      prependAnchorRef.current = {
        messageId: anchor.dataset.chatMessageId,
        viewportTop: anchor.getBoundingClientRect().top,
      };
    }
    syncScrollAnchoring();
    if (displayWindow.hasCachedEarlier) displayWindow.showEarlier();
    else onLoadOlderHistory?.();
  }, [
    isLoadingOlderHistory,
    onLoadOlderHistory,
    displayWindow,
    syncScrollAnchoring,
  ]);

  useEffect(() => {
    if (!isLoadingOlderHistory && olderHistoryError) {
      finishPrependAnchoring();
    }
  }, [finishPrependAnchoring, isLoadingOlderHistory, olderHistoryError]);

  // Scroll the thread's own container rather than `scrollIntoView` on a
  // sentinel: that walks up every scrollable ancestor, and the app root is
  // `overflow: hidden`, so any bubbling scroll shifts the whole UI with no
  // scrollbar left to undo it.
  const scrollThreadToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el || !canScroll()) return;
    readingScrollRef.current = null;
    el.style.overflowAnchor = 'none';
    el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
    updateBottomAffordance();
  }, [canScroll, updateBottomAffordance]);

  const observeNativeScroll = useCallback(() => {
    const container = containerRef.current;
    // Native movement can precede its scroll event, including at turn completion.
    if (
      container &&
      container.scrollTop !== lastScrollTopRef.current &&
      !prependAnchorRef.current
    ) {
      isAtBottomRef.current = isMessageListNearBottom(container);
    }
  }, []);

  useLayoutEffect(() => {
    if (canScroll()) observeNativeScroll();
    const previous = previousMessagesRef.current;
    previousMessagesRef.current = messages;
    const tail = messages[messages.length - 1];
    if (
      canScroll() &&
      tail &&
      tail !== previous[previous.length - 1] &&
      !isAtBottomRef.current &&
      !prependAnchorRef.current &&
      !isLoadingOlderHistory
    ) {
      setHasNewMessage(true);
    }
    if (isAtBottomRef.current && !prependAnchorRef.current) {
      scrollThreadToBottom();
    } else {
      updateBottomAffordance();
    }
  }, [
    messages,
    isLoading,
    isLoadingOlderHistory,
    canScroll,
    scrollThreadToBottom,
    updateBottomAffordance,
    observeNativeScroll,
  ]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content || !canScroll()) return;
    const resize = () => {
      if (!canScroll() || container.clientHeight === 0) return;
      observeNativeScroll();
      if (isAtBottomRef.current && !prependAnchorRef.current) {
        scrollThreadToBottom();
      } else {
        updateBottomAffordance();
      }
    };
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(content);
    observer?.observe(container);
    resize();
    return () => observer?.disconnect();
  }, [
    viewKey,
    canScroll,
    scrollThreadToBottom,
    updateBottomAffordance,
    observeNativeScroll,
  ]);

  const scrollToBottom = useCallback(() => {
    dismissReadingReturn();
    finishPrependAnchoring();
    scrollInteractionRef.current++;
    isAtBottomRef.current = true;
    explicitReadingRef.current = false;
    displayWindow.compact();
    scrollThreadToBottom();
  }, [
    finishPrependAnchoring,
    scrollThreadToBottom,
    displayWindow,
    dismissReadingReturn,
  ]);

  useLayoutEffect(() => {
    const previous = observedCompletionRef.current;
    observedCompletionRef.current = completedTurnId;
    if (
      completedTurnId !== previous &&
      completedTurnId !== undefined &&
      canScroll() &&
      isAtBottomRef.current &&
      !explicitReadingRef.current &&
      !prependAnchorRef.current &&
      !isLoadingOlderHistory
    ) {
      displayWindow.compact();
    }
  }, [completedTurnId, canScroll, isLoadingOlderHistory, displayWindow]);

  useLayoutEffect(() => {
    setRevealingSearch(false);
    requestedSearchPageRef.current = undefined;
  }, [viewKey, activationId, isActive]);

  useEffect(() => {
    if (
      !revealingSearch ||
      !canScroll() ||
      !hasOlderHistory ||
      isLoadingOlderHistory ||
      olderHistoryError ||
      !onLoadOlderHistory
    )
      return;
    const page = cachedMessages[0]?.id ?? '';
    if (requestedSearchPageRef.current === page) return;
    requestedSearchPageRef.current = page;
    onLoadOlderHistory();
  }, [
    revealingSearch,
    canScroll,
    hasOlderHistory,
    isLoadingOlderHistory,
    olderHistoryError,
    onLoadOlderHistory,
    cachedMessages,
  ]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !canScroll()) return;
    const revealForSearch = (event: Event) => {
      event.preventDefault();
      setReturnState({
        viewKey,
        activationId,
        bookmark: undefined,
        viewport: undefined,
        dismissed: true,
      });
      setReturnError(false);
      setPendingReturn(undefined);
      explicitReadingRef.current = true;
      isAtBottomRef.current = false;
      finishPrependAnchoring();
      requestedSearchPageRef.current = undefined;
      setRevealingSearch(true);
      displayWindow.showAll();
    };
    const finishSearch = () => setRevealingSearch(false);
    container.addEventListener('chat-reveal-search', revealForSearch);
    container.addEventListener('chat-search-finished', finishSearch);
    return () => {
      container.removeEventListener('chat-reveal-search', revealForSearch);
      container.removeEventListener('chat-search-finished', finishSearch);
    };
  }, [canScroll, finishPrependAnchoring, displayWindow, viewKey, activationId]);

  useEffect(() => finishPrependAnchoring, [finishPrependAnchoring]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onWheelCapture={(event) => {
          trackReadingScroll(event.deltaY, event.target);
          finishPrependAnchoring();
          if (event.deltaY < 0) takeOverScroll();
        }}
        onTouchStartCapture={(event) => {
          touchYRef.current = event.touches[0]?.clientY;
        }}
        onTouchMoveCapture={(event) => {
          const nextY = event.touches[0]?.clientY;
          if (nextY !== undefined && touchYRef.current !== undefined) {
            trackReadingScroll(touchYRef.current - nextY, event.target);
          }
          finishPrependAnchoring();
          if (
            nextY !== undefined &&
            touchYRef.current !== undefined &&
            nextY > touchYRef.current
          ) {
            takeOverScroll();
          }
          touchYRef.current = nextY;
        }}
        onPointerDownCapture={(event) => {
          finishPrependAnchoring();
          if (event.target === event.currentTarget) {
            scrollbarPointerRef.current = event.pointerId;
            trackReadingScroll(1, event.target);
            takeOverScroll();
          }
        }}
        onPointerMoveCapture={(event) => {
          if (scrollbarPointerRef.current === event.pointerId)
            trackReadingScroll(1, event.target);
        }}
        onPointerUpCapture={() => {
          scrollbarPointerRef.current = undefined;
        }}
        onPointerCancelCapture={() => {
          scrollbarPointerRef.current = undefined;
        }}
        onKeyDownCapture={(event) => {
          if (
            [
              'ArrowDown',
              'ArrowUp',
              'End',
              'Home',
              'PageDown',
              'PageUp',
              ' ',
            ].includes(event.key)
          ) {
            const target = event.target;
            if (
              !isEditableTarget(target) &&
              (!(target instanceof HTMLElement) ||
                !target.closest('select, button'))
            ) {
              finishPrependAnchoring();
              trackReadingScroll(
                ['ArrowUp', 'Home', 'PageUp'].includes(event.key) ||
                  (event.key === ' ' && event.shiftKey)
                  ? -1
                  : 1,
                event.target,
              );
              if (
                ['ArrowUp', 'Home', 'PageUp'].includes(event.key) ||
                (event.key === ' ' && event.shiftKey)
              ) {
                takeOverScroll();
              }
            }
          }
        }}
        data-chat-thread-root
        data-chat-thread-id={threadId}
        data-chat-cached-earlier={displayWindow.hasCachedEarlier || undefined}
        data-chat-has-older={hasOlderHistory || undefined}
        data-chat-history-loading={
          isHistoryLoading || isLoadingOlderHistory || undefined
        }
        tabIndex={-1}
        className="flex-1 overflow-x-visible overflow-y-auto px-3 [overflow-anchor:none]"
      >
        <div ref={contentRef} className="space-y-1">
          {displayWindow.hasCachedEarlier ||
          hasOlderHistory ||
          olderHistoryError ? (
            <div className="flex flex-col items-center gap-1 py-2">
              <Button
                variant="ghost"
                tone={olderHistoryError ? 'danger' : 'neutral'}
                size="sm"
                onClick={loadOlderHistory}
                disabled={isLoadingOlderHistory}
                aria-busy={isLoadingOlderHistory}
              >
                {isLoadingOlderHistory
                  ? t('chat.loadingEarlierTurns')
                  : t('chat.showEarlierTurns', {
                      count: olderTurnBatchSize ?? 3,
                    })}
              </Button>
              {olderHistoryError ? (
                <span role="alert" className="text-danger-fg text-xs">
                  {olderHistoryError}
                </span>
              ) : null}
            </div>
          ) : null}
          {(() => {
            const elements: React.ReactNode[] = [];
            let i = 0;
            while (i < messages.length) {
              const msg = messages[i]!;

              if (msg.role === 'user') {
                elements.push(
                  <div key={msg.id} data-chat-message-id={msg.id}>
                    <UserMessage
                      content={msg.content}
                      isFirst={i === 0}
                      quotedComments={msg.quotedComments}
                      inputKind={msg.inputKind}
                      inkInterpretation={msg.inkInterpretation}
                      attachments={msg.attachments}
                      selectedNodeIds={msg.selectedNodeIds}
                      selectedStrokeIds={msg.selectedStrokeIds}
                      invokedSkills={msg.invokedSkills}
                    />
                  </div>,
                );
                i++;
                continue;
              }

              if (msg.role === 'assistant') {
                const nextMessage = messages[i + 1];
                elements.push(
                  <div key={msg.id} data-chat-message-id={msg.id}>
                    <AIMessage
                      messageId={msg.id}
                      segments={msg.segments}
                      isStreaming={msg.id === streamingAssistantId}
                      endStatus={
                        nextMessage?.role === 'status'
                          ? nextMessage.status
                          : undefined
                      }
                      hideActions={hideAIActions}
                      enableComments={isActive}
                    />
                  </div>,
                );
                i++;
                continue;
              }

              if (msg.role === 'status') {
                elements.push(
                  <div key={msg.id} data-chat-message-id={msg.id}>
                    <StatusMessage
                      status={msg.status}
                      detail={msg.detail}
                      onRetry={onRetry}
                    />
                  </div>,
                );
                i++;
                continue;
              }

              i++;
            }
            return elements;
          })()}

          {isLoading && !streamingAssistantId && (
            <div className="flex justify-start">
              <div className="px-3 py-2">
                <ThinkingIndicator />
              </div>
            </div>
          )}

          {isHistoryLoading && messages.length === 0 && (
            <div className="px-3 py-2">
              <Loading variant="skeleton" layout="bare" />
            </div>
          )}
        </div>
      </div>

      {isActive && !isHistoryLoading && recentTurnCount !== undefined ? (
        returnError ? (
          <div
            role="status"
            className="border-edge-default bg-surface text-fg-muted absolute top-12 left-1/2 z-10 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-md border px-3 py-2 text-center text-xs shadow-lg"
            data-search-exclude
          >
            {t('chat.readingPositionUnavailable')}
          </div>
        ) : returnState.bookmark && !returnState.dismissed ? (
          <Button
            variant="outline"
            shape="pill"
            tone="neutral"
            className="absolute top-12 left-1/2 z-10 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 shadow-lg"
            data-search-exclude
            onClick={(event) => {
              const bookmark = returnState.bookmark;
              if (!bookmark) return;
              if (document.activeElement === event.currentTarget) {
                containerRef.current?.focus({ preventScroll: true });
              }
              if (displayWindow.revealMessage(bookmark.messageId)) {
                finishPrependAnchoring();
                explicitReadingRef.current = true;
                isAtBottomRef.current = false;
                setPendingReturn(bookmark);
                setReturnError(false);
              } else {
                setReturnError(true);
                setReturnState({
                  viewKey,
                  activationId,
                  bookmark: undefined,
                  viewport: undefined,
                  dismissed: true,
                });
              }
            }}
          >
            {t('chat.returnToReadingPosition')}
          </Button>
        ) : null
      ) : null}

      {!isHistoryLoading && !isLoading && messages.length === 0 ? (
        <div
          className="text-fg-subtle pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-xs"
          data-chat-empty-disclaimer
        >
          {t('chat.aiContentDisclaimer')}
        </div>
      ) : null}

      {isAwayFromBottom && (
        <Button
          variant="outline"
          shape="pill"
          tone="neutral"
          onClick={(event) => {
            if (document.activeElement === event.currentTarget) {
              containerRef.current?.focus({ preventScroll: true });
            }
            scrollToBottom();
          }}
          className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2 shadow-lg"
        >
          {t(hasNewMessage ? 'chat.newMessage' : 'chat.backToBottom')}
        </Button>
      )}
    </div>
  );
});
