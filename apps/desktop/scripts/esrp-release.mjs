// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const { createBlockmap } = builderRequire(
  'app-builder-lib/out/targets/differentialUpdateInfoBuilder.js',
);

export async function refreshInstallerMetadata(output, version) {
  assert.match(
    version,
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  const installerName = `Huabu-Setup-${version}.exe`;
  const metadataPath = path.join(output, 'latest.yml');
  const metadata = YAML.parse(await readFile(metadataPath, 'utf8'));
  assert.equal(metadata?.version, version, 'Unexpected release version');
  assert.equal(metadata.path, installerName, 'Unexpected installer path');
  assert.equal(metadata.files?.length, 1, 'Expected one Windows x64 installer');
  assert.equal(
    metadata.files[0].url,
    installerName,
    'Unexpected installer URL',
  );
  assert.equal(
    metadata.packages,
    undefined,
    'NSIS web packages are not supported',
  );
  assert.equal(
    metadata.files[0].blockMapSize,
    undefined,
    'Expected an external blockmap',
  );

  // Signing changes the installer bytes after electron-builder generated its update assets.
  const { size, sha512 } = await createBlockmap(
    path.join(output, installerName),
    null,
    { info: { emitArtifactBuildCompleted: async () => {} } },
  );
  assert.ok(
    size > 0 && typeof sha512 === 'string',
    'Invalid installer metadata',
  );
  metadata.sha512 = sha512;
  metadata.files[0].sha512 = sha512;
  metadata.files[0].size = size;
  await writeFile(metadataPath, YAML.stringify(metadata));
  console.log(`Updated installer hashes and blockmap: ${installerName}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2])
    throw new Error('Expected the Windows release output directory');
  const { version } = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  await refreshInstallerMetadata(path.resolve(process.argv[2]), version);
}
