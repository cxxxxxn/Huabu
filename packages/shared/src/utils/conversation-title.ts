// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

const MAX_TITLE_LENGTH = 120;

function normalizeWhitespace(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.replace(/\s+/g, ' ').trim() || null;
}

/** Normalize host/manual titles, preserving the existing truncation policy. */
export function normalizeConversationTitle(value: unknown): string | null {
  return normalizeWhitespace(value)?.slice(0, MAX_TITLE_LENGTH) ?? null;
}

/** Accept nonempty ACP titles within the limit, without inspecting their text. */
export function normalizeAcpConversationTitle(value: unknown): string | null {
  const title = normalizeWhitespace(value);
  if (!title || title.length > MAX_TITLE_LENGTH) return null;
  return title;
}
