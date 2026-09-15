// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agenetes } from './agenetes/drivers.js';
import {
  CONVERSATION_TITLE_ANNOTATION,
  ConversationTitleService,
} from './conversation-title.service.js';
import { executeOnServer } from '../canvas/canvas-executor.js';
import { ProviderManager } from '../preprocessing/provider-manager.js';
import { getCanvasStore } from '../storage/index.js';
import { setWorkspacePath } from '../workspace.js';

import type { ThreadRecord } from '@agenetes/agenetes';
import type { ConversationTitle, LabelSource } from '@huabu/shared';

const canvasId = 'canvas-conversion';
const threadId = 'thread-conversion';
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'huabu-title-conversion-'));
  vi.stubEnv('HUABU_DATA_DIR', tmp);
  setWorkspacePath(tmp);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

async function fixture(
  source: ConversationTitle['source'] = 'acp',
  labelSource: LabelSource = 'auto',
) {
  let record: ThreadRecord = {
    driverSchemaVersion: 1,
    spec: {
      kind: 'test',
      workloadType: 'Deployment',
      threadId,
      namespace: { name: canvasId },
      spec: {},
    },
    state: {
      driverState: {},
      metadata: { sessionInfo: { title: 'ACP fallback', updatedAt: null } },
    },
    annotations: {
      [CONVERSATION_TITLE_ANNOTATION]:
        source === 'generated' ? { generated: 'Generated title' } : {},
    },
  };
  vi.spyOn(agenetes, 'record').mockImplementation(() => record);
  vi.spyOn(agenetes, 'history').mockReturnValue({ turns: [] } as never);
  vi.spyOn(agenetes, 'updateAnnotations').mockImplementation(
    (_namespace, _thread, patch) => {
      record = JSON.parse(
        JSON.stringify({
          ...record,
          annotations: { ...record.annotations, ...patch },
        }),
      ) as ThreadRecord;
      return record;
    },
  );
  const generate = vi
    .spyOn(ProviderManager.prototype, 'generateContentMeta')
    .mockResolvedValue({ label: 'Generated title' });
  const store = getCanvasStore(canvasId);
  store.write({
    canvasId,
    title: null,
    version: 0,
    state: { nodes: [], edges: [] },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  await executeOnServer({
    canvasId,
    originator: { source: 'ui' },
    commands: [
      {
        type: 'CREATE_NODES',
        nodes: [
          {
            id: 'node-existing-acp',
            nodeType: 'note',
            position: { x: 0, y: 0 },
            data: { label: 'ACP fallback' },
          },
          {
            id: 'node-existing-generated',
            nodeType: 'note',
            position: { x: 0, y: 100 },
            data: { label: 'Generated title' },
          },
          {
            id: 'node-q',
            nodeType: 'question',
            position: { x: 200, y: 0 },
            data: {
              threadId,
              label:
                source === 'generated' ? 'Generated title' : 'ACP fallback',
              labelSource,
              ...(source ? { conversationTitleSource: source } : {}),
              content: 'First user prompt',
              status: 'done',
              viewed: true,
            },
          },
        ],
      },
    ],
  });
  return { store, generate, record: () => record };
}

describe('persisted Chat to Question title conversion', () => {
  it('retries copied ACP after unavailable generation, coalesces Enrich/init, and records the deduplicated upgrade', async () => {
    const { store, generate, record } = await fixture();
    const copied = store.readNode('node-q')?.label;
    expect(copied).not.toBe('ACP fallback');
    expect(store.read()?.state.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'node-q',
          data: expect.objectContaining({ conversationTitleSource: 'acp' }),
        }),
      ]),
    );
    generate.mockResolvedValueOnce(undefined);
    await new ConversationTitleService().initialize(
      canvasId,
      threadId,
      'First user prompt',
    );
    expect(store.readNode('node-q')?.label).toBe(copied);
    expect(
      record().annotations?.[CONVERSATION_TITLE_ANNOTATION],
    ).not.toHaveProperty('generated');
    const restarted = new ConversationTitleService();
    await Promise.all([
      restarted.initialize(canvasId, threadId, 'First user prompt'),
      restarted.generateQuestionLabel(canvasId, threadId, 'First user prompt'),
    ]);
    const committed = store.readNode('node-q');
    expect(committed).toMatchObject({
      content: 'First user prompt',
      labelSource: 'agent',
    });
    expect(committed?.label).not.toBe(copied);
    expect(committed?.label).not.toBe('Generated title');
    expect(record().annotations?.[CONVERSATION_TITLE_ANNOTATION]).toMatchObject(
      {
        generated: 'Generated title',
        lastSyncedNodeLabel: { nodeId: 'node-q', label: committed?.label },
      },
    );
    await restarted.acceptAcpTitle(canvasId, threadId, 'Late ACP');
    await restarted.generateQuestionLabel(canvasId, threadId, 'Later prompt');
    expect(store.readNode('node-q')?.label).toBe(committed?.label);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenLastCalledWith('First user prompt', {
      needLabel: true,
      needSummary: false,
      needKeywords: false,
    });
    expect(store.read()?.state.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'node-q',
          data: expect.objectContaining({
            threadId,
            status: 'done',
            viewed: true,
          }),
        }),
      ]),
    );
  });

  it('uses the persisted generated candidate without duplicate naming or suffix churn', async () => {
    const { store, generate } = await fixture('generated');
    await new ConversationTitleService().generateQuestionLabel(
      canvasId,
      threadId,
      'First user prompt',
    );
    // Create and rename use different canonical collision suffix formats.
    // Once adopted by title sync, repeated initialization must be stable.
    const before = store.readNode('node-q')?.label;
    await new ConversationTitleService().initialize(
      canvasId,
      threadId,
      'Later prompt',
    );
    expect(store.readNode('node-q')).toMatchObject({
      label: before,
      labelSource: 'agent',
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it.each(['user', 'agent'] as const)(
    'never lets conversion metadata override a later %s rename',
    async (source) => {
      const { store } = await fixture();
      await executeOnServer({
        canvasId,
        originator: { source: 'ui' },
        commands: [
          {
            type: 'MERGE_NODE_DATA',
            patches: [
              {
                nodeId: 'node-q',
                patch: { label: 'Authored name', labelSource: source },
              },
            ],
          },
        ],
      });
      await new ConversationTitleService().initialize(
        canvasId,
        threadId,
        'First user prompt',
      );
      expect(store.readNode('node-q')).toMatchObject({
        label: 'Authored name',
        labelSource: source,
      });
    },
  );

  it('preserves a copied manual title', async () => {
    const { store } = await fixture('user', 'user');
    const before = store.readNode('node-q')?.label;
    await new ConversationTitleService().saveGenerated(
      canvasId,
      threadId,
      'Generated title',
    );
    expect(store.readNode('node-q')).toMatchObject({
      label: before,
      labelSource: 'user',
    });
  });

  it('does not migrate legacy copied ACP agent labels without provenance', async () => {
    const { store, record } = await fixture(null, 'agent');
    const before = store.readNode('node-q')?.label;
    await new ConversationTitleService().initialize(
      canvasId,
      threadId,
      'First user prompt',
    );
    expect(store.readNode('node-q')).toMatchObject({
      label: before,
      labelSource: 'agent',
    });
    expect(
      record().annotations?.[CONVERSATION_TITLE_ANNOTATION],
    ).not.toHaveProperty('lastSyncedNodeLabel');
  });
});
