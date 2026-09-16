// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { emptyAcpOverlay } from '@agenetes/acp-driver';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  logMetadata: vi.fn(),
}));

vi.mock('../agenetes/drivers.js', () => ({
  EXTERNAL_DRIVER_KIND: 'acp',
  agenetes: { logMetadata: mocks.logMetadata },
}));

vi.mock('../../workspace/paths.js', () => ({
  canvasAcpNamespace: (canvasId: string) => `test/${canvasId}`,
}));

import { runAcpAgent } from './service.js';

import type { AcpHandle } from '../agenetes/drivers.js';
import type { HuabuSubmission } from '../agenetes/handle.js';
import type { ChatEnvelope } from '../conversation/envelope.js';
import type { FastifyBaseLogger } from 'fastify';

async function* emptyEvents() {
  yield* [];
  return;
}

describe('runAcpAgent durable acceptance', () => {
  beforeEach(() => {
    mocks.logMetadata.mockReset().mockReturnValue({ eventCount: 7 });
  });

  it('reports the Tier-1 turn-start identity after invoking the handle', async () => {
    let handleInvoked = false;
    const handle = {
      run: vi.fn(() => {
        handleInvoked = true;
        return emptyEvents();
      }),
    } as unknown as AcpHandle;
    mocks.logMetadata.mockImplementation(() => {
      expect(handleInvoked).toBe(true);
      return { eventCount: 7 };
    });
    const onTurnStarted = vi.fn();

    for await (const _event of runAcpAgent({
      handle,
      binding: {
        profileId: 'profile-1',
        alias: 'External Agent',
      },
      threadId: 'thread-1',
      canvasId: 'canvas-1',
      envelope: {
        user: { text: '', inputKind: 'ink-intent', attachments: [] },
        skills: { invokedIds: [], resolved: [] },
        focus: {
          selection: {
            refs: [],
            selectedIds: [],
            imageAttachments: [],
            snapshotAttachments: [],
          },
        },
      } as ChatEnvelope,
      submission: {
        type: 'huabu.chat',
        content: {} as ChatEnvelope,
        rendered: [{ type: 'text', text: 'prepared' }],
      } as HuabuSubmission,
      overlay: emptyAcpOverlay(),
      logger: { info: vi.fn() } as unknown as FastifyBaseLogger,
      onTurnStarted,
    })) {
      // Drain the ACP turn.
    }

    expect(onTurnStarted).toHaveBeenCalledExactlyOnceWith({
      threadId: 'thread-1',
      turnStartSeq: 7,
    });
  });
});
