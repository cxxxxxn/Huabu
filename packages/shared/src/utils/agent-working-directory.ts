// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export const MAX_AGENT_WORKING_DIR_PATH_LENGTH = 4096;

/** Paths belong to the Agentlet machine, which may run a different OS. */
export function isAgentWorkingDirectory(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_AGENT_WORKING_DIR_PATH_LENGTH &&
    value.trim() === value &&
    (value.startsWith('/') ||
      /^[A-Za-z]:[\\/]/.test(value) ||
      value.startsWith('\\\\'))
  );
}
