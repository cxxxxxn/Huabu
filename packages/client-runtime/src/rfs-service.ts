// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createWriteStream } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32 } from 'node:zlib';

import { open as openZip, type Entry, type ZipFile } from 'yauzl';

import {
  resolveDirectChildPath,
  safeJoin,
} from '../../../apps/server/src/utils/fs.js';

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 128 * 1024 * 1024;
const MAX_ENTRIES = 4096;

async function requireAbsent(path: string) {
  try {
    await lstat(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return;
    throw error;
  }
  throw new Error(`Refusing to overwrite existing Service directory: ${path}`);
}

async function extract(
  archive: string,
  stage: string,
  id: string,
  signal: AbortSignal,
) {
  const zip = await new Promise<ZipFile>((resolve, reject) => {
    openZip(
      archive,
      { lazyEntries: true, strictFileNames: true },
      (error, file) => {
        if (error) reject(error);
        else if (!file) reject(new Error('Failed to open Service archive'));
        else resolve(file);
      },
    );
  });
  const controller = new AbortController();
  const extractionSignal = AbortSignal.any([signal, controller.signal]);
  const onError = (error: Error) => controller.abort(error);
  zip.on('error', onError);
  const names = new Set<string>();
  const casing = new Map<string, string>();
  let count = 0;
  let expanded = 0;
  try {
    while (true) {
      extractionSignal.throwIfAborted();
      const entry = await new Promise<Entry | undefined>((resolve, reject) => {
        const cleanup = () => {
          zip.off('entry', onEntry);
          zip.off('end', onEnd);
          extractionSignal.removeEventListener('abort', onAbort);
        };
        const onEntry = (value: Entry) => {
          cleanup();
          resolve(value);
        };
        const onEnd = () => {
          cleanup();
          resolve(undefined);
        };
        const onAbort = () => {
          cleanup();
          reject(extractionSignal.reason);
        };
        zip.once('entry', onEntry);
        zip.once('end', onEnd);
        extractionSignal.addEventListener('abort', onAbort, { once: true });
        zip.readEntry();
      });
      if (!entry) break;
      if (++count > MAX_ENTRIES)
        throw new Error('Service archive has too many entries');
      const directory = entry.fileName.endsWith('/');
      const name = directory ? entry.fileName.slice(0, -1) : entry.fileName;
      const segments = name.split('/');
      if (
        segments[0] !== id ||
        name.length > 512 ||
        segments.some(
          (part) =>
            !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) ||
            part.endsWith('.') ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
        ) ||
        (!directory && segments.length < 2)
      )
        throw new Error('Invalid Service archive path or package root');
      let prefix = '';
      for (const part of segments) {
        prefix = prefix ? `${prefix}/${part}` : part;
        const previous = casing.get(prefix.toLowerCase());
        if (previous !== undefined && previous !== prefix)
          throw new Error('Case-colliding Service archive path');
        casing.set(prefix.toLowerCase(), prefix);
        if (casing.size > MAX_ENTRIES)
          throw new Error('Service archive has too many filesystem paths');
      }
      const key = name.toLowerCase();
      if (names.has(key)) throw new Error('Duplicate Service archive path');
      names.add(key);
      const unixType = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (
        entry.isEncrypted() ||
        (unixType !== 0 && unixType !== (directory ? 0x4000 : 0x8000))
      )
        throw new Error(
          'Service archive contains an encrypted or non-regular entry',
        );
      const target = safeJoin(stage, ...segments);
      if (directory) {
        await mkdir(target, { recursive: true, mode: 0o700 });
        continue;
      }
      expanded += entry.uncompressedSize;
      if (expanded > MAX_EXTRACTED_BYTES)
        throw new Error('Service archive exceeds extraction size limit');
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const source = await new Promise<Readable>((resolve, reject) => {
        zip.openReadStream(entry, (error, stream) => {
          if (error) reject(error);
          else resolve(stream);
        });
      });
      let received = 0;
      let checksum = 0;
      const check = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length;
          checksum = crc32(chunk, checksum);
          if (received > entry.uncompressedSize)
            callback(new Error('Service archive entry exceeds declared size'));
          else callback(null, chunk);
        },
      });
      await pipeline(
        source,
        check,
        createWriteStream(target, { flags: 'wx', mode: 0o600 }),
        { signal: extractionSignal },
      );
      if (received !== entry.uncompressedSize || checksum !== entry.crc32)
        throw new Error('Service archive entry size or checksum mismatch');
    }
    const root = resolveDirectChildPath(stage, id);
    for (const name of ['service.yaml', 'SKILL.md']) {
      if (!(await stat(resolveDirectChildPath(root, name))).isFile())
        throw new Error(`Service archive is missing ${name}`);
    }
    return root;
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    zip.close();
  }
}

export async function installServicePackage(
  id: string,
  folder: string,
  receive: (archive: string, maximumBytes: number) => Promise<void>,
  signal: AbortSignal,
): Promise<string> {
  const parent = resolve(folder);
  const target = resolveDirectChildPath(parent, id);
  await mkdir(parent, { recursive: true });
  const lockPath = resolveDirectChildPath(parent, `.huabu-rfs-${id}.lock`);
  const lock = await open(lockPath, 'wx', 0o600);
  let stage: string | undefined;
  try {
    signal.throwIfAborted();
    await requireAbsent(target);
    stage = await mkdtemp(join(parent, '.huabu-rfs-'));
    const archive = resolveDirectChildPath(stage, 'package.zip');
    await receive(archive, MAX_ARCHIVE_BYTES);
    const extracted = await extract(archive, stage, id, signal);
    signal.throwIfAborted();
    await requireAbsent(target);
    await rename(extracted, target);
    return target;
  } finally {
    try {
      if (stage) await rm(stage, { recursive: true, force: true });
    } finally {
      try {
        await lock.close();
      } finally {
        await rm(lockPath);
      }
    }
  }
}
