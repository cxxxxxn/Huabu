// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/bootstrap.ts', 'src/daemon.ts', 'src/service-sdk.ts'],
  format: ['esm'],
  target: 'node24',
  noExternal: [/.*/],
  splitting: false,
  clean: true,
  removeNodeProtocol: false,
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
