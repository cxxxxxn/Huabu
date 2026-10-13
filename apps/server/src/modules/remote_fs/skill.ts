// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Skill / prompt delivery for the RFS (`GET /api/rfs/:canvasId/skill*`).
 *
 * Resolver: return the bundled HTTP or CLI root guide followed by live Space
 * Skill Frames. The served guide is the single source of truth for how an
 * external agent reaches back into the canvas.
 */

import { renderPromptFile } from '../../prompt/agents/loader.js';
import { getLogger } from '../../utils/logger.js';
import { resolveSpaceSkill } from '../agent/space-instruction-frames.js';

/** PROMPT-ROOT-relative path of the bundled access guide. */
const ACCESS_GUIDE_TEMPLATE = 'external-agent/access-huabu.md';
const logger = getLogger('rfs-skill');

const FOCUSED_SKILL_TEMPLATES = {
  layout: 'external-agent/layout.md',
  tasks: 'external-agent/tasks.md',
  agents: 'external-agent/agents.md',
  'interactive-views': 'external-agent/interactive-views.md',
  'service-config': 'external-agent/service-config.md',
  'rfs-get-skill': 'external-agent/rfs-cli/get-skill.md',
  'rfs-query': 'external-agent/rfs-cli/query.md',
  'rfs-execute': 'external-agent/rfs-cli/execute.md',
  'rfs-download': 'external-agent/rfs-cli/download.md',
  'rfs-upload': 'external-agent/rfs-cli/upload.md',
  'rfs-agent': 'external-agent/rfs-cli/agent.md',
  'rfs-service': 'external-agent/rfs-cli/service.md',
} as const;

export type RfsFocusedSkillId = keyof typeof FOCUSED_SKILL_TEMPLATES;

/** Resolve the public root guide without consulting Canvas storage. */
export function resolveBundledRootSkill(): string {
  return renderPromptFile(ACCESS_GUIDE_TEMPLATE);
}

/**
 * Resolve the canvas-access guide for `canvasId`: the bundled default followed
 * by live Skill Frames. Returned as raw markdown text.
 */
export async function resolveCanvasSkill(
  canvasId: string,
  format: 'http' | 'cli' = 'http',
): Promise<string> {
  const frameSkill = await resolveSpaceSkill(canvasId).catch(
    (error: unknown) => {
      logger.warn(
        { err: error, canvasId },
        'Space Skill Frame collection failed; serving the root guide only',
      );
      return null;
    },
  );
  const guide =
    format === 'cli'
      ? renderPromptFile('external-agent/rfs-cli/index.md')
      : resolveBundledRootSkill();
  return frameSkill ? `${guide}\n\n${frameSkill.markdown}` : guide;
}

/** Resolve one fixed, authenticated advanced guide. */
export function resolveFocusedSkill(skillId: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(FOCUSED_SKILL_TEMPLATES, skillId)) {
    return null;
  }
  return renderPromptFile(
    FOCUSED_SKILL_TEMPLATES[skillId as RfsFocusedSkillId],
  );
}
