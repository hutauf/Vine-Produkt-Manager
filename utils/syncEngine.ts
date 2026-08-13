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
  V2PullData,
  V2PushData,
  V2SnapshotRecord,
} from './syncTypes';

const CLIENT_VERSION = '2.1.0';
const SUPPORTED_CANONICALIZATION = 'jcs-rfc8785-v1';
const profileSyncLocks = new Map<string, Promise<void>>();
const integritySnapshotTimers = new Map<string, ReturnType<typeof setTimeout>>();
const AUTHORITATIVE_STATUS_FIELDS = new Set([
  'usageStatus', 'verkauft', 'lager', 'entsorgt', 'storniert', 'betriebsausgabe',
]);

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

const mutationFromOutbox = (
  record: OutboxRecord,
  supportsAuthoritativeStatus: boolean,
): V2Mutation => {
  const authoritativeFields = supportsAuthoritativeStatus
    && record.entityType === 'product'
    && record.operation === 'patch'
    ? [...new Set([...Object.keys(record.set), ...record.unset])]
      .filter(field => AUTHORITATIVE_STATUS_FIELDS.has(field))
    : [];
  return {
    mutation_id: record.mutationId,
    client_id: record.clientId,
    entity_type: record.entityType,
    entity_id: record.entityId,
    base_revision: record.baseRevision,
    operation: record.operation,
    intent_age_ms: Math.max(0, Date.now() - record.createdAt),
    ...(record.operation === 'patch' ? {
      set: record.set,
      unset: record.unset,
      ...(authoritativeFields.length > 0 ? { authoritative_fields: authoritativeFields } : {}),
    } : {}),
  };
};

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
  if (generationChangedDuringSnapshot) {
    await repository.discardAllLocalIntents();
  }
  await repository.replaceSnapshot(
    records,
    quarantineOutboxForGenerationReset && !generationChangedDuringSnapshot,
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
    lastIntegritySnapshotAt: Date.now(),
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

const applyPullPage = async (
  repository: ProductSyncRepository,
  response: V2PullData,
  generationId: string,
  previousCursor: number,
): Promise<{ pulled: number; hash: string | null; hasMore: boolean }> => {
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
    || response.next_cursor < previousCursor
    || (response.has_more && response.next_cursor <= previousCursor)
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
      'Der Server-Datensatz wurde zurückgesetzt; ein neuer Snapshot ist erforderlich.',
      409,
      'generation_mismatch',
      true,
    );
  }
  for (const change of response.changes) await repository.applyChange(change);
  const state = await repository.getSyncState();
  await repository.updateSyncState({
    protocol: 'v2',
    generationId: response.generation_id,
    cursor: response.next_cursor,
    minAvailableRevision: response.min_available_revision,
    datasetHash: response.dataset_hash ?? state.datasetHash,
    snapshotRequired: false,
  });
  return {
    pulled: response.changes.length,
    hash: response.dataset_hash,
    hasMore: response.has_more,
  };
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
    const applied = await applyPullPage(repository, response, generationId, state.cursor);
    pulled += applied.pulled;
    state = await repository.getSyncState();
    if (!applied.hasMore) {
      finalHash = applied.hash;
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
): Promise<{
  pushed: number;
  pulled: number;
  rejected: number;
  hash: string | null;
  exchanged: boolean;
}> => {
  let pushed = 0;
  let pulled = 0;
  let rejected = 0;
  let finalHash: string | null = null;
  let exchanged = false;
  const supportsExchange = capabilities.features?.push_pull_exchange === true;
  const supportsAuthoritativeStatus = capabilities.features?.authoritative_status_fields === true;
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
        claimedBatch.map(record => mutationFromOutbox(record, supportsAuthoritativeStatus)),
        supportsExchange ? {
          pullSince: state.cursor,
          pullLimit: capabilities.limits?.pull_changes ?? capabilities.limits?.max_pull_limit,
          entityTypes: ['product'],
        } : undefined,
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
          // V2.1 product patches are conflict-free. If an older server still
          // rejects a mutation, server state wins automatically after the
          // remaining outbox has drained and a verified snapshot is loaded.
          await repository.discardMutation(record);
          rejected++;
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
      if (supportsExchange) {
        if (
          !Array.isArray(response.changes)
          || !Number.isSafeInteger(response.next_cursor)
          || typeof response.has_more !== 'boolean'
          || !Number.isSafeInteger(response.min_available_revision)
        ) {
          throw new Error('Server kündigte V2.1-Exchange an, lieferte aber keine gültige Change-Seite.');
        }
        const applied = await applyPullPage(
          repository,
          response as V2PushData & V2PullData,
          state.generationId ?? capabilities.generation_id,
          state.cursor,
        );
        pulled += applied.pulled;
        finalHash = applied.hash;
        exchanged = true;
        if (applied.hasMore) {
          const remainder = await pullUntilCurrent(repository, baseUrl, token, capabilities);
          pulled += remainder.pulled;
          finalHash = remainder.hash;
        }
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
  return { pushed, pulled, rejected, hash: finalHash, exchanged };
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
      capabilityClientVersion: CLIENT_VERSION,
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
      await repository.discardAllLocalIntents();
    }
    const preRepairState = await repository.getSyncState();
    const snapshot = await loadSnapshot(
      repository,
      baseUrl,
      token,
      undefined,
      capabilities.limits?.snapshot_records ?? capabilities.limits?.max_snapshot_limit,
      false,
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
    await repository.discardAllLocalIntents();
  }
  if (generationChanged || state.snapshotRequired || state.cursor < capabilities.min_available_revision) {
    try {
      const snapshot = await loadSnapshot(
        repository,
        baseUrl,
        token,
        generationChanged ? undefined : capabilities.generation_id,
        capabilities.limits?.snapshot_records ?? capabilities.limits?.max_snapshot_limit,
        false,
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
  if (preserveLegacyBootstrapIntent) await repository.queueProductsWithoutShadow();

  let pulled = 0;
  let pushed = 0;
  let rejected = 0;
  let finalHash: string | null = null;
  let synchronized = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const pushResult = await pushOutbox(repository, baseUrl, token, capabilities);
      pushed += pushResult.pushed;
      pulled += pushResult.pulled;
      rejected += pushResult.rejected;
      if (pushResult.rejected > 0) {
        await repository.updateSyncState({ serverRepairRequired: true });
      }
      finalHash = pushResult.hash;
      if (!pushResult.exchanged) {
        const pullResult = await pullUntilCurrent(repository, baseUrl, token, capabilities);
        pulled += pullResult.pulled;
        finalHash = pullResult.hash;
      }
      synchronized = true;
      break;
    } catch (error) {
      if (attempt > 0 || !requiresSnapshot(error)) throw error;
      await recoverWithSnapshot(error);
    }
  }
  if (!synchronized) throw new Error('V2 synchronization could not be completed.');
  const repairState = await repository.getSyncState();
  const openConflictCount = await repository.countConflicts();
  if (openConflictCount > 0) {
    // Conflicts created by pre-2.1 clients must not keep their related local
    // intents blocked forever. Server state wins for those entities.
    await repository.discardConflictedMutations();
  }
  const repairRequired = repairState.serverRepairRequired === true
    || rejected > 0
    || openConflictCount > 0;
  if (repairRequired && (await repository.getOutbox()).length === 0) {
    await repository.clearConflicts();
    const currentState = await repository.getSyncState();
    const repaired = await loadSnapshot(
      repository,
      baseUrl,
      token,
      currentState.generationId ?? capabilities.generation_id,
      capabilities.limits?.snapshot_records ?? capabilities.limits?.max_snapshot_limit,
    );
    const catchUp = await pullUntilCurrent(repository, baseUrl, token, capabilities);
    pulled += catchUp.pulled;
    finalHash = catchUp.hash ?? repaired.datasetHash;
    warning = [
      warning,
      rejected > 0
        ? `${rejected} veraltete Änderung(en) wurden vom Server abgelehnt; der lokale Stand wurde automatisch aus einem vollständigen Server-Snapshot repariert.`
        : 'Eine alte Konfliktmarkierung wurde automatisch durch den vollständigen Serverstand ersetzt.',
    ].filter(Boolean).join(' ');
    await repository.updateSyncState({ serverRepairRequired: false });
  }
  if (!await verifyShadowHash(repository, finalHash)) {
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
    capabilities,
    capabilityCheckedAt: Date.now(),
    capabilityClientVersion: CLIENT_VERSION,
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

const scheduleDailyIntegritySnapshot = async (
  repository: ProductSyncRepository,
  baseUrl: string,
  token: string,
  capabilities: V2Capabilities,
): Promise<void> => {
  if (typeof window === 'undefined' || integritySnapshotTimers.has(repository.profile.id)) return;
  const state = await repository.getSyncState();
  const oneDay = 24 * 60 * 60 * 1000;
  if (Date.now() - Number(state.lastIntegritySnapshotAt || 0) < oneDay) return;
  const timer = setTimeout(() => {
    void runWithProfileSyncLock(repository.profile.id, async () => {
      const currentState = await repository.getSyncState();
      if (Date.now() - Number(currentState.lastIntegritySnapshotAt || 0) < oneDay) return;
      if ((await repository.getOutbox()).length > 0) return;
      const snapshot = await loadSnapshot(
        repository,
        baseUrl,
        token,
        currentState.generationId ?? capabilities.generation_id,
        capabilities.limits?.snapshot_records ?? capabilities.limits?.max_snapshot_limit,
      );
      await pullUntilCurrent(repository, baseUrl, token, capabilities);
      await repository.updateSyncState({
        lastIntegritySnapshotAt: Date.now(),
        datasetHash: snapshot.datasetHash,
      });
    }).catch(error => {
      console.warn('Täglicher V2.1-Integritäts-Snapshot wurde verschoben:', error);
    }).finally(() => {
      integritySnapshotTimers.delete(repository.profile.id);
    });
  }, 10_000);
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref: () => void }).unref();
  }
  integritySnapshotTimers.set(repository.profile.id, timer);
};

export const runV2Sync = async (
  repository: ProductSyncRepository,
  baseUrl: string,
  token: string,
  knownCapabilities?: V2Capabilities,
): Promise<SyncRunResult> => {
  const result = await runWithProfileSyncLock(
    repository.profile.id,
    () => runV2SyncUnlocked(repository, baseUrl, token, knownCapabilities),
  );
  if (result.protocol === 'v2') {
    const capabilities = knownCapabilities ?? (await repository.getSyncState()).capabilities;
    if (capabilities) void scheduleDailyIntegritySnapshot(repository, baseUrl, token, capabilities);
  }
  return result;
};

export const detectSyncProtocol = async (
  repository: ProductSyncRepository,
  baseUrl: string,
  token: string,
): Promise<V2Capabilities | null> => {
  try {
    const state = await repository.getSyncState();
    if (
      state.protocol === 'v2'
      && state.capabilities?.protocol_version === 2
      && state.capabilityClientVersion === CLIENT_VERSION
      && state.capabilityCheckedAt != null
      && Date.now() - state.capabilityCheckedAt < 24 * 60 * 60 * 1000
    ) {
      return state.capabilities;
    }
    const capabilities = await detectV2Capabilities(baseUrl, token, CLIENT_VERSION);
    await repository.updateSyncState({
      protocol: capabilities ? 'v2' : 'v1',
      capabilities,
      capabilityCheckedAt: Date.now(),
      capabilityClientVersion: CLIENT_VERSION,
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
