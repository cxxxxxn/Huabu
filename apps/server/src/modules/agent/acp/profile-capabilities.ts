// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { probeAcpCapabilities } from '@agenetes/acp-driver';
import {
  getAgentProfileRegistry,
  resolveConnectedAgentletId,
} from '@agenetes/agentlet-host';

import {
  getProfileSchemaCache,
  mergeProfileSchemaCache,
} from './profile-schema-cache.js';
import {
  recipeFromProfileSnapshot,
  resolveProfileSnapshot,
} from './profile-snapshot.js';

import type { AcpProfileSchemaCacheEntry } from './profile-schema-cache.js';
import type { AcpProfileCapabilitiesResponse } from '@huabu/shared';
import type { FastifyBaseLogger } from 'fastify';

export class ProfileCapabilitiesError extends Error {
  constructor(
    readonly status: 404 | 409 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function projectProfileCapabilities(
  cache: AcpProfileSchemaCacheEntry | null,
): AcpProfileCapabilitiesResponse {
  const observed = Boolean(cache && (cache.metaUpdatedAt ?? 0) > 0);
  return {
    source: observed ? 'profile' : 'none',
    availableCommands: cache?.availableCommands ?? [],
    commandsUpdatedAt: cache?.commandsUpdatedAt ?? 0,
    sessionMeta: {
      availableModes: cache?.availableModes ?? [],
      currentModeId: cache?.currentModeId ?? null,
      availableModels: cache?.availableModels ?? [],
      currentModelId: cache?.currentModelId ?? null,
      configOptions: cache?.configOptions ?? [],
      selections: {},
      sessionInfo: null,
      usage: null,
      updatedAt: cache?.metaUpdatedAt ?? 0,
    },
  };
}

export function readProfileCapabilities(
  profileId: string,
): AcpProfileCapabilitiesResponse {
  const profile = resolveProfileSnapshot(profileId);
  if (!profile) {
    throw new ProfileCapabilitiesError(
      404,
      'profile_not_found',
      'Agent Profile is unavailable',
    );
  }
  const cache = getProfileSchemaCache(profileId);
  return projectProfileCapabilities(
    cache?.executionRevision !== undefined &&
      cache.executionRevision !== profile.executionRevision
      ? null
      : cache,
  );
}

const discoveries = new Map<string, Promise<AcpProfileCapabilitiesResponse>>();

export async function discoverProfileCapabilities(
  profileId: string,
  logger: FastifyBaseLogger,
): Promise<AcpProfileCapabilitiesResponse> {
  const cached = readProfileCapabilities(profileId);
  if (cached.source === 'profile') return cached;
  const profile = resolveProfileSnapshot(profileId);
  if (!profile) {
    throw new ProfileCapabilitiesError(
      404,
      'profile_not_found',
      'Agent Profile is unavailable',
    );
  }
  const agentletId = resolveConnectedAgentletId(profile.agentletId);
  if (!agentletId) {
    throw new ProfileCapabilitiesError(
      503,
      'placement_unavailable',
      'The selected Agentlet is not connected',
    );
  }
  const key = JSON.stringify([
    profileId,
    profile.executionRevision,
    agentletId,
  ]);
  let operation = discoveries.get(key);
  if (!operation) {
    operation = (async () => {
      const alias =
        getAgentProfileRegistry()?.getProfile(profileId)?.alias ?? profileId;
      const observation = await probeAcpCapabilities({
        agentletId,
        binding: { profileId, alias },
        profileExecutionRevision: profile.executionRevision,
        recipe: recipeFromProfileSnapshot(profile, alias),
        logger,
      });
      const current = resolveProfileSnapshot(profileId);
      if (!current || current.executionRevision !== profile.executionRevision) {
        throw new ProfileCapabilitiesError(
          409,
          'profile_changed',
          'Agent Profile changed during capability discovery; retry',
        );
      }
      // A live user session may have published a newer catalogue during the probe.
      const latest = readProfileCapabilities(profileId);
      if (latest.source === 'profile') return latest;
      const entry = {
        ...observation,
        executionRevision: profile.executionRevision,
      };
      mergeProfileSchemaCache(profileId, entry);
      return projectProfileCapabilities(entry);
    })();
    discoveries.set(key, operation);
  }
  try {
    return await operation;
  } finally {
    if (discoveries.get(key) === operation) discoveries.delete(key);
  }
}
