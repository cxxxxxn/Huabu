// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AsyncLocalStorage } from 'node:async_hooks';

import { acquireWorkspaceOperationLease } from '../workspace.js';

const owner = new AsyncLocalStorage<{ active: boolean }>();
let tail: Promise<void> = Promise.resolve();

/** Serialize collection mutations, including nested create/delete compensation. */
export async function withSpaceHierarchyLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (owner.getStore()?.active) return operation();
  const lease = acquireWorkspaceOperationLease();
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const scope = { active: true };
  try {
    return await owner.run(scope, operation);
  } finally {
    scope.active = false;
    release();
    lease.release();
  }
}
