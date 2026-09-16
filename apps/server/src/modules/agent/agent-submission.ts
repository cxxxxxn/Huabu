// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { renderExternalAgentInputs } from './acp/preprocessor.js';
import { createChatSubmission } from './agenetes/handle.js';
import {
  assertInkModelCapability,
  InkModelCapabilityError,
} from './agent.service.js';
import { envelopeHasImage } from './conversation/envelope.js';
import { renderInternalAgentInputs } from './conversation/prompt/build-prompt.js';
import { planSkillDispatch } from './skill-model-routing.js';

import type { HuabuSubmission } from './agenetes/handle.js';
import type { ChatEnvelope } from './conversation/envelope.js';
import type { AgentBinding } from '@huabu/shared';
import type { FastifyBaseLogger } from 'fastify';

export { InkModelCapabilityError };

export async function prepareAgentSubmission(options: {
  binding: AgentBinding;
  envelope: ChatEnvelope;
  threadId: string;
  canvasId?: string;
  modelId?: string;
  logger: FastifyBaseLogger;
}): Promise<HuabuSubmission> {
  const { binding, envelope, threadId, canvasId, modelId, logger } = options;
  if (binding.kind === 'external') {
    const rendered = await renderExternalAgentInputs({
      envelope,
      agentAlias: binding.alias,
      canvasId: canvasId ?? null,
      logger,
    });
    return createChatSubmission(envelope, rendered);
  }

  const skillDispatch = planSkillDispatch(envelope.skills.resolved);
  const runsSkillAuthoring = skillDispatch.closeLiveHandle;
  const rendered = await renderInternalAgentInputs(envelope, {
    canvasId: canvasId ?? null,
  });
  await assertInkModelCapability({
    envelope,
    workloadType: skillDispatch.workloadType,
    modelRole: skillDispatch.modelRole,
    hasImage: runsSkillAuthoring ? envelopeHasImage(envelope) : undefined,
    threadId,
    canvasId,
    modelId,
  });
  return createChatSubmission(envelope, rendered);
}
