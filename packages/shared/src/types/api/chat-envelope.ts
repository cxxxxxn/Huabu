// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { z } from 'zod';

import {
  agentInputKindSchema,
  chatAttachmentSchema,
  visibleCanvasGroundingSchema,
  wireNodeRefSchema,
} from './agent.js';

const envelopeNodeSchema = wireNodeRefSchema.extend({
  filename: z.string(),
  summary: z.string().optional(),
  preview: z.string().optional(),
  rev: z.string().optional(),
});

const resolvedSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  body: z.string(),
});

const neighbourhoodSchema = z.object({
  layers: z.array(
    z.object({
      frameId: z.string().optional(),
      frameLabel: z.string().optional(),
      groups: z.array(
        z.object({
          dx: z.number(),
          dy: z.number(),
          arrangement: z.string(),
          frameId: z.string().optional(),
          frameLabel: z.string().optional(),
          nodes: z.array(envelopeNodeSchema),
          _minEdgeDist: z.number(),
        }),
      ),
    }),
  ),
  relevantEdges: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      sourceLabel: z.string().optional(),
      targetLabel: z.string().optional(),
    }),
  ),
});

export const chatEnvelopeSchema = z.object({
  user: z.object({
    text: z.string(),
    inputKind: agentInputKindSchema.optional(),
    attachments: z.array(chatAttachmentSchema),
  }),
  skills: z.object({
    invokedIds: z.array(z.string()),
    resolved: z.array(resolvedSkillSchema),
  }),
  focus: z.object({
    groundingVisual: visibleCanvasGroundingSchema.optional(),
    selection: z.object({
      refs: z.array(envelopeNodeSchema),
      selectedIds: z.array(z.string()),
      imageAttachments: z.array(chatAttachmentSchema),
      snapshotAttachments: z.array(chatAttachmentSchema),
      strokeSubsets: z
        .array(
          z.object({
            nodeId: z.string(),
            strokeIds: z.array(z.string()),
          }),
        )
        .optional(),
    }),
    anchor: z
      .object({
        nodeId: z.string(),
        label: z.string().optional(),
        neighbourhood: neighbourhoodSchema.optional(),
      })
      .optional(),
  }),
});

export type ChatEnvelope = z.infer<typeof chatEnvelopeSchema>;
export type ResolvedSkill = z.infer<typeof resolvedSkillSchema>;
