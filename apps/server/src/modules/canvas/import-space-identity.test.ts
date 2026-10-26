// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { FileTurnStore } from '@agenetes/agenetes';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { remapImportedSpace } from './import-space-identity.js';
import { parseFrontmatter } from '../../utils/markdown-frontmatter.js';
import { createChatSubmission } from '../agent/agenetes/handle.js';
import { buildHistoryFromTurns } from '../agent/conversation/transcript/history.js';

import type { CanvasFile } from './persistence-types.js';
import type { PersistedTurn } from '@agenetes/agenetes';
import type { ChatHistoryItem } from '@huabu/shared';
import type { CanvasNode } from '@huabu/shared/canvas-engine';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'huabu-import-identity-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function record(): CanvasFile {
  return {
    canvasId: 'source',
    title: 'Imported',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    state: {
      nodes: [
        {
          id: 'frame',
          type: 'frame',
          position: { x: 0, y: 0 },
          data: { label: 'Frame' },
        },
        {
          id: 'note',
          type: 'note',
          parentId: 'frame',
          position: { x: 10, y: 20 },
          data: { label: 'note' },
        },
        {
          id: 'agent',
          type: 'question',
          position: { x: 100, y: 0 },
          data: { threadId: 'thread', selectedNodeIds: ['note'] },
        },
      ],
      edges: [{ id: 'edge', source: 'note', target: 'agent' }],
    },
  };
}

it('remaps topology, node frontmatter, structured history and scoped links together', async () => {
  await mkdir(path.join(directory, 'nodes'));
  await mkdir(path.join(directory, '.history'));
  await writeFile(
    path.join(directory, 'nodes', 'Note.md'),
    '---\nid: note\ntype: note\nlabel: note\n---\nnote\n[Agent](/canvas/source?node=agent)\n![Image](/api/canvas/source/artifact/picture.png)\n',
  );
  await writeFile(
    path.join(directory, '.history', 'events.jsonl'),
    `${JSON.stringify({ nodeId: 'note', selectedNodeIds: ['note'], content: 'note', canvasId: 'source' })}\n`,
  );
  await writeFile(
    path.join(directory, '.history', 'threads.json'),
    JSON.stringify({
      records: {
        agent: {
          spec: { threadId: 'agent', namespace: { name: 'source' } },
          hostMetadata: { owner: { canvasId: 'source', nodeId: 'agent' } },
        },
      },
    }),
  );
  const original = record();
  const imported = await remapImportedSpace(directory, original, 'target');
  const [frame, note, agent] = imported.state.nodes as CanvasNode[];
  expect(new Set([frame.id, note.id, agent.id]).size).toBe(3);
  expect(frame.id).not.toBe('frame');
  expect(note).toMatchObject({
    type: 'note',
    parentId: frame.id,
    data: { label: 'note' },
    position: { x: 10, y: 20 },
  });
  expect(agent.data).toMatchObject({
    threadId: 'thread',
    selectedNodeIds: [note.id],
  });
  expect(imported.state.edges[0]).toMatchObject({
    source: note.id,
    target: agent.id,
  });
  expect(imported.state.edges[0]).not.toMatchObject({ id: 'edge' });
  const sidecar = parseFrontmatter(
    await readFile(path.join(directory, 'nodes', 'Note.md'), 'utf8'),
  );
  expect(sidecar.meta).toMatchObject({ id: note.id, label: 'note' });
  expect(sidecar.content).toBe(
    `note\n[Agent](/canvas/target?node=${agent.id})\n![Image](/api/canvas/target/artifact/picture.png)\n`,
  );
  expect(
    JSON.parse(
      await readFile(path.join(directory, '.history', 'events.jsonl'), 'utf8'),
    ),
  ).toEqual({
    nodeId: note.id,
    selectedNodeIds: [note.id],
    content: 'note',
    canvasId: 'target',
  });
  expect(
    JSON.parse(
      await readFile(path.join(directory, '.history', 'threads.json'), 'utf8'),
    ),
  ).toEqual({
    records: {
      agent: {
        spec: { threadId: 'agent', namespace: { name: 'target' } },
        hostMetadata: { owner: { canvasId: 'target', nodeId: agent.id } },
      },
    },
  });
  expect(original).toEqual(record());
});

it('updates SQLite conversation references without changing thread identity, turn order or sequence fences', async () => {
  const namespace = {
    name: 'source',
    storage: { root: path.join(directory, '.history') },
  };
  const turns = new FileTurnStore();
  turns.append(namespace, 'thread', {
    seqStart: 3,
    seqEnd: 8,
    turn: {
      request: { type: 'user_text', content: 'Original prompt' },
      transcript: [
        {
          type: 'tool_call',
          data: {
            toolCallId: 'call',
            title: 'Read nodes',
            status: 'completed',
            rawOutput: { nodeId: 'note', selectedNodeIds: ['note'] },
          },
        },
      ],
    },
  });
  turns.close(namespace);
  try {
    const imported = await remapImportedSpace(directory, record(), 'target');
    const note = imported.state.nodes[1] as CanvasNode;
    const history = turns.list(namespace, 'thread');
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      seqStart: 3,
      seqEnd: 8,
      turn: {
        request: { type: 'user_text', content: 'Original prompt' },
        transcript: [
          {
            type: 'tool_call',
            data: {
              rawOutput: { nodeId: note.id, selectedNodeIds: [note.id] },
            },
          },
        ],
      },
    });
  } finally {
    turns.close(namespace);
  }
});

it('rejects ambiguous duplicate identities instead of publishing broken references', async () => {
  const source = record();
  source.state.nodes.push(source.state.nodes[0]);
  await expect(remapImportedSpace(directory, source, 'target')).rejects.toThrow(
    'duplicate identity',
  );
});

it.each([
  'legacy body',
  '---\ntype: note\nlabel: Legacy\n---\nlegacy body',
  '---\nid: ""\ntype: note\n---\nlegacy body',
  '---\nid: 123\ntype: note\n---\nlegacy body',
])('preserves filename-identified legacy node content: %s', async (raw) => {
  await mkdir(path.join(directory, 'nodes'));
  const filename = path.join(directory, 'nodes', 'note.md');
  await writeFile(filename, raw);
  const imported = await remapImportedSpace(directory, record(), 'target');
  const note = imported.state.nodes[1] as CanvasNode;
  const sidecar = parseFrontmatter(await readFile(filename, 'utf8'));
  expect(sidecar.meta.id).toBe(note.id);
  expect(sidecar.content).toBe('legacy body');
});

it.each(['jsonl', 'sqlite'])(
  'remaps JSON string tool results in %s without rewriting opaque output',
  async (format) => {
    const namespace = {
      name: 'target',
      storage: { root: path.join(directory, '.history') },
    };
    const snapshots = [
      { src: 'image.png', width: 10, height: 10, originNodeIds: ['note'] },
    ];
    const outputs = [
      JSON.stringify(snapshots),
      JSON.stringify({
        tool: 'snapshot_nodes',
        status: 'success',
        data: { snapshots },
      }),
      'not JSON: note',
      '{"nodeId":"note"}',
    ];
    const persisted: PersistedTurn = {
      seqStart: 1,
      seqEnd: 5,
      turn: {
        request: null,
        transcript: outputs.map((rawOutput, index) => ({
          type: 'tool_call',
          data: {
            toolCallId: `call-${index}`,
            title: index < 2 ? 'snapshot_nodes' : 'external',
            status: 'completed',
            rawOutput,
          },
        })),
      },
    };
    const turns = new FileTurnStore();
    if (format === 'sqlite') {
      turns.append(namespace, 'thread', persisted);
      turns.close(namespace);
    } else {
      const history = path.join(namespace.storage.root, 'chat_v2');
      await mkdir(history, { recursive: true });
      await writeFile(
        path.join(history, 'thread.turns.jsonl'),
        `${JSON.stringify(persisted)}\n`,
      );
    }
    try {
      const imported = await remapImportedSpace(directory, record(), 'target');
      const note = imported.state.nodes[1] as CanvasNode;
      const history = turns.list(namespace, 'thread');
      const expectedSnapshots = [{ ...snapshots[0], originNodeIds: [note.id] }];
      expect(history[0].turn.transcript).toMatchObject([
        { data: { rawOutput: JSON.stringify(expectedSnapshots) } },
        {
          data: {
            rawOutput: JSON.stringify({
              tool: 'snapshot_nodes',
              status: 'success',
              data: { snapshots: expectedSnapshots },
            }),
          },
        },
        { data: { rawOutput: outputs[2] } },
        { data: { rawOutput: outputs[3] } },
      ]);
      const messages: ChatHistoryItem[] = [];
      buildHistoryFromTurns(
        history.map((entry) => entry.turn),
        messages,
        { recoverInternalToolNames: true },
      );
      expect(messages[0]).toMatchObject({
        role: 'assistant',
        parts: [
          {
            variant: 'snapshot_nodes',
            data: { data: { snapshots: expectedSnapshots } },
          },
          {
            variant: 'snapshot_nodes',
            data: { data: { snapshots: expectedSnapshots } },
          },
          {},
          {},
        ],
      });
    } finally {
      turns.close(namespace);
    }
  },
);

it.each(['jsonl', 'sqlite'])(
  'remaps selected ChatEnvelope nodes in %s history and its client projection',
  async (format) => {
    const namespace = {
      name: 'target',
      storage: { root: path.join(directory, '.history') },
    };
    const persisted: PersistedTurn = {
      seqStart: 1,
      seqEnd: 3,
      turn: {
        request: createChatSubmission({
          user: { text: 'note', attachments: [] },
          skills: { invokedIds: [], resolved: [] },
          focus: {
            anchor: { nodeId: 'agent' },
            selection: {
              refs: [{ id: 'note', type: 'note', filename: 'nodes/Note.md' }],
              selectedIds: ['note', 'frame'],
              imageAttachments: [],
              snapshotAttachments: [],
            },
          },
        }),
        transcript: [],
      },
    };
    const turns = new FileTurnStore();
    if (format === 'sqlite') {
      turns.append(namespace, 'thread', persisted);
      turns.close(namespace);
    } else {
      const historyDirectory = path.join(namespace.storage.root, 'chat_v2');
      await mkdir(historyDirectory, { recursive: true });
      await writeFile(
        path.join(historyDirectory, 'thread.turns.jsonl'),
        `${JSON.stringify(persisted)}\n`,
      );
    }
    try {
      const imported = await remapImportedSpace(directory, record(), 'target');
      const [frame, note, agent] = imported.state.nodes as CanvasNode[];
      const history = turns.list(namespace, 'thread');
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        seqStart: 1,
        seqEnd: 3,
        turn: {
          request: {
            content: {
              user: { text: 'note' },
              focus: {
                anchor: { nodeId: agent.id },
                selection: {
                  refs: [{ id: note.id, filename: 'nodes/Note.md' }],
                  selectedIds: [note.id, frame.id],
                },
              },
            },
          },
        },
      });
      const messages: ChatHistoryItem[] = [];
      buildHistoryFromTurns(
        history.map((entry) => entry.turn),
        messages,
      );
      expect(messages[0]).toMatchObject({
        role: 'user',
        selectedNodeIds: [note.id, frame.id],
      });
    } finally {
      turns.close(namespace);
    }
  },
);

it('remaps both recent-conversation pointers without changing acceptance identity or other extensions', async () => {
  const source = record();
  source.state.nodes.push({
    id: 'pending-agent',
    type: 'question',
    position: { x: 200, y: 0 },
    data: { threadId: 'pending-thread' },
  });
  const extensionDirectory = path.join(
    directory,
    '.ext',
    'huabu.recentconversation',
  );
  await mkdir(extensionDirectory, { recursive: true });
  const pointerFile = path.join(extensionDirectory, 'target.json');
  const acceptanceId = 'f7f67652-dacc-4965-a42d-71a7ac02699e';
  await writeFile(
    pointerFile,
    JSON.stringify({
      conversation: { nodeId: 'agent', threadId: 'thread' },
      pending: {
        conversation: { nodeId: 'pending-agent', threadId: 'pending-thread' },
        acceptanceId,
      },
    }),
  );
  const otherDirectory = path.join(directory, '.ext', 'other-extension');
  await mkdir(otherDirectory);
  const otherFile = path.join(otherDirectory, 'target.json');
  const opaque = '{"nodeId":"agent"}';
  await writeFile(otherFile, opaque);

  const imported = await remapImportedSpace(directory, source, 'target');
  const [, , agent, pendingAgent] = imported.state.nodes as CanvasNode[];
  expect(JSON.parse(await readFile(pointerFile, 'utf8'))).toEqual({
    conversation: { nodeId: agent.id, threadId: 'thread' },
    pending: {
      conversation: { nodeId: pendingAgent.id, threadId: 'pending-thread' },
      acceptanceId,
    },
  });
  expect(await readFile(otherFile, 'utf8')).toBe(opaque);
});
