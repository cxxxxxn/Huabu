// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it, vi } from 'vitest';

import {
  CONVERSATION_TITLE_ANNOTATION,
  ConversationTitleService,
  effectiveConversationTitle,
} from './conversation-title.service.js';

import type { ConversationTitleDependencies } from './conversation-title.service.js';
import type { ThreadRecord } from '@agenetes/agenetes';
import type { CanvasNode } from '@huabu/shared/canvas-engine';

function fixture() {
  const records = new Map<string, ThreadRecord>([
    [
      'canvas-a/thread-a',
      {
        driverSchemaVersion: 1,
        spec: {
          kind: 'test',
          workloadType: 'Deployment',
          threadId: 'thread-a',
          namespace: { name: 'canvas-a' },
          spec: {},
        },
        state: { driverState: {} },
      },
    ],
  ]);
  let node: CanvasNode | undefined;
  const deps: ConversationTitleDependencies = {
    readRecord: (canvas, thread) => records.get(`${canvas}/${thread}`),
    updateAnnotations: vi.fn((canvas, thread, patch) => {
      const record = records.get(`${canvas}/${thread}`)!;
      records.set(`${canvas}/${thread}`, {
        ...record,
        annotations: { ...record.annotations, ...patch },
      });
    }),
    firstPrompt: vi.fn(() => 'Original first prompt'),
    resolveQuestion: vi.fn(async () =>
      node
        ? {
            canvasId: 'canvas-a',
            nodeId: node.id as `node-${string}`,
            threadId: 'thread-a',
            label: node.data.label,
            labelSource: node.data.labelSource,
            conversationTitleSource: node.data.conversationTitleSource,
          }
        : null,
    ),
    generate: vi.fn(async () => 'Semantic title'),
    execute: vi.fn(async (input) => {
      const applied = !!node && !!input.guard?.([node]);
      if (applied && node)
        for (const command of input.commands) {
          if (command.type === 'MERGE_NODE_DATA')
            for (const entry of command.patches)
              Object.assign(node.data, entry.patch);
        }
      return { results: [{ applied }] } as never;
    }),
    notifications: vi.fn(async function* () {}),
    onError: vi.fn(),
  };
  const service = new ConversationTitleService(deps);
  const getRecord = () => records.get('canvas-a/thread-a')!;
  const metadata = (title: string | null) => {
    records.set('canvas-a/thread-a', {
      ...getRecord(),
      state: {
        driverState: {},
        metadata: { sessionInfo: { title, updatedAt: null } },
      },
    });
  };
  const question = (label = 'Original first prompt', labelSource = 'auto') => {
    node = {
      id: 'node-q',
      type: 'question',
      position: { x: 0, y: 0 },
      data: {
        label,
        labelSource,
        threadId: 'thread-a',
        content: 'Original first prompt',
        status: 'done',
      },
    } as CanvasNode;
    return node;
  };
  return { service, deps, records, getRecord, metadata, question };
}

describe('generated-first conversation titles', () => {
  it('orders manual > generated > current ACP > saved ACP > fallback without metadata writes', async () => {
    const { service, deps, metadata, getRecord } = fixture();
    expect(service.get('canvas-a', 'thread-a')).toEqual({
      title: 'Original first prompt',
      source: 'fallback',
    });
    await service.acceptAcpTitle('canvas-a', 'thread-a', 'Saved ACP');
    metadata('Current ACP');
    expect(service.get('canvas-a', 'thread-a')).toEqual({
      title: 'Current ACP',
      source: 'acp',
    });
    metadata('');
    expect(service.get('canvas-a', 'thread-a').title).toBe('Saved ACP');
    await service.initialize('canvas-a', 'thread-a', 'Later prompt');
    expect(deps.generate).toHaveBeenCalledExactlyOnceWith(
      'Original first prompt',
    );
    metadata('Late ACP');
    await service.acceptAcpTitle('canvas-a', 'thread-a', 'Late ACP');
    expect(service.get('canvas-a', 'thread-a')).toEqual({
      title: 'Semantic title',
      source: 'generated',
    });
    expect(service.setUserTitle('canvas-a', 'thread-a', ' My name ')).toEqual({
      title: 'My name',
      source: 'user',
    });
    expect(getRecord().state.metadata?.sessionInfo?.title).toBe('Late ACP');
    await new ConversationTitleService(deps).initialize(
      'canvas-a',
      'thread-a',
      'Retry',
    );
    expect(deps.generate).toHaveBeenCalledTimes(1);
  });

  it.each(['undefined', 'failure'])(
    'keeps ACP after %s and retries once on a future initialize',
    async (outcome) => {
      const { service, deps, metadata, records, getRecord } = fixture();
      metadata('ACP fallback');
      records.set('canvas-a/thread-a', {
        ...getRecord(),
        annotations: {
          otherFeature: { enabled: true },
          [CONVERSATION_TITLE_ANNOTATION]: {
            acp: 'ACP fallback',
            fallback: 'Original first prompt',
            generationAttempted: true,
          },
        },
      });
      vi.mocked(deps.generate).mockImplementationOnce(async () => {
        if (outcome === 'failure') throw new Error('provider unavailable');
        return undefined;
      });
      await Promise.all([
        service.initialize('canvas-a', 'thread-a', 'Later request'),
        service.initialize('canvas-a', 'thread-a', 'Concurrent request'),
      ]);
      expect(deps.generate).toHaveBeenCalledTimes(1);
      expect(service.get('canvas-a', 'thread-a')).toEqual({
        title: 'ACP fallback',
        source: 'acp',
      });
      expect(deps.onError).toHaveBeenCalledTimes(outcome === 'failure' ? 1 : 0);
      const restarted = new ConversationTitleService(deps);
      await restarted.initialize(
        'canvas-a',
        'thread-a',
        'Configured model now',
      );
      expect(deps.generate).toHaveBeenCalledTimes(2);
      expect(deps.generate).toHaveBeenLastCalledWith('Original first prompt');
      expect(restarted.get('canvas-a', 'thread-a').source).toBe('generated');
      expect(getRecord().annotations?.otherFeature).toEqual({ enabled: true });
      expect(getRecord().state.metadata?.sessionInfo?.title).toBe(
        'ACP fallback',
      );
    },
  );

  it('accepts prompt-like ACP text and never mutates or pays for query reads', async () => {
    const { service, deps, metadata, getRecord } = fixture();
    const title =
      'You are a helpful assistant collaborating with a user inside **Huabu**';
    metadata(title);
    const before = JSON.stringify(getRecord());
    expect(service.query('canvas-a', ['thread-a']).titles['thread-a']).toEqual({
      title,
      source: 'acp',
    });
    expect(JSON.stringify(getRecord())).toBe(before);
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.updateAnnotations).not.toHaveBeenCalled();
    expect(deps.resolveQuestion).not.toHaveBeenCalled();
    await service.acceptAcpTitle('canvas-a', 'thread-a', title);
    metadata('x'.repeat(121));
    await service.acceptAcpTitle('canvas-a', 'thread-a', 'x'.repeat(121));
    expect(service.get('canvas-a', 'thread-a').title).toBe(title);
  });

  it.each([null, '', '  ', 'x'.repeat(121)])(
    'ignores invalid raw/saved ACP %j without recovery',
    async (invalid) => {
      const { service, deps, metadata, records, getRecord, question } =
        fixture();
      metadata(invalid);
      records.set('canvas-a/thread-a', {
        ...getRecord(),
        annotations: { [CONVERSATION_TITLE_ANNOTATION]: { acp: invalid } },
      });
      const node = question('Unrelated agent name', 'agent');
      const before = JSON.stringify(getRecord());
      expect(service.get('canvas-a', 'thread-a').source).toBe('fallback');
      await service.acceptAcpTitle('canvas-a', 'thread-a', invalid);
      expect(JSON.stringify(getRecord())).toBe(before);
      expect(node.data.label).toBe('Unrelated agent name');
      expect(deps.execute).not.toHaveBeenCalled();
    },
  );

  it('preserves manual panel and Question names while generation and ACP race', async () => {
    const { service, deps, metadata, question } = fixture();
    const node = question();
    let complete!: (title: string) => void;
    deps.generate = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          complete = resolve;
        }),
    );
    const running = service.initialize('canvas-a', 'thread-a', 'Prompt');
    await vi.waitFor(() => expect(deps.generate).toHaveBeenCalledOnce());
    metadata('ACP arrived');
    await service.acceptAcpTitle('canvas-a', 'thread-a', 'ACP arrived');
    service.setUserTitle('canvas-a', 'thread-a', 'Panel manual');
    Object.assign(node.data, { label: 'Node manual', labelSource: 'user' });
    complete('Slow generated');
    await running;
    expect(service.get('canvas-a', 'thread-a')).toEqual({
      title: 'Panel manual',
      source: 'user',
    });
    expect(node.data).toMatchObject({
      label: 'Node manual',
      labelSource: 'user',
      content: 'Original first prompt',
      status: 'done',
    });
  });

  it('upgrades ACP-owned Questions through shared Enrich/init and rejects late ACP', async () => {
    const { service, deps, metadata, question, getRecord } = fixture();
    const node = question();
    metadata('ACP fallback');
    await service.acceptAcpTitle('canvas-a', 'thread-a', 'ACP fallback');
    expect(
      service.ownsQuestionLabel(
        'canvas-a',
        'thread-a',
        'node-q',
        node.data.label,
        node.data.labelSource,
      ),
    ).toBe(true);
    const [label] = await Promise.all([
      service.generateQuestionLabel('canvas-a', 'thread-a', 'Later node text'),
      service.initialize('canvas-a', 'thread-a', 'Later turn'),
    ]);
    expect(label).toBe('Semantic title');
    expect(deps.generate).toHaveBeenCalledExactlyOnceWith(
      'Original first prompt',
    );
    expect(node.data.label).toBe('Semantic title');
    metadata('Late ACP');
    await service.acceptAcpTitle('canvas-a', 'thread-a', 'Late ACP');
    expect(node.data.label).toBe('Semantic title');
    expect(
      getRecord().annotations?.[CONVERSATION_TITLE_ANNOTATION],
    ).toMatchObject({
      lastSyncedNodeLabel: { nodeId: 'node-q', label: 'Semantic title' },
    });
    await service.saveGenerated(
      'canvas-a',
      'thread-a',
      'Later preprocessed label',
    );
    expect(node.data.label).toBe('Semantic title');
  });

  it.each(['user', 'agent'])(
    'preserves unrelated %s labels without provenance',
    async (source) => {
      const { service, metadata, question } = fixture();
      const node = question('Existing authored name', source);
      metadata('ACP fallback');
      await service.acceptAcpTitle('canvas-a', 'thread-a', 'ACP fallback');
      await service.saveGenerated('canvas-a', 'thread-a', 'Generated');
      expect(node.data.label).toBe('Existing authored name');
      expect(
        service.ownsQuestionLabel(
          'canvas-a',
          'thread-a',
          'node-q',
          node.data.label,
          source,
        ),
      ).toBe(false);
    },
  );

  it('does not infer ownership from ACP text equal to an unrelated agent label', async () => {
    const { service, question } = fixture();
    const node = question('ACP', 'agent');
    await service.acceptAcpTitle('canvas-a', 'thread-a', 'ACP');
    await service.saveGenerated('canvas-a', 'thread-a', 'Generated');
    expect(node.data.label).toBe('ACP');
  });

  it('reuses pre-thread semantic auto labels without another provider call', async () => {
    const { service, deps, question } = fixture();
    question('Existing semantic label');
    await service.initialize('canvas-a', 'thread-a', 'Prompt');
    expect(deps.generate).not.toHaveBeenCalled();
    expect(service.get('canvas-a', 'thread-a')).toEqual({
      title: 'Existing semantic label',
      source: 'generated',
    });
  });

  it.each(['acp', 'fallback'])(
    'does not adopt copied %s auto text as generated, even after deduplication',
    async (source) => {
      const { service, deps, question, metadata } = fixture();
      metadata('ACP fallback');
      const node = question('Copied title (2)');
      node.data.conversationTitleSource = source;
      vi.mocked(deps.generate).mockResolvedValueOnce(undefined);
      await service.initialize('canvas-a', 'thread-a', 'Later prompt');
      expect(service.get('canvas-a', 'thread-a').source).toBe('acp');
      expect(node.data.label).toBe('Copied title (2)');
      const restarted = new ConversationTitleService(deps);
      await Promise.all([
        restarted.initialize('canvas-a', 'thread-a', 'Later prompt'),
        restarted.generateQuestionLabel('canvas-a', 'thread-a', 'Node text'),
      ]);
      expect(deps.generate).toHaveBeenCalledTimes(2);
      expect(deps.generate).toHaveBeenLastCalledWith('Original first prompt');
      expect(node.data.label).toBe('Semantic title');
    },
  );

  it('adopts a converted generated title from the thread without another naming request', async () => {
    const { service, deps, question } = fixture();
    await service.saveGenerated('canvas-a', 'thread-a', 'Saved generated');
    const node = question('Stale cached title');
    node.data.conversationTitleSource = 'generated';
    await service.generateQuestionLabel('canvas-a', 'thread-a', 'Node text');
    expect(node.data.label).toBe('Saved generated');
    expect(node.data.labelSource).toBe('agent');
    expect(deps.generate).not.toHaveBeenCalled();
  });

  it('upgrades a Question converted while panel generation is already in flight', async () => {
    const { service, deps, question } = fixture();
    let complete!: (title: string) => void;
    vi.mocked(deps.generate).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          complete = resolve;
        }),
    );
    const panelGeneration = service.initialize(
      'canvas-a',
      'thread-a',
      'Prompt',
    );
    await vi.waitFor(() => expect(deps.generate).toHaveBeenCalledOnce());
    const node = question('Copied ACP');
    node.data.conversationTitleSource = 'acp';
    const enrich = service.generateQuestionLabel(
      'canvas-a',
      'thread-a',
      'Node text',
    );
    complete('Generated after conversion');
    await Promise.all([panelGeneration, enrich]);
    expect(node.data).toMatchObject({
      label: 'Generated after conversion',
      labelSource: 'agent',
    });
    expect(deps.generate).toHaveBeenCalledExactlyOnceWith(
      'Original first prompt',
    );
  });

  it('handles synchronization failures from initialized generation', async () => {
    const { service, deps, question } = fixture();
    question();
    vi.mocked(deps.execute).mockRejectedValueOnce(
      new Error('storage unavailable'),
    );
    await service.initialize('canvas-a', 'thread-a', 'Prompt');
    expect(deps.onError).toHaveBeenCalledOnce();
    await service.saveGenerated('canvas-a', 'thread-a', 'Semantic title');
    expect(deps.execute).toHaveBeenCalledTimes(2);
  });

  it('validates manual names and does not create or rename absent/cross-canvas threads', async () => {
    const { service, deps } = fixture();
    expect(() =>
      service.setUserTitle('canvas-a', 'thread-a', 'x'.repeat(121)),
    ).toThrow('Invalid conversation title');
    expect(service.query('canvas-b', ['thread-a', '__proto__'])).toEqual({
      titles: {
        'thread-a': { title: null, source: null },
        ['__proto__']: { title: null, source: null },
      },
    });
    expect(service.setUserTitle('canvas-b', 'thread-a', 'Name')).toBeNull();
    await service.initialize('canvas-a', 'missing', 'Prompt');
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.updateAnnotations).not.toHaveBeenCalled();
    expect(effectiveConversationTitle()).toEqual({ title: null, source: null });
  });

  it('subscribes once per namespace and retains queued useful ACP after blanks', async () => {
    const { service, deps, records, metadata, getRecord } = fixture();
    metadata('');
    records.set('canvas-b/thread-a', {
      ...getRecord(),
      spec: { ...getRecord().spec, namespace: { name: 'canvas-b' } },
    });
    const finished: string[] = [];
    deps.notifications = vi.fn(async function* (canvasId) {
      yield { sessionInfo: { title: `${canvasId} first`, updatedAt: null } };
      yield {
        sessionInfo: { title: `${canvasId} last useful`, updatedAt: null },
      };
      yield { sessionInfo: { title: '  ', updatedAt: null } };
      finished.push(canvasId);
    });
    service.subscribe('canvas-a', 'thread-a');
    service.subscribe('canvas-b', 'thread-a');
    service.subscribe('canvas-a', 'thread-a');
    await vi.waitFor(() => expect(finished).toHaveLength(2));
    expect(deps.notifications).toHaveBeenCalledTimes(2);
    for (const canvas of ['canvas-a', 'canvas-b']) {
      expect(
        new ConversationTitleService(deps).get(canvas, 'thread-a'),
      ).toEqual({ title: `${canvas} last useful`, source: 'acp' });
      expect(
        records.get(`${canvas}/thread-a`)?.state.metadata?.sessionInfo?.title,
      ).toBe('');
    }
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.onError).not.toHaveBeenCalled();
    service.subscribe('canvas-a', 'thread-a');
    await vi.waitFor(() => expect(finished).toHaveLength(3));
  });
});
