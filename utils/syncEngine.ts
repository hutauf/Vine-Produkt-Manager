import { Product } from '../types';
import { calculateDatasetHash } from './syncCanonical';
import { ProductSyncRepository } from './syncDatabase';
import {
  detectV2Capabilities,
  fetchV2SnapshotPage,
  pullV2Changes,
  pushV2Mutations,
  SyncProtocolError,
} from './syncTransport';
import {
  OutboxRecord,
  SyncRunResult,
  V2Capabilities,
  V2Mutation,
  V2SnapshotRecord,
} from './syncTypes';

const CLIENT_VERSION = '2.0.0';
const SUPPORTED_CANONICALIZATION = 'jcs-rfc8785-v1';
const profileSyncLocks = new Map<string, Promise<void>>();

interface BrowserLockManager {
  request<T>(
    name: string,
    options: { mode: 'exclusive' },
    callback: () => Promise<T>,
  ): Promise<T>;
}

const getBrowserLockManager = (): BrowserLockManager | null => {
  if (typeof navigator === 'undefined') return null;
  const candidate = (navigator as Navigator & { locks?: BrowserLockManager }).locks;
  return candidate && typeof candidate.request === 'function' ? candidate : null;
};

interface SnapshotLoadResult {
  generationId: string;
  revision: number;
  datasetHash: string;
  count: number;
  integrityRepaired?: boolean;
}

const mutationFromOutbox = (record: OutboxRecord): V2Mutation => ({
  mutation_id: record.mutationId,
  client_id: record.clientId,
  entity_type: record.entityType,
  entity_id: record.entityId,
  base_revision: record.baseRevision,
  operation: record.operation,
  ...(record.operation === 'patch' ? { set: record.set, unset: record.unset } : {}),
});

const requiresSnapshot = (error: unknown): boolean => (
  error instanceof SyncProtocolError
  && (error.snapshotRequired
    || ['generation_mismatch', 'cursor_expired', 'cursor_ahead'].includes(error.code ?? ''))
);

const verifyShadowHash = async (
  repository: ProductSyncRepository,
  expectedHash: string | null | undefined,
): Promise<boolean> => {
  if (!expectedHash) return true;
  const localHash = await calculateDatasetHash(await repository.getCanonicalShadowRecords());
  return localHash.toLowerCase() === expectedHash.toLowerCase();
};

const loadSnapshotOnce = async (
  repository: ProductSyncRepository,
  baseUrl: string,
  token: string,
  generationId?: string,
  pageLimit?: number,
  quarantineOutboxForGenerationReset = false,
  expectedGenerationId?: string,
  preserveLegacyBootstrapIntent = false,
): Promise<SnapshotLoadResult> => {
  const records: V2SnapshotRecord[] = [];
  let sessionId: string | undefined;
  let offset = 0;
  let finalGeneration = generationId ?? '';
  let revision = 0;
  let datasetHash = '';
  const recordKeys = new Set<string>();
  while (true) {
    const page = await fetchV2SnapshotPage(
      baseUrl,
      token,
      generationId,
      sessionId,
      offset,
      pageLimit,
    );
    if (sessionId && page.session_id !== sessionId) {
      throw new Error('Snapshot-Session hat sich während des Downloads geändert.');
    }
    if (sessionId && page.generation_id !== finalGeneration) {
      throw new Error('Snapshot-Generation hat sich während des Downloads geändert.');
    }
    if (sessionId && page.snapshot_revision !== revision) {
      throw new Error('Snapshot-Revision hat sich während des Downloads geändert.');
    }
    if (sessionId && page.dataset_hash !== datasetHash) {
      throw new Error('Snapshot-Hash hat sich während des Downloads geändert.');
    }
    sessionId = page.session_id;
    finalGeneration = page.generation_id;
    revision = page.snapshot_revision;
    datasetHash = page.dataset_hash;
    for (const record of page.records) {
      const recordKey = `${record.entity_type}\u0000${record.entity_id}`;
      if (recordKeys.has(recordKey)) {
        throw new Error(`Snapshot enthält den Datensatz ${record.entity_type}/${record.entity_id} mehrfach.`);
      }
      recordKeys.add(recordKey);
      records.push(record);
    }
    if (!page.has_more) break;
    if (page.next_offset == null || page.next_offset <= offset) {
      throw new Error('Server lieferte einen ungültigen Snapshot-Cursor.');
    }
    offset = page.next_offset;
  }

  const downloadedHash = await calculateDatasetHash(records.map(record => ({
    entity_type: record.entity_type,
    entity_id: record.entity_id,
    data: record.data ?? record.record ?? record.value ?? {},
  })));
  if (downloadedHash.toLowerCase() !== datasetHash.toLowerCase()) {
    throw new Error('Integritätsprüfung des heruntergeladenen Server-Snapshots fehlgeschlagen.');
  }

  const generationChangedDuringSnapshot = Boolean(
    expectedGenerationId && finalGeneration !== expectedGenerationId,
  );
  await repository.replaceSnapshot(
    records,
    quarantineOutboxForGenerationReset || generationChangedDuringSnapshot,
    preserveLegacyBootstrapIntent && !generationChangedDuringSnapshot,
  );
  await repository.rebasePendingProductMutations();
  if (!await verifyShadowHash(repository, datasetHash)) {
    throw new Error('Integritätsprüfung des vollständigen Server-Snapshots fehlgeschlagen.');
  }
  await repository.updateSyncState({
    protocol: 'v2',
    generationId: finalGeneration,
    cursor: revision,
    datasetHash,
    snapshotRequired: false,
    lastError: null,
  });
  return { generationId: finalGeneration, revision, datasetHash, count: records.length };
};

const loadSnapshot = async (
  repository: ProductSyncRepository,
  baseUrl: string,
  token: string,
  generationId?: string,
  pageLimit?: number,
  quarantineOutboxForGenerationReset = false,
  expectedGenerationIdOverride?: string,
  preserveLegacyBootstrapIntent = false,
): Promise<SnapshotLoadResult> => {
  let sessionRestarted = false;
  let integrityRepaired = false;
  let requestedGeneration = generationId;
  const expectedGenerationId = generationId ?? expectedGenerationIdOverride;
  while (true) {
    try {
      const result = await loadSnapshotOnce(
        repository,
        baseUrl,
        token,
        requestedGeneration,
        pageLimit,
        quarantineOutboxForGenerationReset,
        expectedGenerationId,
        preserveLegacyBootstrapIntent,
      );
      return { ...result, integrityRepaired };
    } catch (error) {
      if (
        error instanceof SyncProtocolError
        && error.code === 'snapshot_expired'
        && !sessionRestarted
      ) {
        sessionRestarted = true;
        requestedGeneration = undefined;
        console.warn('V2 snapshot session expired; restarting it once.');
        continue;
      }
      if (
        error instanceof Error
        && /^Integrit/.test(error.message)
        && !integrityRepaired
      ) {
        integrityRepaired = true;
        requestedGeneration = undefined;
        console.warn('V2 snapshot hash mismatch; downloading one fresh repair snapshot.');
        continue;
      }
      throw error;
    }
  }
};

const pullUntilCurrent = async (
  repository: ProductSyncRepository,
  baseUrl: string,
  token: string,
  capabilities: V2Capabilities,
): Promise<{ pulled: number; hash: string | null }> => {
  let state = await repository.getSyncState();
  let pulled = 0;
  let finalHash: string | null = null;
  while (true) {
    const generationId = state.generationId ?? capabilities.generation_id;
    const response = await pullV2Changes(
      baseUrl,
      token,
      generationId,
      state.cursor,
      capabilities.limits?.pull_changes ?? capabilities.limits?.max_pull_limit,
    );
    if (response.generation_id !== generationId) {
      throw new SyncProtocolError(
        'Der Server wechselte die Datensatz-Generation während des Pulls.',
        409,
        'generation_mismatch',
        true,
      );
    }
    if (
      !Number.isSafeInteger(response.next_cursor)
      || response.next_cursor < 0
      || response.next_cursor < state.cursor
      || (response.has_more && response.next_cursor <= state.cursor)
    ) {
      throw new SyncProtocolError(
        'Der Server lieferte beim inkrementellen Pull keinen gültigen Cursor-Fortschritt.',
        409,
        'cursor_ahead',
        true,
      );
    }
    if (response.changes.some(change => change.operation === 'dataset_reset')) {
      throw new SyncProtocolError(
        'Der Server-Datensatz wurde zurueckgesetzt; ein neuer Snapshot ist erforderlich.',
        409,
        'generation_mismatch',
        true,
      );
    }
    for (const change of response.changes) await repository.applyChange(change);
    pulled += response.changes.length;
    state = await repository.updateSyncState({
      protocol: 'v2',
      generationId: response.generation_id,
      cursor: response.next_cursor,
      minAvailableRevision: response.min_available_revision,
      datasetHash: response.dataset_hash ?? state.datasetHash,
      snapshotRequired: false,
    });
    if (!response.has_more) {
      finalHash = response.dataset_hash;
      break;
    }
  }
  return { pulled, hash: finalHash };
};

export const pushOutbox = async (
  repository: ProductSyncRepository,
  baseUrl: string,
  token: string,
  capabilities: V2Capabilities,
): Promise<number> => {
  let pushed = 0;
  const batchLimit = capabilities.limits?.push_mutations
    ?? capabilities.limits?.max_mutations
    ?? 100;
  while (true) {
    const candidates = await repository.getSendableOutbox();
    if (candidates.length === 0) break;
    const seenEntities = new Set<string>();
    const batch: OutboxRecord[] = [];
    for (const candidate of candidates) {
      const entityKey = `${candidate.entityType}\u0000${candidate.entityId}`;
      if (seenEntities.has(entityKey)) continue;
      seenEntities.add(entityKey);
      batch.push(candidate);
      if (batch.length >= batchLimit) break;
    }
    const claimedBatch: OutboxRecord[] = [];
    for (const record of batch) {
      const claimed = await repository.markSending(record);
      if (claimed) claimedBatch.push(claimed);
    }
    if (claimedBatch.length === 0) continue;
    try {
      const state = await repository.getSyncState();
      const response = await pushV2Mutations(
        baseUrl,
        token,
        state.generationId ?? capabilities.generation_id,
        repository.profile.clientId,
        claimedBatch.map(mutationFromOutbox),
      );
      if (response.generation_id !== (state.generationId ?? capabilities.generation_id)) {
        throw new SyncProtocolError(
          'Der Server wechselte die Datensatz-Generation während des Pushs.',
          409,
          'generation_mismatch',
          true,
        );
      }
      const resultMutationIds = response.results.map(result => result.mutation_id);
      if (new Set(resultMutationIds).size !== resultMutationIds.length) {
        throw new Error('Serverantwort enthielt eine Mutation mehrfach.');
      }
      if (response.results.some(result => !['applied', 'noop', 'conflict'].includes(result.status))) {
        throw new Error('Serverantwort enthielt einen ungültigen Mutationsstatus.');
      }
      const resultsByMutation = new Map(response.results.map(result => [result.mutation_id, result]));
      const missingAcknowledgements: string[] = [];
      for (const record of claimedBatch) {
        const result = resultsByMutation.get(record.mutationId);
        if (!result) {
          missingAcknowledgements.push(record.mutationId);
          await repository.markOutboxError(record, 'Serverantwort enthielt keine Bestätigung.');
          continue;
        }
        if (result.status === 'conflict') {
          const conflictFields = result.conflict?.fields;
          const fields = Array.isArray(conflictFields)
            ? conflictFields
            : conflictFields && typeof conflictFields === 'object'
              ? Object.keys(conflictFields)
              : result.conflicting_fields ?? result.fields ?? [];
          await repository.recordConflict(
            record,
            result.conflict?.server_revision === null
              ? 0
              : result.conflict?.server_revision
              ?? result.revision
              ?? result.record_revision
              ?? record.baseRevision,
            fields,
            result.conflict?.server_data ?? result.data ?? result.record ?? null,
          );
        } else {
          await repository.acknowledgeMutation(
            record,
            result.revision ?? result.record_revision ?? response.current_revision,
            result.data ?? result.record,
          );
          pushed++;
        }
        await repository.rebasePendingProductMutations(record.entityId);
      }
      if (missingAcknowledgements.length > 0) {
        throw new Error(
          `Server bestätigte ${missingAcknowledgements.length} Mutation(en) nicht vollständig.`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stillQueuedIds = new Set((await repository.getOutbox()).map(record => record.mutationId));
      for (const record of claimedBatch) {
        if (stillQueuedIds.has(record.mutationId)) await repository.markOutboxError(record, message);
      }
      throw error;
    }
  }
  return pushed;
};

const runV2SyncUnlocked = async (
  repository: ProductSyncRepository,
  baseUrl: string,
  token: string,
  knownCapabilities?: V2Capabilities,
): Promise<SyncRunResult> => {
  const detectedCapabilities = knownCapabilities
    ?? await detectV2Capabilities(baseUrl, token, CLIENT_VERSION);
  if (!detectedCapabilities) {
    await repository.updateSyncState({
      protocol: 'v1',
      capabilityCheckedAt: Date.now(),
      lastError: null,
    });
    return {
      protocol: 'v1',
      products: await repository.getProducts(),
      warning: 'Der Server unterstützt noch keinen inkrementellen Sync. Vollständiger V1-Sync bleibt aktiv.',
      conflicts: await repository.countConflicts(),
      pushed: 0,
      pulled: 0,
    };
  }
  let capabilities = detectedCapabilities;
  if (capabilities.canonicalization !== SUPPORTED_CANONICALIZATION) {
    throw new Error(`Nicht unterstützte Server-Kanonisierung: ${capabilities.canonicalization}`);
  }

  let warning: string | undefined;
  const recoverWithSnapshot = async (error: unknown): Promise<void> => {
    if (!requiresSnapshot(error)) throw error;
    if (error instanceof SyncProtocolError && error.code === 'generation_mismatch') {
      const refreshed = await detectV2Capabilities(baseUrl, token, CLIENT_VERSION);
      if (!refreshed) throw new Error('The server disabled V2 during synchronization.');
      if (refreshed.canonicalization !== SUPPORTED_CANONICALIZATION) {
        throw new Error(`Unsupported server canonicalization: ${refreshed.canonicalization}`);
      }
      capabilities = refreshed;
    }
    const preRepairState = await repository.getSyncState();
    const snapshot = await loadSnapshot(
      repository,
      baseUrl,
      token,
      undefined,
      capabilities.limits?.snapshot_records ?? capabilities.limits?.max_snapshot_limit,
      error instanceof SyncProtocolError && error.code === 'generation_mismatch',
      preRepairState.generationId ?? capabilities.generation_id,
    );
    warning = 'Der inkrementelle Sync-Zustand war veraltet und wurde durch einen neuen Snapshot repariert.';
    if (snapshot.integrityRepaired) {
      warning += ' Eine Hash-Abweichung im Snapshot wurde durch einen zweiten Volldownload repariert.';
    }
  };

  let state = await repository.getSyncState();
  const preserveLegacyBootstrapIntent = state.generationId == null && state.lastSyncAt == null;
  const generationChanged = state.generationId !== capabilities.generation_id;
  if (state.generationId && generationChanged) {
    warning = 'Der Server-Datensatz wurde ersetzt; der lokale Sync-Stand wurde aus einem neuen Snapshot aufgebaut.';
  }
  if (generationChanged || state.snapshotRequired || state.cursor < capabilities.min_available_revision) {
    try {
      const snapshot = await loadSnapshot(
        repository,
        baseUrl,
        token,
        generationChanged ? undefined : capabilities.generation_id,
        capabilities.limits?.snapshot_records ?? capabilities.limits?.max_snapshot_limit,
        Boolean(state.generationId && generationChanged),
        undefined,
        preserveLegacyBootstrapIntent,
      );
      if (snapshot.integrityRepaired) {
        warning = [
          warning,
          'Eine Hash-Abweichung im Snapshot wurde durch einen zweiten Volldownload repariert.',
        ].filter(Boolean).join(' ');
      }
    } catch (error) {
      await recoverWithSnapshot(error);
    }
  }

  // Only records still lacking a server shadow after bootstrap/snapshot are
  // genuine local-only intent. Queuing before the first snapshot would turn a
  // stale cloned cache into a base-revision-zero overwrite.
  await repository.queueProductsWithoutShadow();

  let pulled = 0;
  try {
    const pullResult = await pullUntilCurrent(repository, baseUrl, token, capabilities);
    pulled += pullResult.pulled;
  } catch (error) {
    await recoverWithSnapshot(error);
  }

  let pushed = 0;
  let finalPull: Awaited<ReturnType<typeof pullUntilCurrent>> | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      pushed += await pushOutbox(repository, baseUrl, token, capabilities);
      finalPull = await pullUntilCurrent(repository, baseUrl, token, capabilities);
      break;
    } catch (error) {
      if (attempt > 0 || !requiresSnapshot(error)) throw error;
      await recoverWithSnapshot(error);
    }
  }
  if (!finalPull) throw new Error('V2 synchronization could not be completed.');
  pulled += finalPull.pulled;
  if (!await verifyShadowHash(repository, finalPull.hash)) {
    // A single automatic repair attempt. Never accept a second mismatch silently.
    console.warn('V2 dataset hash mismatch; starting a full repair snapshot.');
    const currentState = await repository.getSyncState();
    const repaired = await loadSnapshot(
      repository,
      baseUrl,
      token,
      currentState.generationId ?? capabilities.generation_id,
      capabilities.limits?.snapshot_records ?? capabilities.limits?.max_snapshot_limit,
    );
    if (!await verifyShadowHash(repository, repaired.datasetHash)) {
      throw new Error('Integritätsprüfung blieb auch nach dem Reparatur-Sync fehlerhaft.');
    }
    warning = [
      warning,
      'Eine Hash-Abweichung wurde erkannt und durch einen vollstaendigen Reparatur-Sync behoben.',
    ].filter(Boolean).join(' ');
  }

  state = await repository.getSyncState();
  state = await repository.updateSyncState({
    protocol: 'v2',
    generationId: state.generationId ?? capabilities.generation_id,
    serverInstanceId: capabilities.server_instance_id ?? null,
    minAvailableRevision: Math.max(state.minAvailableRevision, capabilities.min_available_revision),
    capabilityCheckedAt: Date.now(),
    lastSyncAt: Date.now(),
    lastError: null,
    snapshotRequired: false,
  });
  void state;
  return {
    protocol: 'v2',
    products: await repository.getProducts(),
    warning,
    conflicts: await repository.countConflicts(),
    pushed,
    pulled,
  };
};

export const runWithProfileSyncLock = async <T,>(
  profileId: string,
  operationCallback: () => Promise<T>,
): Promise<T> => {
  const runWithProcessLock = async (): Promise<T> => {
    const previous = profileSyncLocks.get(profileId) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(operationCallback);
    const settled = operation.then(() => undefined, () => undefined);
    profileSyncLocks.set(profileId, settled);
    try {
      return await operation;
    } finally {
      if (profileSyncLocks.get(profileId) === settled) {
        profileSyncLocks.delete(profileId);
      }
    }
  };

  // Web Locks serialize the same IndexedDB profile across browser tabs. The
  // in-process queue remains the deterministic fallback for tests and older
  // browsers which do not expose navigator.locks.
  const browserLocks = getBrowserLockManager();
  if (browserLocks) {
    return browserLocks.request(
      `vine-product-manager-sync:${profileId}`,
      { mode: 'exclusive' },
      runWithProcessLock,
    );
  }
  return runWithProcessLock();
};

export const runV2Sync = async (
  repository: ProductSyncRepository,
  baseUrl: string,
  token: string,
  knownCapabilities?: V2Capabilities,
): Promise<SyncRunResult> => runWithProfileSyncLock(
  repository.profile.id,
  () => runV2SyncUnlocked(repository, baseUrl, token, knownCapabilities),
);

export const detectSyncProtocol = async (
  repository: ProductSyncRepository,
  baseUrl: string,
  token: string,
): Promise<V2Capabilities | null> => {
  try {
    const capabilities = await detectV2Capabilities(baseUrl, token, CLIENT_VERSION);
    await repository.updateSyncState({
      protocol: capabilities ? 'v2' : 'v1',
      capabilityCheckedAt: Date.now(),
      minAvailableRevision: capabilities?.min_available_revision ?? 0,
      lastError: null,
    });
    return capabilities;
  } catch (error) {
    await repository.updateSyncState({
      lastError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

export const queueProductsForSync = async (
  repository: ProductSyncRepository,
  products: Product[],
  baseProducts: Array<Product | undefined> = [],
): Promise<void> => {
  await repository.queueProducts(products, baseProducts);
};
