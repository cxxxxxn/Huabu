import { describe, expect, it } from 'vitest';

import { agentRequestSchema, stopThreadResponseSchema } from './agent.js';

describe('agentRequestSchema input kinds', () => {
  const inkRequest = {
    inputKind: 'ink-intent',
    content: '',
    canvasId: 'canvas-1',
    canvasContext: {
      selectedNodes: [
        { id: 'sketch-1', type: 'sketch', strokeIds: ['stroke-1'] },
      ],
    },
  };

  it('preserves legacy text without adding an input kind', () => {
    expect(agentRequestSchema.parse({ content: 'Hello' })).toEqual({
      content: 'Hello',
    });
  });

  it.each([undefined, 'text'])(
    'rejects empty text for kind %s',
    (inputKind) => {
      expect(
        agentRequestSchema.safeParse({ content: '', inputKind }).success,
      ).toBe(false);
    },
  );

  it.each(['ask', 'operate'])(
    'accepts selected Ink with empty text in %s mode',
    (mode) => {
      expect(
        agentRequestSchema.safeParse({ ...inkRequest, mode }).success,
      ).toBe(true);
    },
  );

  it('rejects Ink without a Canvas', () => {
    expect(
      agentRequestSchema.safeParse({ ...inkRequest, canvasId: undefined })
        .success,
    ).toBe(false);
  });

  it.each([undefined, [], ['']])(
    'rejects a Sketch without valid partial strokes: %j',
    (strokeIds) => {
      expect(
        agentRequestSchema.safeParse({
          ...inkRequest,
          canvasContext: {
            selectedNodes: [{ id: 'sketch-1', type: 'sketch', strokeIds }],
          },
        }).success,
      ).toBe(false);
    },
  );

  it('accepts partial Sketch sources nested in a Frame', () => {
    expect(
      agentRequestSchema.safeParse({
        ...inkRequest,
        canvasContext: {
          selectedNodes: [
            {
              id: 'frame-1',
              type: 'frame',
              children: inkRequest.canvasContext.selectedNodes,
            },
          ],
        },
      }).success,
    ).toBe(true);
  });

  it('does not treat stroke IDs on an ordinary node as Ink', () => {
    expect(
      agentRequestSchema.safeParse({
        ...inkRequest,
        canvasContext: {
          selectedNodes: [
            { id: 'note-1', type: 'note', strokeIds: ['stroke-1'] },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('accepts external bindings for an existing Question target', () => {
    expect(
      agentRequestSchema.safeParse({
        ...inkRequest,
        agentBinding: {
          kind: 'external',
          alias: 'External',
          profileId: 'profile-1',
        },
      }).success,
    ).toBe(true);
  });
});

describe('stopThreadResponseSchema', () => {
  it('carries durable acceptance when the stopped turn already started', () => {
    expect(
      stopThreadResponseSchema.parse({
        stopped: true,
        acceptance: { threadId: 'thread-1', turnStartSeq: 3 },
      }),
    ).toEqual({
      stopped: true,
      acceptance: { threadId: 'thread-1', turnStartSeq: 3 },
    });
  });
});
