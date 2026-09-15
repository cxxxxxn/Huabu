// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { z } from 'zod';

import { setConversationTitleBodySchema } from '@huabu/shared';
import {
  normalizeAcpConversationTitle,
  normalizeConversationTitle,
} from '@huabu/shared/conversation-title';

import { agenetes } from './agenetes/drivers.js';
import { chatEnvelopeFromSubmission } from './agenetes/handle.js';
import { agentThreadResolver } from './agent-thread-resolver.js';
import { getLogger } from '../../utils/logger.js';
import { executeOnServerAlreadyLocked } from '../canvas/canvas-executor.js';
import { withCanvasMutex } from '../canvas/write-coordinator.js';
import { coalesceInFlight } from '../preprocessing/coalesce.js';
import { ProviderManager } from '../preprocessing/provider-manager.js';
import { extractTitleFromText } from '../preprocessing/utils.js';
import { space } from '../storage/index.js';
import { canvasAcpNamespace } from '../workspace/paths.js';

import type { AgentNodeTarget } from './agent-thread-resolver.js';
import type { ThreadRecord } from '@agenetes/agenetes';
import type { AgentMetadata } from '@agenetes/protocol';
import type {
  ConversationTitle,
  QueryConversationTitlesResponse,
} from '@huabu/shared';

export const CONVERSATION_TITLE_ANNOTATION = 'huabuConversationTitle';
const candidatesSchema = z.object({
  user: z.string().optional(),
  acp: z.string().optional(),
  generated: z.string().optional(),
  fallback: z.string().optional(),
  lastSyncedNodeLabel: z
    .object({ nodeId: z.string(), label: z.string() })
    .optional(),
});
type Candidates = z.infer<typeof candidatesSchema>;

function candidates(record: ThreadRecord): Candidates {
  const parsed = candidatesSchema.safeParse(
    record.annotations?.[CONVERSATION_TITLE_ANNOTATION],
  );
  return parsed.success ? parsed.data : {};
}

function acpTitle(record: ThreadRecord): string | null {
  return (
    normalizeAcpConversationTitle(record.state?.metadata?.sessionInfo?.title) ??
    normalizeAcpConversationTitle(candidates(record).acp)
  );
}

export function effectiveConversationTitle(
  record?: ThreadRecord,
): ConversationTitle {
  if (!record) return { title: null, source: null };
  const saved = candidates(record);
  const ordered = {
    user: saved.user,
    generated: saved.generated,
    acp: acpTitle(record),
    fallback: saved.fallback,
  };
  for (const source of ['user', 'generated', 'acp', 'fallback'] as const) {
    const title = normalizeConversationTitle(ordered[source]);
    if (title) return { title, source };
  }
  return { title: null, source: null };
}

interface QuestionTitleTarget extends AgentNodeTarget {
  label?: unknown;
  labelSource?: unknown;
  conversationTitleSource?: unknown;
}

export interface ConversationTitleDependencies {
  readRecord: (canvasId: string, threadId: string) => ThreadRecord | undefined;
  updateAnnotations: (
    canvasId: string,
    threadId: string,
    patch: Record<string, unknown>,
  ) => void;
  firstPrompt: (canvasId: string, threadId: string) => string | undefined;
  resolveQuestion: (
    canvasId: string,
    threadId: string,
  ) => Promise<QuestionTitleTarget | null>;
  generate: (prompt: string) => Promise<string | undefined>;
  /** Executes while the service holds the Canvas write mutex. */
  execute: typeof executeOnServerAlreadyLocked;
  notifications: (
    canvasId: string,
    threadId: string,
  ) => AsyncIterable<AgentMetadata>;
  onError: (error: unknown) => void;
}

const provider = new ProviderManager();
const defaults: ConversationTitleDependencies = {
  readRecord: (canvasId, threadId) =>
    agenetes.record(canvasAcpNamespace(canvasId), threadId),
  updateAnnotations: (canvasId, threadId, patch) => {
    agenetes.updateAnnotations(canvasAcpNamespace(canvasId), threadId, patch);
  },
  firstPrompt: (canvasId, threadId) => {
    for (const turn of agenetes.history(
      canvasAcpNamespace(canvasId),
      threadId,
      { withTail: true },
    ).turns) {
      const text = chatEnvelopeFromSubmission(turn.request)?.user.text;
      if (text?.trim()) return text;
    }
    return undefined;
  },
  resolveQuestion: async (canvasId, threadId) => {
    const target = await agentThreadResolver.resolveAgentNode(
      canvasId,
      threadId,
    );
    if (!target) return null;
    const handle = space(canvasId);
    const node = (await handle.nodes.read(target.nodeId))?.record;
    const canvas = await handle.read();
    const structure = (
      canvas?.state.nodes as
        | Array<{ id: string; data?: { conversationTitleSource?: unknown } }>
        | undefined
    )?.find((item) => item.id === target.nodeId);
    return {
      ...target,
      label: node?.label,
      labelSource: node?.['labelSource'],
      conversationTitleSource: structure?.data?.conversationTitleSource,
    };
  },
  generate: async (prompt) =>
    (
      await provider.generateContentMeta(prompt, {
        needLabel: true,
        needSummary: false,
        needKeywords: false,
      })
    )?.label,
  execute: executeOnServerAlreadyLocked,
  notifications: (canvasId, threadId) =>
    agenetes.notifications(threadId, canvasAcpNamespace(canvasId)),
  onError: (error) =>
    getLogger('conversation-title').warn(
      { err: error },
      'Conversation title update failed',
    ),
};

/** Host-owned panel names; never rewrites the driver's sessionInfo or node body. */
export class ConversationTitleService {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly subscriptions = new Map<string, symbol>();

  constructor(
    private readonly deps: ConversationTitleDependencies = defaults,
  ) {}

  hasThread(canvasId: string, threadId: string): boolean {
    return !!this.deps.readRecord(canvasId, threadId);
  }

  get(canvasId: string, threadId: string): ConversationTitle {
    const record = this.deps.readRecord(canvasId, threadId);
    const effective = effectiveConversationTitle(record);
    if (!record || effective.title) return effective;
    const title = normalizeConversationTitle(
      extractTitleFromText(this.deps.firstPrompt(canvasId, threadId) ?? ''),
    );
    return { title, source: title ? 'fallback' : null };
  }

  query(
    canvasId: string,
    threadIds: string[],
  ): QueryConversationTitlesResponse {
    return {
      titles: Object.fromEntries(
        threadIds.map((id) => [id, this.get(canvasId, id)]),
      ),
    };
  }

  setUserTitle(
    canvasId: string,
    threadId: string,
    title: string,
  ): ConversationTitle | null {
    const parsed = setConversationTitleBodySchema.safeParse({ title });
    if (!parsed.success) throw new Error('Invalid conversation title');
    const user = normalizeConversationTitle(parsed.data.title);
    if (!user) throw new Error('Invalid conversation title');
    if (!this.merge(canvasId, threadId, { user })) return null;
    return this.get(canvasId, threadId);
  }

  /** One shared attempt per in-flight request; later turns may retry failures. */
  initialize(
    canvasId: string,
    threadId: string,
    prompt: string,
  ): Promise<void> {
    const key = JSON.stringify([canvasId, threadId]);
    return coalesceInFlight(this.inFlight, key, () =>
      this.initializeOnce(canvasId, threadId, prompt).catch((error) =>
        this.deps.onError(error),
      ),
    );
  }

  private async initializeOnce(
    canvasId: string,
    threadId: string,
    prompt: string,
  ): Promise<void> {
    const record = this.deps.readRecord(canvasId, threadId);
    if (!record) return;
    const saved = candidates(record);
    if (saved.generated) {
      await this.syncQuestionTitle(canvasId, threadId);
      return;
    }
    if (saved.user) return;
    const firstPrompt = this.deps.firstPrompt(canvasId, threadId) ?? prompt;
    if (!saved.fallback) {
      const fallback = normalizeConversationTitle(
        extractTitleFromText(firstPrompt),
      );
      if (fallback) this.merge(canvasId, threadId, { fallback });
    }
    if (!firstPrompt.trim()) return;
    const question = await this.deps.resolveQuestion(canvasId, threadId);
    // Reuse a semantic auto label produced before the durable thread existed.
    if (
      question?.labelSource === 'auto' &&
      question.conversationTitleSource === undefined &&
      normalizeConversationTitle(question.label) &&
      normalizeConversationTitle(question.label) !==
        normalizeConversationTitle(extractTitleFromText(firstPrompt))
    ) {
      await this.saveGenerated(canvasId, threadId, question.label);
      return;
    }
    const current = this.deps.readRecord(canvasId, threadId);
    if (!current) return;
    const effective = effectiveConversationTitle(current);
    if (effective.source === 'user' || effective.source === 'generated') return;
    const generated = await this.deps.generate(firstPrompt);
    // merge reads the latest record after the await. Higher-priority names
    // and unrelated annotations survive; get() always re-evaluates precedence.
    await this.saveGenerated(canvasId, threadId, generated);
  }

  async saveGenerated(
    canvasId: string,
    threadId: string,
    value: unknown,
  ): Promise<void> {
    const generated = normalizeConversationTitle(value);
    const record = this.deps.readRecord(canvasId, threadId);
    if (generated && record && !candidates(record).generated) {
      this.merge(canvasId, threadId, { generated });
    }
    if (generated) await this.syncQuestionTitle(canvasId, threadId);
  }

  async acceptAcpTitle(
    canvasId: string,
    threadId: string,
    value: unknown,
  ): Promise<void> {
    const title = normalizeAcpConversationTitle(value);
    if (!title) return;
    if (!this.merge(canvasId, threadId, { acp: title })) return;
    await this.syncQuestionTitle(canvasId, threadId);
  }

  private questionTitle(canvasId: string, threadId: string): string | null {
    const record = this.deps.readRecord(canvasId, threadId);
    if (!record) return null;
    const saved = candidates(record);
    // A manual panel name is not a manual Question label.
    return normalizeConversationTitle(saved.generated) ?? acpTitle(record);
  }

  /** Exact persisted provenance, not a guess based on an agent label's text. */
  ownsQuestionLabel(
    canvasId: string,
    threadId: string,
    nodeId: string,
    label: unknown,
    labelSource: unknown,
  ): boolean {
    const record = this.deps.readRecord(canvasId, threadId);
    const synced = record && candidates(record).lastSyncedNodeLabel;
    return (
      labelSource === 'agent' &&
      synced?.nodeId === nodeId &&
      synced.label === label
    );
  }

  /** Enrich and turn initialization share the same first-prompt generation. */
  async generateQuestionLabel(
    canvasId: string,
    threadId: string,
    prompt: string,
  ): Promise<string | undefined> {
    await this.initialize(canvasId, threadId, prompt);
    const record = this.deps.readRecord(canvasId, threadId);
    return record ? candidates(record).generated : undefined;
  }

  private async syncQuestionTitle(
    canvasId: string,
    threadId: string,
  ): Promise<void> {
    await withCanvasMutex(canvasId, async () => {
      const target = await this.deps.resolveQuestion(canvasId, threadId);
      const title = this.questionTitle(canvasId, threadId);
      if (!target || !title) return;
      const output = await this.deps.execute({
        canvasId,
        originator: { source: 'system' },
        commands: [
          {
            type: 'MERGE_NODE_DATA',
            patches: [
              {
                nodeId: target.nodeId,
                patch: { label: title, labelSource: 'agent' },
              },
            ],
          },
        ],
        guard: (nodes) => {
          const node = nodes.find((item) => item.id === target.nodeId);
          return (
            node?.type === 'question' &&
            node.data.threadId === threadId &&
            node.data.labelSource !== 'user' &&
            (node.data.labelSource !== 'agent' ||
              this.ownsQuestionLabel(
                canvasId,
                threadId,
                target.nodeId,
                node.data.label,
                node.data.labelSource,
              )) &&
            this.questionTitle(canvasId, threadId) === title
          );
        },
      });
      if (!output.results.some((result) => result.applied)) return;
      // Record the actual persisted label (including name deduplication) before
      // releasing the same mutex. Unrelated agent/user renames revoke ownership.
      const committed = await this.deps.resolveQuestion(canvasId, threadId);
      if (
        committed?.nodeId === target.nodeId &&
        typeof committed.label === 'string'
      ) {
        this.merge(canvasId, threadId, {
          lastSyncedNodeLabel: {
            nodeId: target.nodeId,
            label: committed.label,
          },
        });
      }
    });
  }

  /** Install at realization, before session bootstrap; notifications are persist-then-notify. */
  subscribe(canvasId: string, threadId: string): void {
    if (!canvasId || !threadId) return;
    const key = JSON.stringify([canvasId, threadId]);
    if (this.subscriptions.has(key)) return;
    const token = Symbol();
    this.subscriptions.set(key, token);
    void (async () => {
      try {
        const stream = this.deps.notifications(canvasId, threadId);
        const record = this.deps.readRecord(canvasId, threadId);
        // Register before replaying persisted state so bootstrap updates are
        // buffered, including a blank update following a useful cached title.
        try {
          await this.acceptAcpTitle(
            canvasId,
            threadId,
            record ? acpTitle(record) : undefined,
          );
        } catch (error) {
          this.deps.onError(error);
        }
        for await (const meta of stream) {
          try {
            await this.acceptAcpTitle(
              canvasId,
              threadId,
              meta.sessionInfo?.title,
            );
          } catch (error) {
            this.deps.onError(error);
          }
        }
      } catch (error) {
        this.deps.onError(error);
      } finally {
        if (this.subscriptions.get(key) === token)
          this.subscriptions.delete(key);
      }
    })();
  }

  private merge(
    canvasId: string,
    threadId: string,
    patch: Candidates,
  ): boolean {
    const record = this.deps.readRecord(canvasId, threadId);
    if (!record) return false;
    const saved = candidates(record);
    if (
      Object.entries(patch).some(
        ([key, value]) => saved[key as keyof Candidates] !== value,
      )
    ) {
      this.deps.updateAnnotations(canvasId, threadId, {
        [CONVERSATION_TITLE_ANNOTATION]: { ...saved, ...patch },
      });
    }
    return true;
  }
}

export const conversationTitleService = new ConversationTitleService();
