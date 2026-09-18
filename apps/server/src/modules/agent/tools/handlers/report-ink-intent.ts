// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { inkIntentReportSchema } from '@huabu/shared';

import { executeOnServerAlreadyLocked } from '../../../canvas/canvas-executor.js';
import { withCanvasMutex } from '../../../canvas/write-coordinator.js';
import { space } from '../../../storage/index.js';
import {
  activeInkIntentOwnerNodeId,
  isActiveInkIntentTurn,
} from '../../ink-intent-runtime.js';

import type {
  CanvasCommand,
  CanvasNodeId,
  InkIntentReport,
} from '@huabu/shared';
import type { CanvasNode } from '@huabu/shared/canvas-engine';

export type ReportInkIntentArgs = InkIntentReport;

const INK_PLACEHOLDER_LABEL = 'New ink request';

async function settlePendingInkQuestion(
  canvasId: string,
  threadId: string,
  text?: string,
): Promise<boolean> {
  return withCanvasMutex(canvasId, async () => {
    const ownerNodeId = activeInkIntentOwnerNodeId(canvasId, threadId);
    if (!ownerNodeId) return false;
    const handle = space(canvasId);
    const canvas = await handle.read();
    if (!canvas) return false;
    const node = (canvas.state.nodes as CanvasNode[]).find(
      (candidate) => candidate.id === ownerNodeId,
    );
    if (node?.type !== 'question' || node.data.threadId !== threadId)
      return false;
    if (node?.data.pendingInkIntentLabel !== true) return false;
    const record = (await handle.nodes.read(node.id))?.record;
    const canRename =
      text !== undefined &&
      record?.label === INK_PLACEHOLDER_LABEL &&
      record.labelSource !== 'user';
    const command: CanvasCommand = {
      type: 'MERGE_NODE_DATA',
      patches: [
        {
          nodeId: node.id as CanvasNodeId,
          patch: {
            ...(canRename
              ? { label: text, labelSource: 'agent' as const }
              : {}),
            pendingInkIntentLabel: false,
          },
        },
      ],
    };
    const output = await executeOnServerAlreadyLocked({
      canvasId,
      commands: [command],
      originator: { source: 'agent', threadId },
    });
    return canRename && output.results[0]?.applied === true;
  });
}

export async function handleReportInkIntent(
  args: ReportInkIntentArgs,
  context?: { canvasId?: string; threadId?: string },
): Promise<string> {
  if (
    !context?.canvasId ||
    !context.threadId ||
    !isActiveInkIntentTurn(context.canvasId, context.threadId)
  ) {
    throw new Error('report_ink_intent is available only during an Ink turn');
  }
  const report = inkIntentReportSchema.parse(args);
  const renamed = await settlePendingInkQuestion(
    context.canvasId,
    context.threadId,
    report.status === 'inferred' ? report.text : undefined,
  );
  return JSON.stringify({ ...report, renamed });
}
