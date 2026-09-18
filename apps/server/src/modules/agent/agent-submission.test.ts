// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  renderExternal: vi.fn(),
  renderInternal: vi.fn(),
  assertInkModel: vi.fn(),
  planSkillDispatch: vi.fn(),
}));

vi.mock('./acp/preprocessor.js', () => ({
  renderExternalAgentInputs: mocks.renderExternal,
}));
vi.mock('./agent.service.js', () => ({
  assertInkModelCapability: mocks.assertInkModel,
  InkModelCapabilityError: class extends Error {
    readonly code = 'ink_model_unsupported';
  },
}));
vi.mock('./conversation/envelope.js', () => ({
  envelopeHasImage: () => true,
}));
vi.mock('./conversation/prompt/build-prompt.js', () => ({
  renderInternalAgentInputs: mocks.renderInternal,
}));
vi.mock('./skill-model-routing.js', () => ({
  planSkillDispatch: mocks.planSkillDispatch,
}));

import { prepareAgentSubmission } from './agent-submission.js';

import type { ChatEnvelope } from './conversation/envelope.js';
import type { FastifyBaseLogger } from 'fastify';

const envelope: ChatEnvelope = {
  user: { text: '', inputKind: 'ink-intent', attachments: [] },
  skills: { invokedIds: [], resolved: [] },
  focus: {
    selection: {
      refs: [],
      selectedIds: ['sketch-a'],
      imageAttachments: [],
      snapshotAttachments: [],
      strokeSubsets: [{ nodeId: 'sketch-a', strokeIds: ['stroke-a'] }],
    },
  },
};
const logger = {} as FastifyBaseLogger;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.renderInternal.mockResolvedValue([{ type: 'text', text: 'internal' }]);
  mocks.renderExternal.mockResolvedValue([{ type: 'text', text: 'external' }]);
  mocks.assertInkModel.mockResolvedValue(undefined);
  mocks.planSkillDispatch.mockReturnValue({
    closeLiveHandle: false,
    workloadType: 'Deployment',
    modelRole: 'chat',
  });
});

describe('prepareAgentSubmission', () => {
  it('renders and validates a built-in Ink submission before invocation', async () => {
    const submission = await prepareAgentSubmission({
      binding: { kind: 'internal' },
      envelope,
      threadId: 'thread-a',
      canvasId: 'canvas-a',
      modelId: 'vision-model',
      logger,
    });

    expect(mocks.renderInternal).toHaveBeenCalledWith(envelope, {
      canvasId: 'canvas-a',
    });
    expect(mocks.assertInkModel).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope,
        workloadType: 'Deployment',
        modelRole: 'chat',
        threadId: 'thread-a',
        modelId: 'vision-model',
      }),
    );
    expect(submission).toMatchObject({
      type: 'huabu.chat',
      content: envelope,
      rendered: [{ type: 'text', text: 'internal' }],
    });
    expect(mocks.renderExternal).not.toHaveBeenCalled();
  });

  it('uses ACP rendering without applying built-in model policy', async () => {
    const submission = await prepareAgentSubmission({
      binding: {
        kind: 'external',
        profileId: 'profile-a',
        alias: 'External Agent',
      },
      envelope,
      threadId: 'thread-a',
      canvasId: 'canvas-a',
      logger,
    });

    expect(mocks.renderExternal).toHaveBeenCalledWith({
      envelope,
      agentAlias: 'External Agent',
      canvasId: 'canvas-a',
      logger,
    });
    expect(mocks.assertInkModel).not.toHaveBeenCalled();
    expect(submission).toMatchObject({
      type: 'huabu.chat',
      rendered: [{ type: 'text', text: 'external' }],
    });
    expect(mocks.renderInternal).not.toHaveBeenCalled();
  });
});
