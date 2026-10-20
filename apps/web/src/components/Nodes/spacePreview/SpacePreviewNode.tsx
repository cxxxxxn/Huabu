// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useStore } from '@xyflow/react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { memo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { SPACE_SHORTCUT_SIZE } from '@huabu/shared/canvas-engine';

import { Button } from '@/components/Common/Button';
import { Tooltip } from '@/components/Common/Tooltip';
import { NODE_BORDER_WIDTH } from '@/components/Nodes/design/nodeBoundary';
import { NODE_CONTENT_SPACING } from '@/components/Nodes/design/nodeSpacing';
import { NODE_TYPOGRAPHY } from '@/components/Nodes/design/nodeTypography';
import { NodeWrapper } from '@/components/Nodes/NodeWrapper';
import useCanvasStore from '@/store/canvasStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { FONT_FAMILY_CSS } from '@/utils/node/nodeFontConfig';

import {
  OPEN_SPACE_SHORTCUT_EVENT,
  type OpenSpaceShortcutDetail,
} from './spaceShortcutEvents';
import { SpaceShortcutSummary } from './SpaceShortcutSummary';
import { useSpaceShortcutTarget } from './useSpaceShortcutTarget';

import type { SpacePreviewNodeData } from '@/components/Nodes/types';
import type { Node, NodeProps } from '@xyflow/react';

export type SpacePreviewNodeType = Node<SpacePreviewNodeData, 'spacePreview'>;
const typography = NODE_TYPOGRAPHY.cardTitle;

export const SpacePreviewNode = memo(
  ({ id, data, selected }: NodeProps<SpacePreviewNodeType>) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const target = useSpaceShortcutTarget(data.targetCanvasId);
    const canvasId = useCanvasStore((state) => state.canvasId);
    const workspaceId = useWorkspaceStore((state) => state.workspaceId);
    const worldId = useWorkspaceStore((state) => state.worldCanvasId);
    const isChildEntry = useWorkspaceStore(
      (state) =>
        state.spaceSummaries[data.targetCanvasId]?.parentSpaceId === canvasId &&
        state.spaceSummaries[data.targetCanvasId]?.parentEntryNodeId === id,
    );
    const liveWidth = useStore(
      (state) => state.nodeLookup.get(id)?.style?.width,
    );
    const canOpen = target.status === 'ready';
    const openTarget = useCallback(() => {
      if (canOpen) {
        const path = `/canvas/${encodeURIComponent(data.targetCanvasId)}`;
        if (isChildEntry) navigate(path);
        else
          navigate(path, { state: { returnToSpace: canvasId, workspaceId } });
      }
    }, [
      canOpen,
      data.targetCanvasId,
      navigate,
      isChildEntry,
      canvasId,
      workspaceId,
    ]);
    useEffect(() => {
      if (!selected) return;
      const open = (event: Event) => {
        if (
          (event as CustomEvent<OpenSpaceShortcutDetail>).detail?.nodeId === id
        )
          openTarget();
      };
      window.addEventListener(OPEN_SPACE_SHORTCUT_EVENT, open);
      return () => window.removeEventListener(OPEN_SPACE_SHORTCUT_EVENT, open);
    }, [id, selected, openTarget]);
    const failed =
      target.status === 'missing' ||
      target.status === 'error' ||
      target.error !== null;
    const statusText =
      target.status === 'loading'
        ? t('spacePreview.loadingTarget')
        : target.status === 'missing'
          ? t('spacePreview.missingTarget')
          : target.status === 'error' || target.error !== null
            ? (target.error ?? t('spacePreview.targetsUnavailable'))
            : t(
                isChildEntry
                  ? 'spaceHierarchy.childEntry'
                  : 'spacePreview.shortcut',
              );

    return (
      <NodeWrapper
        id={id}
        data={data}
        type="spacePreview"
        selected={selected}
        minWidth={SPACE_SHORTCUT_SIZE.minWidth}
        resizeEndClearHeight
        onDoubleClick={openTarget}
        farLabel={{ title: target.title }}
        actions={
          <>
            <Button
              variant="ghost"
              iconOnly
              title={t('spacePreview.openSpace')}
              disabled={!canOpen}
              onClick={openTarget}
            >
              <ArrowUpRight />
            </Button>
            {target.status === 'error' || target.error !== null ? (
              <Button
                variant="ghost"
                iconOnly
                title={t('spacePreview.retry')}
                onClick={target.retry}
              >
                <RefreshCw />
              </Button>
            ) : null}
          </>
        }
      >
        <div
          className="text-fg-default flex items-start"
          data-space-shortcut={data.targetCanvasId}
          data-target-status={target.status}
          style={{
            width:
              typeof liveWidth === 'number'
                ? liveWidth - 2 * NODE_BORDER_WIDTH
                : undefined,
            padding: NODE_CONTENT_SPACING.padding,
            fontFamily: FONT_FAMILY_CSS.default,
            fontSize: typography.size,
            fontWeight: typography.weight,
            lineHeight: typography.lineHeight,
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-start gap-1">
              <span
                className="line-clamp-2 min-w-0 wrap-anywhere"
                title={target.title}
              >
                {target.title}
              </span>
              {!isChildEntry &&
              canvasId !== worldId &&
              target.status === 'ready' ? (
                <Tooltip
                  content={t('spacePreview.shortcutLabel')}
                  wrapperClassName="inline-flex h-[1lh] shrink-0 items-center"
                >
                  <ArrowUpRight
                    size="1em"
                    style={{ width: '1em', height: '1em' }}
                    aria-label={t('spacePreview.shortcutLabel')}
                  />
                </Tooltip>
              ) : null}
            </div>
            {target.status === 'ready' ? (
              <SpaceShortcutSummary
                nodeCount={target.nodeCount}
                updatedAt={target.updatedAt}
              />
            ) : null}
            {target.status !== 'ready' || target.error !== null ? (
              <span
                className={failed ? 'text-warning' : 'text-fg-muted'}
                style={{
                  fontSize: NODE_TYPOGRAPHY.metadata.size,
                  lineHeight: NODE_TYPOGRAPHY.metadata.lineHeight,
                  fontWeight: 400,
                }}
                role="status"
              >
                {statusText}
              </span>
            ) : null}
          </div>
        </div>
      </NodeWrapper>
    );
  },
);

SpacePreviewNode.displayName = 'SpacePreviewNode';
