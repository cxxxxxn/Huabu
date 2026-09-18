// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { expect, it, vi } from 'vitest';
import { z } from 'zod';

import { extractCanvasChanges } from '@huabu/shared/canvas-engine';

import {
  decodeChanges,
  decodeEvents,
  encodeEventBatch,
  firstIssue,
} from './log-rules.js';
import { event } from './test-fixtures.js';
it('decodes ordered events and refuses malformed historical records', () => {
  expect(
    decodeEvents(
      [event('a'), event('b')].map((e) => ({ event_json: JSON.stringify(e) })),
    ),
  ).toEqual([event('a'), event('b')]);
  expect(() => decodeEvents([{ event_json: '{}' }])).toThrow(/event 1/);
  expect(() => decodeEvents([{ event_json: '{' }])).toThrow(SyntaxError);
});
it('reports schema paths and handles empty issue lists', () => {
  expect(firstIssue(new z.ZodError([]))).toBe('unknown schema violation');
  const parsed = z.object({ name: z.string() }).safeParse({ name: 1 });
  if (parsed.success) throw new Error('Expected invalid input');
  expect(firstIssue(parsed.error)).toMatch(/^name:/);
});
it('coalesces real engine changes and rejects non-array history', () => {
  const changes = extractCanvasChanges([
    {
      type: 'INSERT_NODE',
      node: {
        id: 'n',
        type: 'note',
        position: { x: 0, y: 0 },
        data: { label: 'N', content: 'body' },
      },
    },
  ]);
  expect(
    decodeChanges(JSON.stringify([...changes, ...changes]), 'space', 'thread'),
  ).toHaveLength(1);
  expect(() => decodeChanges('{}', 'space', 'thread')).toThrow(
    /must be an array/,
  );
});

it.each([
  [0, []],
  [-1, []],
  [NaN, []],
  [1, ['c']],
  [1.5, ['b', 'c']],
  [Infinity, ['a', 'b', 'c']],
  [undefined, ['a', 'b', 'c']],
] as const)(
  'validates historical events before applying limit %s',
  (limit, ids) => {
    const rows = [event('a'), event('b'), event('c')].map((record) => ({
      event_json: JSON.stringify(record),
    }));
    expect(decodeEvents(rows, limit)).toEqual(ids.map((id) => event(id)));
    expect(() => decodeEvents([{ event_json: '{}' }, ...rows], limit)).toThrow(
      /event 1/,
    );
  },
);

it('encodes event batches once, preserving payload fields and supplied timestamps', () => {
  const now = vi.fn(() => 42);
  const supplied = event('supplied', 7);
  const payload = {
    ...event('generated').payload,
    extra: { detail: 'retained' },
  };
  const encoded = encodeEventBatch([supplied, { payload }], now);
  payload.extra.detail = 'changed after validation';
  expect(encoded.map((value) => JSON.parse(value))).toEqual([
    supplied,
    {
      ts: 42,
      payload: { ...event('generated').payload, extra: { detail: 'retained' } },
    },
  ]);
  expect(now).toHaveBeenCalledTimes(1);
});

it('rejects invalid event batches and generated timestamps before persistence', () => {
  expect(() =>
    encodeEventBatch([event(), { payload: {} } as never], () => 1),
  ).toThrow(/input at index 1/);
  expect(() =>
    encodeEventBatch([{ payload: event().payload }], () => NaN),
  ).toThrow(/record at index 0/);
  const payload = { ...event().payload, extra: Infinity };
  expect(() => encodeEventBatch([{ payload }], () => 1)).toThrow(/non-finite/);
});
