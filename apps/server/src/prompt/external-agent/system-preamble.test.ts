// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';

import { renderExternalAgentSystemPreamble } from './system-preamble.js';

describe('external-agent bootstrap routing', () => {
  it('prefers one authenticated root Skill call and keeps native HTTP available', () => {
    const preamble = renderExternalAgentSystemPreamble();
    expect(preamble).toContain('node "$HUABU_RFS_ENTRY" get-skill');
    expect(preamble).toContain('node "$env:HUABU_RFS_ENTRY" get-skill');
    expect(preamble).toContain('live Space Skill Frames');
    expect(preamble).toContain('COMMAND --help');
    expect(preamble).toContain('"$HUABU_RFS_URL/skill"');
    expect(preamble).toContain('local-only help');
    expect(preamble.indexOf('node "$HUABU_RFS_ENTRY" get-skill')).toBeLessThan(
      preamble.indexOf('curl -fsS'),
    );
    expect(preamble).not.toContain('--help --topic');
  });
});
