import Dexie, { Table } from 'dexie';
import { Product } from '../types';
import { canonicalizeJson, canonicalRequestHash } from './syncCanonical';
import {
  normalizeSyncedProduct,
  serializeCompatibilityFields,
} from './syncProductCompatibility';
import {
  ConflictRecord,
  JsonObject,
  OutboxRecord,
  ShadowRecord,
  StoredProductRecord,
  SyncEntityType,
  SyncProfile,
  SyncStateRecord,
  V2Change,
  V2SnapshotRecord,
} from './syncTypes';

export const LEGACY_PRODUCTS_STORAGE_KEY = 'vineApp_products';
const LEGACY_MIGRATION_MARKER = 'vineApp_products_dexie_migrated_v1';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

class VineSyncDatabase extends Dexie {
  profiles!: Table<SyncProfile, string>;
  products!: Table<StoredProductRecord, [string, string]>;
  shadows!: Table<ShadowRecord, [string, SyncEntityType, string]>;
  outbox!: Table<OutboxRecord, number>;
  conflicts!: Table<ConflictRecord, number>;
  syncStates!: Table<SyncStateRecord, string>;

  constructor() {
    super('vine-product-manager-sync');
    this.version(1).stores({
      profiles: '&id,localOnly,lastUsedAt',
      products: '[profileId+asin],profileId,asin,[profileId+deleted]',
      shadows: '[profileId+entityType+entityId],profileId,[profileId+entityType],recordRevision',
      outbox: '++id,&mutationId,profileId,[profileId+entityType+entityId],[profileId+state],createdAt',
      conflicts: '++id,profileId,mutationId,[profileId+entityType+entityId],resolvedAt,createdAt',
      syncStates: '&profileId,protocol,lastSyncAt',
    });
  }
}

export const syncDatabase = new VineSyncDatabase();

const cloneJson = <T,>(value: T): T => {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

const diffJsonObjects = (
  base: JsonObject,
  desired: JsonObject,
): { set: JsonObject; unset: string[] } => {
  const set: JsonObject = {};
  const unset: string[] = [];
  Object.entries(desired).forEach(([key, value]) => {
    if (JSON.stringify(base[key]) !== JSON.stringify(value)) set[key] = cloneJson(value);
  });
  Object.keys(base).forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(desired, key)) unset.push(key);
  });
  return { set, unset };
};

const jsonFieldsEqual = (left: JsonObject, right: JsonObject, key: string): boolean => {
  const leftHas = Object.prototype.hasOwnProperty.call(left, key);
  const rightHas = Object.prototype.hasOwnProperty.call(right, key);
  return leftHas === rightHas
    && (!leftHas || canonicalizeJson(left[key]) === canonicalizeJson(right[key]));
};

const COMPATIBILITY_FIELDS = [
  'usageStatus',
  'myTeilwert',
  'myteilwert',
  'verkauft',
  'lager',
  'entsorgt',
  'storniert',
  'betriebsausgabe',
];

const hasOwn = (value: object, field: PropertyKey): boolean => (
  Object.prototype.hasOwnProperty.call(value, field)
);

const compatibilityFieldsDiffer = (left: JsonObject, right: JsonObject): boolean => (
  COMPATIBILITY_FIELDS.some(field => hasOwn(right, field) && !jsonFieldsEqual(left, right, field))
);

interface LocalIntent {
  operation: 'patch' | 'delete';
  set: JsonObject;
  unset: string[];
  createdAt: number;
  order: number;
}

const compareOutboxOrder = (left: OutboxRecord, right: OutboxRecord): number => (
  left.createdAt - right.createdAt || (left.id ?? 0) - (right.id ?? 0)
);

const compareConflictOrder = (left: ConflictRecord, right: ConflictRecord): number => (
  left.createdAt - right.createdAt || (left.id ?? 0) - (right.id ?? 0)
);

const overlayLocalIntents = (
  serverValue: JsonObject,
  serverDeleted: boolean,
  conflicts: ConflictRecord[],
  outbox: OutboxRecord[],
): { value: JsonObject; deleted: boolean } => {
  const intents: LocalIntent[] = [
    ...conflicts
      .filter(conflict => conflict.resolvedAt == null)
      .map((conflict, order) => ({
        operation: conflict.localOperation ?? 'patch',
        set: conflict.localSet ?? {},
        unset: conflict.localUnset ?? [],
        createdAt: conflict.createdAt,
        order,
      })),
    ...outbox.map((mutation, order) => ({
      operation: mutation.operation,
      set: mutation.set,
      unset: mutation.unset,
      createdAt: mutation.createdAt,
      order: conflicts.length + order,
    })),
  ].sort((left, right) => left.createdAt - right.createdAt || left.order - right.order);

  let value = cloneJson(serverValue);
  let deleted = serverDeleted;
  for (const intent of intents) {
    if (intent.operation === 'delete') {
      value = {};
      deleted = true;
    } else {
      value = cloneJson(value);
      Object.entries(intent.set).forEach(([key, fieldValue]) => {
        value[key] = cloneJson(fieldValue);
      });
      intent.unset.forEach(key => { delete value[key]; });
      deleted = false;
    }
  }
  return { value, deleted };
};

const createUuid = (): string => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `vpm-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const canonicalizeAsin = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(normalized) ? normalized : null;
};

const productToRawStoredValue = (product: Product): JsonObject => {
  const value: JsonObject = {};
  Object.entries(product as Product & JsonObject).forEach(([key, fieldValue]) => {
    if (key === 'ASIN' || key === 'last_update_time' || fieldValue === undefined) return;
    value[key] = cloneJson(fieldValue);
  });
  return value;
};

export const productToStoredValue = (product: Product): JsonObject => (
  productToRawStoredValue(product)
);

export const storedProductToProduct = (record: StoredProductRecord): Product => ({
  ...cloneJson(record.value),
  ASIN: record.asin,
  last_update_time: record.legacyLastUpdateTime,
} as Product);

export interface V1ProductSettlement {
  asin: string;
  accepted: boolean;
  serverProduct?: Product;
}

const normalizeServerProductValue = (
  asin: string,
  value: JsonObject,
  legacyLastUpdateTime = 0,
): JsonObject => productToStoredValue(normalizeSyncedProduct(asin, value, legacyLastUpdateTime));

const mergeLegacyProducts = (products: Product[]): Product[] => {
  const grouped = new Map<string, Product[]>();
  products.forEach(product => {
    const asin = canonicalizeAsin(product?.ASIN);
    if (!asin) return;
    const variants = grouped.get(asin) ?? [];
    variants.push(product);
    grouped.set(asin, variants);
  });
  return Array.from(grouped, ([asin, variants]) => {
    const ordered = [...variants].sort((left, right) => {
      const timestampDifference = (Number(left.last_update_time) || 0)
        - (Number(right.last_update_time) || 0);
      if (timestampDifference !== 0) return timestampDifference;
      const canonicalDifference = Number(left.ASIN === asin) - Number(right.ASIN === asin);
      return canonicalDifference || left.ASIN.localeCompare(right.ASIN);
    });
    return ordered.reduce<Product>(
      (merged, variant) => ({ ...merged, ...variant, ASIN: asin }),
      { ...ordered[0], ASIN: asin },
    );
  });
};

const defaultSyncState = (profileId: string): SyncStateRecord => ({
  profileId,
  protocol: 'v1',
  generationId: null,
  serverInstanceId: null,
  cursor: 0,
  minAvailableRevision: 0,
  datasetHash: null,
  capabilityCheckedAt: null,
  lastSyncAt: null,
  lastError: null,
  snapshotRequired: false,
});

export const getProfileId = async (baseUrl: string, token: string | null): Promise<string> => {
  if (!token) return 'local';
  let normalizedUrl: string;
  try {
    const parsed = new URL(baseUrl.trim());
    parsed.hash = '';
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    if (
      (parsed.protocol === 'https:' && parsed.port === '443')
      || (parsed.protocol === 'http:' && parsed.port === '80')
    ) parsed.port = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    normalizedUrl = parsed.toString();
  } catch {
    normalizedUrl = baseUrl.trim().replace(/\/+$/, '');
  }
  return `remote:${await canonicalRequestHash([normalizedUrl, token.trim()])}`;
};

export const ensureSyncProfile = async (
  baseUrl: string,
  token: string | null,
): Promise<SyncProfile> => {
  const id = await getProfileId(baseUrl, token);
  const existing = await syncDatabase.profiles.get(id);
  const now = Date.now();
  const profile: SyncProfile = existing ?? {
    id,
    clientId: createUuid(),
    baseUrl: baseUrl.trim(),
    tokenFingerprint: token ? id.slice('remote:'.length, 'remote:'.length + 16) : null,
    localOnly: !token,
    createdAt: now,
    lastUsedAt: now,
  };
  profile.baseUrl = baseUrl.trim();
  profile.lastUsedAt = now;
  await syncDatabase.transaction('rw', syncDatabase.profiles, syncDatabase.syncStates, async () => {
    await syncDatabase.profiles.put(profile);
    if (!await syncDatabase.syncStates.get(id)) {
      await syncDatabase.syncStates.put(defaultSyncState(id));
    }
  });
  return profile;
};

export const migrateLegacyLocalStorage = async (
  profile: SyncProfile,
  storage: StorageLike | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): Promise<number> => {
  if (!storage || storage.getItem(LEGACY_MIGRATION_MARKER)) return 0;
  const serialized = storage.getItem(LEGACY_PRODUCTS_STORAGE_KEY);
  if (!serialized) {
    storage.setItem(LEGACY_MIGRATION_MARKER, profile.id);
    return 0;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error(`Lokale Produktmigration fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Lokale Produktmigration fehlgeschlagen: vineApp_products ist keine Liste.');
  }

  const products = mergeLegacyProducts(parsed.filter(item => item && typeof item === 'object') as Product[]);
  await syncDatabase.transaction('rw', syncDatabase.products, async () => {
    for (const product of products) {
      const asin = canonicalizeAsin(product.ASIN);
      if (!asin) continue;
      const existing = await syncDatabase.products.get([profile.id, asin]);
      const incomingTimestamp = Number(product.last_update_time) || 0;
      const shouldReplace = !existing || incomingTimestamp >= existing.legacyLastUpdateTime;
      const value = shouldReplace
        ? { ...(existing?.value ?? {}), ...productToStoredValue(product) }
        : { ...productToStoredValue(product), ...existing.value };
      await syncDatabase.products.put({
        profileId: profile.id,
        asin,
        value,
        legacyLastUpdateTime: Math.max(existing?.legacyLastUpdateTime ?? 0, incomingTimestamp),
        recordRevision: existing?.recordRevision ?? 0,
        deleted: 0,
        updatedAt: Date.now(),
      });
    }
  });
  storage.setItem(LEGACY_MIGRATION_MARKER, profile.id);
  storage.removeItem(LEGACY_PRODUCTS_STORAGE_KEY);
  return products.length;
};

export const cloneProfileProductsIfEmpty = async (
  sourceProfileId: string,
  destinationProfileId: string,
): Promise<number> => syncDatabase.transaction(
  'rw',
  [syncDatabase.profiles, syncDatabase.products],
  async () => {
  if (
    sourceProfileId !== 'local'
    || destinationProfileId === 'local'
    || sourceProfileId === destinationProfileId
  ) return 0;
  const localProfile = await syncDatabase.profiles.get('local');
  if (!localProfile || localProfile.localSeedClaimedBy) return 0;
  const source = await syncDatabase.products.where('profileId').equals(sourceProfileId).toArray();
  if (source.length === 0) return 0;
  await syncDatabase.profiles.update('local', { localSeedClaimedBy: destinationProfileId });
  if (await syncDatabase.products.where('profileId').equals(destinationProfileId).count()) return 0;
  const copies = source.map(record => ({
    ...cloneJson(record),
    profileId: destinationProfileId,
    recordRevision: 0,
    updatedAt: Date.now(),
  }));
  await syncDatabase.products.bulkPut(copies);
  return copies.length;
  },
);

export class ProductSyncRepository {
  constructor(readonly profile: SyncProfile) {}

  async getProducts(): Promise<Product[]> {
    const records = await syncDatabase.products
      .where('[profileId+deleted]')
      .equals([this.profile.id, 0])
      .toArray();
    return records.map(storedProductToProduct);
  }

  async putProducts(products: Product[]): Promise<void> {
    await syncDatabase.transaction('rw', syncDatabase.products, async () => {
      for (const product of products) {
        const asin = canonicalizeAsin(product.ASIN);
        if (!asin) continue;
        const existing = await syncDatabase.products.get([this.profile.id, asin]);
        const incomingTimestamp = Number(product.last_update_time);
        await syncDatabase.products.put({
          profileId: this.profile.id,
          asin,
          value: productToStoredValue(product),
          legacyLastUpdateTime: Number.isFinite(incomingTimestamp)
            ? incomingTimestamp
            : existing?.legacyLastUpdateTime ?? 0,
          recordRevision: existing?.recordRevision ?? 0,
          deleted: 0,
          updatedAt: Date.now(),
        });
      }
    });
  }

  async clearLocalProducts(): Promise<void> {
    await syncDatabase.transaction(
      'rw',
      [syncDatabase.products, syncDatabase.shadows, syncDatabase.outbox, syncDatabase.conflicts],
      async () => {
        await syncDatabase.products.where('profileId').equals(this.profile.id).delete();
        await syncDatabase.shadows.where('profileId').equals(this.profile.id).delete();
        await syncDatabase.outbox.where('profileId').equals(this.profile.id).delete();
        await syncDatabase.conflicts.where('profileId').equals(this.profile.id).delete();
      },
    );
  }

  async acknowledgeRemoteDelete(): Promise<void> {
    await syncDatabase.transaction(
      'rw',
      [syncDatabase.outbox, syncDatabase.conflicts, syncDatabase.syncStates],
      async () => {
        await syncDatabase.outbox.where('profileId').equals(this.profile.id).delete();
        await syncDatabase.conflicts.where('profileId').equals(this.profile.id).delete();
        const state = await this.getSyncState();
        await syncDatabase.syncStates.put({
          ...state,
          snapshotRequired: true,
          lastError: null,
        });
      },
    );
  }

  async queueProducts(
    products: Product[],
    baseProducts: Array<Product | undefined> = [],
  ): Promise<OutboxRecord[]> {
    return syncDatabase.transaction(
      'rw',
      [syncDatabase.products, syncDatabase.shadows, syncDatabase.outbox, syncDatabase.conflicts],
      async () => {
        const queued: OutboxRecord[] = [];
        for (const [productIndex, product] of products.entries()) {
          const asin = canonicalizeAsin(product.ASIN);
          if (!asin) throw new Error(`Ungültige ASIN: ${product.ASIN}`);
          const productKey: [string, string] = [this.profile.id, asin];
          const shadowKey: [string, SyncEntityType, string] = [this.profile.id, 'product', asin];
          const existing = await syncDatabase.products.get(productKey);
          const shadow = await syncDatabase.shadows.get(shadowKey);
          const [existingOutbox, existingConflicts] = await Promise.all([
            syncDatabase.outbox
              .where('[profileId+entityType+entityId]')
              .equals([this.profile.id, 'product', asin])
              .toArray(),
            syncDatabase.conflicts
              .where('[profileId+entityType+entityId]')
              .equals([this.profile.id, 'product', asin])
              .toArray(),
          ]);
          const createdAt = Math.max(
            Date.now(),
            ...existingOutbox.map(record => record.createdAt + 1),
            ...existingConflicts
              .filter(conflict => conflict.resolvedAt == null)
              .map(conflict => conflict.createdAt + 1),
          );
          const incomingRaw = productToStoredValue(product);
          const rawIncomingTimestamp = Number(product.last_update_time);
          const previousTimestamp = existing?.legacyLastUpdateTime ?? 0;
          const incomingTimestamp = Number.isFinite(rawIncomingTimestamp)
            ? rawIncomingTimestamp
            : previousTimestamp;
          const candidateBase = baseProducts[productIndex];
          const uiBaseProduct = canonicalizeAsin(candidateBase?.ASIN) === asin
            ? candidateBase
            : undefined;
          const currentValue = existing?.value ?? (shadow?.deleted ? {} : (shadow?.value ?? {}));
          const incoming = !shadow || shadow.deleted || compatibilityFieldsDiffer(currentValue, incomingRaw)
            ? serializeCompatibilityFields(incomingRaw)
            : incomingRaw;
          let desired = incoming;
          if (uiBaseProduct) {
            const uiBaseValue = productToStoredValue(uiBaseProduct);
            const uiDiff = diffJsonObjects(uiBaseValue, incoming);
            desired = applyPatch(
              currentValue,
              uiDiff.set,
              uiDiff.unset,
            );
            const conflictingFields = [
              ...Object.keys(uiDiff.set),
              ...uiDiff.unset,
            ].filter(field => (
              !jsonFieldsEqual(uiBaseValue, currentValue, field)
              && !jsonFieldsEqual(incoming, currentValue, field)
            ));
            if (conflictingFields.length > 0) {
              await syncDatabase.products.put({
                profileId: this.profile.id,
                asin,
                value: desired,
                legacyLastUpdateTime: incomingTimestamp <= previousTimestamp
                  ? previousTimestamp + 1
                  : incomingTimestamp,
                recordRevision: shadow?.recordRevision ?? existing?.recordRevision ?? 0,
                deleted: 0,
                updatedAt: createdAt,
              });
              await syncDatabase.conflicts.add({
                profileId: this.profile.id,
                mutationId: createUuid(),
                entityType: 'product',
                entityId: asin,
                baseRevision: existing?.recordRevision ?? 0,
                serverRecordRevision: shadow?.recordRevision ?? 0,
                fields: [...new Set(conflictingFields)].sort(),
                localOperation: 'patch',
                localSet: uiDiff.set,
                localUnset: uiDiff.unset,
                serverRecord: shadow && !shadow.deleted ? cloneJson(shadow.value) : null,
                createdAt,
              });
              continue;
            }
          }
          const orderedOutbox = [...existingOutbox].sort(compareOutboxOrder);
          // Mutations which may already have reached the server are immutable.
          // A later local edit is represented by one compensating mutation
          // after that uncertain prefix. Never rewrite or discard that prefix.
          const uncertain = orderedOutbox.filter(record => (
            record.state === 'sending' || record.attempts > 0
          ));
          const supersededPending = orderedOutbox.filter(record => (
            record.state === 'pending' && record.attempts === 0
          ));
          let projectedBase = shadow?.deleted
            ? {}
            : normalizeServerProductValue(
                asin,
                cloneJson(shadow?.value ?? {}),
                existing?.legacyLastUpdateTime,
              );
          for (const mutation of uncertain) {
            projectedBase = mutation.operation === 'delete'
              ? {}
              : applyPatch(projectedBase, mutation.set, mutation.unset);
          }
          const { set, unset } = diffJsonObjects(projectedBase, desired);

          const durableTimestamp = canonicalizeJson(desired) !== canonicalizeJson(existing?.value ?? {})
            && incomingTimestamp <= previousTimestamp
            ? previousTimestamp + 1
            : Math.max(incomingTimestamp, previousTimestamp);
          await syncDatabase.products.put({
            profileId: this.profile.id,
            asin,
            value: desired,
            legacyLastUpdateTime: durableTimestamp,
            recordRevision: shadow?.recordRevision ?? existing?.recordRevision ?? 0,
            deleted: 0,
            updatedAt: Date.now(),
          });
          await syncDatabase.outbox.bulkDelete(supersededPending
            .map(record => record.id)
            .filter((id): id is number => id != null));
          if (Object.keys(set).length === 0 && unset.length === 0) continue;

          const record: OutboxRecord = {
            profileId: this.profile.id,
            mutationId: createUuid(),
            clientId: this.profile.clientId,
            entityType: 'product',
            entityId: asin,
            // This is rebased again after every uncertain predecessor is
            // acknowledged. Until then its position in the durable queue is
            // what prevents it from being sent with a stale revision.
            baseRevision: shadow?.recordRevision ?? 0,
            operation: 'patch',
            set,
            unset,
            state: 'pending',
            attempts: 0,
            createdAt,
          };
          record.id = await syncDatabase.outbox.add(record);
          queued.push(record);
        }
        return queued;
      },
    );
  }

  async queueProduct(product: Product, baseProduct?: Product): Promise<OutboxRecord | null> {
    return (await this.queueProducts([product], baseProduct ? [baseProduct] : []))[0] ?? null;
  }

  async getSyncState(): Promise<SyncStateRecord> {
    return await syncDatabase.syncStates.get(this.profile.id) ?? defaultSyncState(this.profile.id);
  }

  async updateSyncState(update: Partial<SyncStateRecord>): Promise<SyncStateRecord> {
    return syncDatabase.transaction('rw', syncDatabase.syncStates, async () => {
      const current = await syncDatabase.syncStates.get(this.profile.id)
        ?? defaultSyncState(this.profile.id);
      const next = { ...current, ...update, profileId: this.profile.id };
      await syncDatabase.syncStates.put(next);
      return next;
    });
  }

  async getOutbox(): Promise<OutboxRecord[]> {
    return (await syncDatabase.outbox.where('profileId').equals(this.profile.id).toArray())
      .sort(compareOutboxOrder);
  }

  async getSendableOutbox(): Promise<OutboxRecord[]> {
    const [outbox, conflicts] = await Promise.all([
      this.getOutbox(),
      this.listConflicts(),
    ]);
    const blockedEntities = new Set(conflicts.map(conflict => (
      `${conflict.entityType}\u0000${conflict.entityId}`
    )));
    return outbox.filter(record => !blockedEntities.has(`${record.entityType}\u0000${record.entityId}`));
  }

  async queueProductsWithoutShadow(): Promise<number> {
    const products = await syncDatabase.products
      .where('[profileId+deleted]')
      .equals([this.profile.id, 0])
      .toArray();
    const alreadyQueued = new Set((await this.getOutbox())
      .filter(record => record.entityType === 'product')
      .map(record => record.entityId));
    const conflicted = new Set((await this.listConflicts())
      .filter(conflict => conflict.entityType === 'product')
      .map(conflict => conflict.entityId));
    let queued = 0;
    for (const product of products) {
      const shadow = await syncDatabase.shadows.get([
        this.profile.id,
        'product',
        product.asin,
      ]);
      if (!shadow && !alreadyQueued.has(product.asin) && !conflicted.has(product.asin)) {
        if (await this.queueProduct(storedProductToProduct(product))) queued++;
        alreadyQueued.add(product.asin);
      }
    }
    return queued;
  }

  async rebasePendingProductMutations(entityId?: string): Promise<void> {
    await syncDatabase.transaction(
      'rw',
      [syncDatabase.products, syncDatabase.shadows, syncDatabase.outbox],
      async () => {
        const allRecords = (await syncDatabase.outbox
          .where('profileId')
          .equals(this.profile.id)
          .toArray())
          .filter(record => (
            record.entityType === 'product' && (!entityId || record.entityId === entityId)
          ))
          .sort(compareOutboxOrder);
        const entityIds = [...new Set(allRecords.map(record => record.entityId))];
        for (const currentEntityId of entityIds) {
          const chain = allRecords.filter(record => record.entityId === currentEntityId);
          const mutable = chain.filter(record => (
            record.state === 'pending' && (record.attempts ?? 0) === 0
          ));
          if (mutable.length === 0) continue;
          const immutable = chain.filter(record => (
            record.state === 'sending' || (record.attempts ?? 0) > 0
          ));
          const product = await syncDatabase.products.get([this.profile.id, currentEntityId]);
          const shadow = await syncDatabase.shadows.get([
            this.profile.id,
            'product',
            currentEntityId,
          ]);
          if (!product) continue;

          let projectedValue = shadow?.deleted
            ? {}
            : normalizeServerProductValue(
                currentEntityId,
                cloneJson(shadow?.value ?? {}),
                product.legacyLastUpdateTime,
              );
          let projectedDeleted = shadow?.deleted === 1;
          for (const predecessor of immutable) {
            if (predecessor.operation === 'delete') {
              projectedValue = {};
              projectedDeleted = true;
            } else {
              projectedValue = applyPatch(
                projectedValue,
                predecessor.set,
                predecessor.unset,
              );
              projectedDeleted = false;
            }
          }

          const desiredDeleted = product.deleted === 1;
          const diff = desiredDeleted
            ? { set: {}, unset: [] as string[] }
            : diffJsonObjects(projectedDeleted ? {} : projectedValue, product.value);
          const needsMutation = desiredDeleted
            ? !projectedDeleted
            : projectedDeleted || Object.keys(diff.set).length > 0 || diff.unset.length > 0;
          const survivor = mutable[mutable.length - 1];
          const discardedIds = mutable
            .slice(0, -1)
            .map(record => record.id)
            .filter((id): id is number => id != null);
          await syncDatabase.outbox.bulkDelete(discardedIds);
          if (survivor.id == null) continue;
          if (!needsMutation) {
            await syncDatabase.outbox.delete(survivor.id);
            continue;
          }
          await syncDatabase.outbox.update(survivor.id, {
            baseRevision: shadow?.recordRevision ?? 0,
            operation: desiredDeleted ? 'delete' : 'patch',
            set: desiredDeleted ? {} : diff.set,
            unset: desiredDeleted ? [] : diff.unset,
            createdAt: Math.max(
              survivor.createdAt,
              ...immutable.map(record => record.createdAt + 1),
            ),
          });
        }
      },
    );
  }

  async markSending(record: OutboxRecord): Promise<OutboxRecord | null> {
    if (record.id == null) return null;
    return syncDatabase.transaction('rw', syncDatabase.outbox, async () => {
      const durable = await syncDatabase.outbox.get(record.id as number);
      if (!durable || durable.mutationId !== record.mutationId) return null;
      const claimed: OutboxRecord = {
        ...durable,
        state: 'sending',
        attempts: (durable.attempts ?? 0) + 1,
        lastAttemptAt: Date.now(),
        lastError: undefined,
      };
      await syncDatabase.outbox.put(claimed);
      return claimed;
    });
  }

  async markOutboxError(record: OutboxRecord, message: string): Promise<void> {
    if (record.id == null) return;
    await syncDatabase.outbox.update(record.id, { state: 'sending', lastError: message });
  }

  async prepareV1Upload(asins: string[]): Promise<{
    products: Product[];
    mutationIds: string[];
    blockedAsins: string[];
  }> {
    const targets = new Set(asins.map(canonicalizeAsin).filter((asin): asin is string => !!asin));
    return syncDatabase.transaction(
      'rw',
      [syncDatabase.products, syncDatabase.outbox, syncDatabase.conflicts],
      async () => {
      const [products, outbox, conflicts] = await Promise.all([
        syncDatabase.products.where('profileId').equals(this.profile.id).toArray(),
        syncDatabase.outbox.where('profileId').equals(this.profile.id).toArray(),
        syncDatabase.conflicts.where('profileId').equals(this.profile.id).toArray(),
      ]);
      const blockedAsins = new Set(conflicts
        .filter(conflict => (
          conflict.resolvedAt == null
          && conflict.entityType === 'product'
          && targets.has(conflict.entityId)
        ))
        .map(conflict => conflict.entityId));
      const selectedMutations = outbox.filter(mutation => (
        mutation.entityType === 'product'
        && targets.has(mutation.entityId)
        && !blockedAsins.has(mutation.entityId)
      ));
      const lastAttemptAt = Date.now();
      for (const mutation of selectedMutations) {
        if (mutation.id == null) continue;
        await syncDatabase.outbox.update(mutation.id, {
          state: 'sending',
          attempts: (mutation.attempts ?? 0) + 1,
          lastAttemptAt,
          lastError: undefined,
        });
      }
      return {
        products: products
          .filter(product => (
            !product.deleted
            && targets.has(product.asin)
            && !blockedAsins.has(product.asin)
          ))
          .map(storedProductToProduct),
        mutationIds: selectedMutations.map(mutation => mutation.mutationId),
        blockedAsins: [...blockedAsins].sort(),
      };
    });
  }

  async settleV1Products(
    sentProducts: Product[],
    mutationIds: string[],
    settlements: V1ProductSettlement[],
  ): Promise<void> {
    const sentByAsin = new Map(sentProducts.map(product => [
      canonicalizeAsin(product.ASIN),
      product,
    ]));
    const settlementByAsin = new Map(
      settlements
        .map(settlement => {
          const asin = canonicalizeAsin(settlement.asin);
          return asin ? [asin, { ...settlement, asin }] as const : null;
        })
        .filter((entry): entry is readonly [string, V1ProductSettlement] => entry != null),
    );
    const acknowledgedIds = new Set(mutationIds);
    await syncDatabase.transaction(
      'rw',
      [syncDatabase.outbox, syncDatabase.shadows, syncDatabase.products, syncDatabase.conflicts],
      async () => {
      const records = await syncDatabase.outbox.where('profileId').equals(this.profile.id).toArray();
      const settledRequestRecords = records.filter(record => (
        record.entityType === 'product'
        && acknowledgedIds.has(record.mutationId)
        && settlementByAsin.has(record.entityId)
      ));
      await syncDatabase.outbox.bulkDelete(settledRequestRecords
        .map(record => record.id)
        .filter((id): id is number => id != null));
      for (const [asin, sentProduct] of sentByAsin) {
        if (!asin) continue;
        const settlement = settlementByAsin.get(asin);
        if (!settlement) continue;
        const requestRecordsForAsin = settledRequestRecords.filter(record => record.entityId === asin);
        if (requestRecordsForAsin.length === 0) continue;
        const serverDeleted = !settlement.accepted && !settlement.serverProduct;
        const serverValue = settlement.accepted
          ? serializeCompatibilityFields(productToStoredValue(sentProduct))
          : settlement.serverProduct
            ? productToStoredValue(settlement.serverProduct)
            : {};
        await syncDatabase.shadows.put({
          profileId: this.profile.id,
          entityType: 'product',
          entityId: asin,
          value: cloneJson(serverValue),
          recordRevision: 0,
          deleted: serverDeleted ? 1 : 0,
        });
        const later = records
          .filter(record => (
            record.entityType === 'product'
            && record.entityId === asin
            && !acknowledgedIds.has(record.mutationId)
          ))
          .sort(compareOutboxOrder);
        const conflicts = (await syncDatabase.conflicts
          .where('[profileId+entityType+entityId]')
          .equals([this.profile.id, 'product', asin])
          .toArray())
          .filter(conflict => conflict.resolvedAt == null);
        for (const conflict of conflicts) {
          if (conflict.id != null) {
            await syncDatabase.conflicts.update(conflict.id, {
              serverRecord: serverDeleted ? null : cloneJson(serverValue),
              serverRecordRevision: 0,
            });
          }
        }
        const local = overlayLocalIntents(serverValue, serverDeleted, conflicts, later);
        const current = await syncDatabase.products.get([this.profile.id, asin]);
        const serverTimestamp = Number(settlement.serverProduct?.last_update_time) || 0;
        const legacyLastUpdateTime = settlement.accepted
          ? Math.max(
              Number(sentProduct.last_update_time) || 0,
              current?.legacyLastUpdateTime ?? 0,
            )
          : later.length > 0 || conflicts.length > 0
            ? Math.max(serverTimestamp, current?.legacyLastUpdateTime ?? 0)
            : serverTimestamp || current?.legacyLastUpdateTime || 0;
        await syncDatabase.products.put({
          profileId: this.profile.id,
          asin,
          value: local.value,
          legacyLastUpdateTime,
          recordRevision: 0,
          deleted: local.deleted ? 1 : 0,
          updatedAt: Date.now(),
        });
      }
    });
  }

  async acknowledgeV1Products(sentProducts: Product[], mutationIds: string[]): Promise<void> {
    await this.settleV1Products(
      sentProducts,
      mutationIds,
      sentProducts.map(product => ({
        asin: product.ASIN,
        accepted: true,
      })),
    );
  }

  async applyV1ServerProducts(serverProducts: Product[]): Promise<Product[]> {
    await syncDatabase.transaction(
      'rw',
      [
        syncDatabase.products,
        syncDatabase.shadows,
        syncDatabase.outbox,
        syncDatabase.conflicts,
        syncDatabase.syncStates,
      ],
      async () => {
        const serverAsins = new Set<string>();
        const state = await syncDatabase.syncStates.get(this.profile.id)
          ?? defaultSyncState(this.profile.id);
        const existingProductShadows = await syncDatabase.shadows
          .where('[profileId+entityType]')
          .equals([this.profile.id, 'product'])
          .count();
        // Timestamps are consulted only while importing an unclaimed legacy
        // cache. Once this transaction completes, V2 decisions are revision-
        // based and V1 has a durable shadow/outbox baseline as well.
        const legacyBootstrap = state.lastSyncAt == null
          && state.generationId == null
          && existingProductShadows === 0;
        await syncDatabase.shadows
          .where('[profileId+entityType]')
          .equals([this.profile.id, 'product'])
          .delete();
        for (const serverProduct of serverProducts) {
          const asin = canonicalizeAsin(serverProduct.ASIN);
          if (!asin) continue;
          serverAsins.add(asin);
          const entityKey: [string, SyncEntityType, string] = [this.profile.id, 'product', asin];
          const productKey: [string, string] = [this.profile.id, asin];
          const serverValue = productToStoredValue(serverProduct);
          const existing = await syncDatabase.products.get(productKey);
          let pending = (await syncDatabase.outbox
            .where('[profileId+entityType+entityId]')
            .equals(entityKey)
            .toArray())
            .sort(compareOutboxOrder);
          const conflicts = (await syncDatabase.conflicts
            .where('[profileId+entityType+entityId]')
            .equals(entityKey)
            .toArray())
            .filter(conflict => conflict.resolvedAt == null)
            .sort(compareConflictOrder);

          if (
            legacyBootstrap
            && existing
            && !existing.deleted
            && pending.length === 0
            && conflicts.length === 0
            && existing.legacyLastUpdateTime > (Number(serverProduct.last_update_time) || 0)
          ) {
            const localSet: JsonObject = {};
            Object.entries(existing.value).forEach(([key, value]) => {
              if (!jsonFieldsEqual(serverValue, existing.value, key)) {
                localSet[key] = cloneJson(value);
              }
            });
            if (Object.keys(localSet).length > 0) {
              const mutation: OutboxRecord = {
                profileId: this.profile.id,
                mutationId: createUuid(),
                clientId: this.profile.clientId,
                entityType: 'product',
                entityId: asin,
                baseRevision: 0,
                operation: 'patch',
                set: localSet,
                unset: [],
                state: 'pending',
                attempts: 0,
                createdAt: Math.max(Date.now(), existing.updatedAt + 1),
              };
              mutation.id = await syncDatabase.outbox.add(mutation);
              pending.push(mutation);
            }
          }

          if (
            conflicts.length === 0
            && existing
            && !existing.deleted
            && canonicalizeJson(existing.value) === canonicalizeJson(serverValue)
            && pending.every(mutation => (
              mutation.state === 'pending' && (mutation.attempts ?? 0) === 0
            ))
          ) {
            await syncDatabase.outbox.bulkDelete(pending
              .map(mutation => mutation.id)
              .filter((id): id is number => id != null));
            pending = [];
          }

          await syncDatabase.shadows.put({
            profileId: this.profile.id,
            entityType: 'product',
            entityId: asin,
            value: cloneJson(serverValue),
            recordRevision: 0,
            deleted: 0,
          });
          for (const conflict of conflicts) {
            if (conflict.id != null) {
              await syncDatabase.conflicts.update(conflict.id, {
                serverRecord: cloneJson(serverValue),
                serverRecordRevision: 0,
              });
            }
          }
          const local = overlayLocalIntents(serverValue, false, conflicts, pending);
          await syncDatabase.products.put({
            profileId: this.profile.id,
            asin,
            value: local.value,
            legacyLastUpdateTime: pending.length > 0 || conflicts.length > 0
              ? Math.max(
                  Number(serverProduct.last_update_time) || 0,
                  existing?.legacyLastUpdateTime ?? 0,
                )
              : Number(serverProduct.last_update_time) || 0,
            recordRevision: 0,
            deleted: local.deleted ? 1 : 0,
            updatedAt: Date.now(),
          });
        }

        const [storedProducts, allPending, allConflicts] = await Promise.all([
          syncDatabase.products.where('profileId').equals(this.profile.id).toArray(),
          syncDatabase.outbox.where('profileId').equals(this.profile.id).toArray(),
          syncDatabase.conflicts.where('profileId').equals(this.profile.id).toArray(),
        ]);
        const storedByAsin = new Map(storedProducts.map(product => [product.asin, product]));
        const missingAsins = new Set([
          ...storedByAsin.keys(),
          ...allPending
            .filter(mutation => mutation.entityType === 'product')
            .map(mutation => mutation.entityId),
          ...allConflicts
            .filter(conflict => conflict.entityType === 'product' && conflict.resolvedAt == null)
            .map(conflict => conflict.entityId),
        ]);
        for (const asin of missingAsins) {
          if (serverAsins.has(asin)) continue;
          const pending = allPending
            .filter(mutation => mutation.entityType === 'product' && mutation.entityId === asin)
            .sort(compareOutboxOrder);
          const conflicts = allConflicts
            .filter(conflict => (
              conflict.entityType === 'product'
              && conflict.entityId === asin
              && conflict.resolvedAt == null
            ))
            .sort(compareConflictOrder);
          await syncDatabase.shadows.put({
            profileId: this.profile.id,
            entityType: 'product',
            entityId: asin,
            value: {},
            recordRevision: 0,
            deleted: 1,
          });
          for (const conflict of conflicts) {
            if (conflict.id != null) {
              await syncDatabase.conflicts.update(conflict.id, {
                serverRecord: null,
                serverRecordRevision: 0,
              });
            }
          }
          const current = storedByAsin.get(asin);
          if (
            legacyBootstrap
            && current
            && !current.deleted
            && pending.length === 0
            && conflicts.length === 0
          ) {
            const mutation: OutboxRecord = {
              profileId: this.profile.id,
              mutationId: createUuid(),
              clientId: this.profile.clientId,
              entityType: 'product',
              entityId: asin,
              baseRevision: 0,
              operation: 'patch',
              set: cloneJson(current.value),
              unset: [],
              state: 'pending',
              attempts: 0,
              createdAt: Math.max(Date.now(), current.updatedAt + 1),
            };
            mutation.id = await syncDatabase.outbox.add(mutation);
            pending.push(mutation);
          }
          const local = current
            ? { value: cloneJson(current.value), deleted: current.deleted === 1 }
            : overlayLocalIntents({}, true, conflicts, pending);
          if (pending.length === 0 && conflicts.length === 0) {
            if (current) {
              await syncDatabase.products.put({
                ...current,
                recordRevision: 0,
                deleted: 1,
                updatedAt: Date.now(),
              });
            }
          } else if (current || !local.deleted) {
            await syncDatabase.products.put({
              profileId: this.profile.id,
              asin,
              value: local.value,
              legacyLastUpdateTime: current?.legacyLastUpdateTime ?? 0,
              recordRevision: 0,
              deleted: local.deleted ? 1 : 0,
              updatedAt: Date.now(),
            });
          }
        }
        await syncDatabase.syncStates.put({
          ...state,
          profileId: this.profile.id,
          protocol: 'v1',
          lastSyncAt: Date.now(),
          lastError: null,
        });
      },
    );
    return this.getProducts();
  }

  async acknowledgeMutation(
    record: OutboxRecord,
    revision: number,
    serverData?: JsonObject | null,
  ): Promise<void> {
    await syncDatabase.transaction(
      'rw',
      [syncDatabase.outbox, syncDatabase.products, syncDatabase.shadows],
      async () => {
        if (record.id == null) return;
        const durable = await syncDatabase.outbox.get(record.id);
        if (!durable || durable.mutationId !== record.mutationId) return;
        await syncDatabase.outbox.delete(record.id);
        const key: [string, SyncEntityType, string] = [this.profile.id, record.entityType, record.entityId];
        const shadow = await syncDatabase.shadows.get(key);
        if (shadow && revision <= shadow.recordRevision) {
          if (record.entityType === 'product') await this.rebuildProductFromShadow(record.entityId);
          return;
        }
        const value = record.operation === 'delete'
          ? {}
          : serverData != null
            ? cloneJson(serverData)
            : applyPatch(shadow?.value ?? {}, record.set, record.unset);
        await syncDatabase.shadows.put({
          profileId: this.profile.id,
          entityType: record.entityType,
          entityId: record.entityId,
          value,
          recordRevision: revision,
          deleted: record.operation === 'delete' ? 1 : 0,
        });
        if (record.entityType === 'product') {
          const product = await syncDatabase.products.get([this.profile.id, record.entityId]);
          if (product) {
            product.recordRevision = revision;
            product.deleted = record.operation === 'delete' ? 1 : 0;
            await syncDatabase.products.put(product);
          }
          await this.rebuildProductFromShadow(record.entityId);
        }
      },
    );
  }

  async recordConflict(
    outbox: OutboxRecord,
    serverRecordRevision: number,
    fields: string[],
    serverRecord: JsonObject | null,
  ): Promise<void> {
    await syncDatabase.transaction(
      'rw',
      [syncDatabase.outbox, syncDatabase.conflicts, syncDatabase.products],
      async () => {
      if (outbox.id != null) await syncDatabase.outbox.delete(outbox.id);
      const currentProduct = outbox.entityType === 'product' && serverRecord == null
        ? await syncDatabase.products.get([this.profile.id, outbox.entityId])
        : undefined;
      const preserveCompleteDeletedProduct = outbox.operation === 'patch'
        && currentProduct != null
        && currentProduct.deleted === 0;
      const localSet = preserveCompleteDeletedProduct
        ? cloneJson(currentProduct.value)
        : outbox.set;
      const localUnset = preserveCompleteDeletedProduct ? [] : outbox.unset;
      await syncDatabase.conflicts.add({
        profileId: this.profile.id,
        mutationId: outbox.mutationId,
        entityType: outbox.entityType,
        entityId: outbox.entityId,
        baseRevision: outbox.baseRevision,
        serverRecordRevision,
        fields: preserveCompleteDeletedProduct ? Object.keys(localSet).sort() : fields,
        localOperation: outbox.operation,
        localSet,
        localUnset,
        serverRecord,
        createdAt: outbox.createdAt,
      });
    });
  }

  async countConflicts(): Promise<number> {
    return syncDatabase.conflicts
      .where('profileId')
      .equals(this.profile.id)
      .filter(conflict => conflict.resolvedAt == null)
      .count();
  }

  async listConflicts(): Promise<ConflictRecord[]> {
    return (await syncDatabase.conflicts
      .where('profileId')
      .equals(this.profile.id)
      .filter(conflict => conflict.resolvedAt == null)
      .toArray())
      .sort(compareConflictOrder);
  }

  async resolveConflict(
    conflictId: number,
    resolution: 'server' | 'local',
  ): Promise<void> {
    const conflict = await syncDatabase.conflicts.get(conflictId);
    if (!conflict || conflict.profileId !== this.profile.id || conflict.resolvedAt != null) {
      throw new Error('Der Synchronisationskonflikt existiert nicht mehr.');
    }

    await syncDatabase.transaction(
      'rw',
      [syncDatabase.conflicts, syncDatabase.outbox, syncDatabase.shadows, syncDatabase.products],
      async () => {
        const selectedConflict = await syncDatabase.conflicts.get(conflictId);
        if (
          !selectedConflict
          || selectedConflict.profileId !== this.profile.id
          || selectedConflict.resolvedAt != null
        ) {
          throw new Error('Der Synchronisationskonflikt existiert nicht mehr.');
        }
        const entityKey: [string, SyncEntityType, string] = [
          this.profile.id,
          selectedConflict.entityType,
          selectedConflict.entityId,
        ];
        const relatedOutbox = await syncDatabase.outbox
          .where('[profileId+entityType+entityId]')
          .equals(entityKey)
          .toArray()
          .then(records => records.sort(compareOutboxOrder));
        const relatedConflicts = (await syncDatabase.conflicts
          .where('[profileId+entityType+entityId]')
          .equals(entityKey)
          .toArray())
          .filter(related => related.resolvedAt == null)
          .sort(compareConflictOrder);
        await syncDatabase.outbox.bulkDelete(relatedOutbox
          .map(record => record.id)
          .filter((id): id is number => id != null));

        const latestServer = [...relatedConflicts].sort((left, right) => (
          right.serverRecordRevision - left.serverRecordRevision
          || right.createdAt - left.createdAt
          || (right.id ?? 0) - (left.id ?? 0)
        ))[0] ?? selectedConflict;
        const serverRevision = latestServer.serverRecordRevision;
        const serverDeleted = latestServer.serverRecord == null;
        const serverValue = serverDeleted
          ? {}
          : cloneJson(latestServer.serverRecord as JsonObject);
        await syncDatabase.shadows.put({
          profileId: this.profile.id,
          entityType: selectedConflict.entityType,
          entityId: selectedConflict.entityId,
          value: serverValue,
          recordRevision: serverRevision,
          deleted: serverDeleted ? 1 : 0,
        });

        const compatibleServerValue = selectedConflict.entityType === 'product' && !serverDeleted
          ? normalizeServerProductValue(selectedConflict.entityId, serverValue)
          : serverValue;
        const local = overlayLocalIntents(
          compatibleServerValue,
          serverDeleted,
          relatedConflicts,
          relatedOutbox,
        );
        if (resolution === 'local') {
          const set: JsonObject = {};
          const unset: string[] = [];
          if (!local.deleted) {
            Object.entries(local.value).forEach(([key, value]) => {
              if (JSON.stringify(compatibleServerValue[key]) !== JSON.stringify(value)) {
                set[key] = cloneJson(value);
              }
            });
            Object.keys(compatibleServerValue).forEach(key => {
              if (!Object.prototype.hasOwnProperty.call(local.value, key)) unset.push(key);
            });
          }
          const needsMutation = local.deleted
            ? !serverDeleted
            : serverDeleted || Object.keys(set).length > 0 || unset.length > 0;
          if (needsMutation) {
            const createdAt = Math.max(
              Date.now(),
              ...relatedOutbox.map(record => record.createdAt + 1),
              ...relatedConflicts.map(related => related.createdAt + 1),
            );
            await syncDatabase.outbox.add({
              profileId: this.profile.id,
              mutationId: createUuid(),
              clientId: this.profile.clientId,
              entityType: selectedConflict.entityType,
              entityId: selectedConflict.entityId,
              baseRevision: serverRevision,
              operation: local.deleted ? 'delete' : 'patch',
              set: local.deleted ? {} : set,
              unset: local.deleted ? [] : unset,
              state: 'pending',
              attempts: 0,
              createdAt,
            });
          }
        }

        if (selectedConflict.entityType === 'product') {
          const productKey: [string, string] = [this.profile.id, selectedConflict.entityId];
          const current = await syncDatabase.products.get(productKey);
          if (resolution === 'server') {
            if (serverDeleted) {
              if (current) {
                await syncDatabase.products.put({
                  ...current,
                  recordRevision: serverRevision,
                  deleted: 1,
                  updatedAt: Date.now(),
                });
              }
            } else {
              await syncDatabase.products.put({
                profileId: this.profile.id,
                asin: selectedConflict.entityId,
                value: compatibleServerValue,
                legacyLastUpdateTime: current?.legacyLastUpdateTime ?? 0,
                recordRevision: serverRevision,
                deleted: 0,
                updatedAt: Date.now(),
              });
            }
          } else {
            if (current || !local.deleted) {
              await syncDatabase.products.put({
                profileId: this.profile.id,
                asin: selectedConflict.entityId,
                value: local.value,
                legacyLastUpdateTime: current?.legacyLastUpdateTime ?? 0,
                recordRevision: serverRevision,
                deleted: local.deleted ? 1 : 0,
                updatedAt: Date.now(),
              });
            }
          }
        }

        const resolvedAt = Date.now();
        for (const related of relatedConflicts) {
          if (related.id != null && related.resolvedAt == null) {
            await syncDatabase.conflicts.update(related.id, { resolvedAt, resolution });
          }
        }
      },
    );
  }

  async applyChange(change: V2Change): Promise<void> {
    if (change.operation === 'dataset_reset' || change.entity_type === '__dataset__') {
      throw new Error('Dataset-Reset muss durch einen neuen Snapshot verarbeitet werden.');
    }
    const entityType: SyncEntityType = change.entity_type;
    const revision = change.record_revision ?? change.revision;
    const key: [string, SyncEntityType, string] = [this.profile.id, entityType, change.entity_id];
    await syncDatabase.transaction(
      'rw',
      [syncDatabase.shadows, syncDatabase.products, syncDatabase.outbox, syncDatabase.conflicts],
      async () => {
        const existing = await syncDatabase.shadows.get(key);
        if (existing && revision <= existing.recordRevision) return;
        const serverDeleted = change.operation === 'delete';
        const value = serverDeleted
          ? {}
          : change.data
            ?? change.record
            ?? applyPatch(existing?.value ?? {}, change.set ?? {}, change.unset ?? []);
        await syncDatabase.shadows.put({
          profileId: this.profile.id,
          entityType,
          entityId: change.entity_id,
          value: cloneJson(value),
          recordRevision: revision,
          deleted: serverDeleted ? 1 : 0,
        });

        let openConflicts = (await syncDatabase.conflicts
          .where('[profileId+entityType+entityId]')
          .equals(key)
          .toArray())
          .filter(conflict => conflict.resolvedAt == null)
          .sort(compareConflictOrder);
        let pending = entityType === 'product'
          ? (await syncDatabase.outbox
              .where('[profileId+entityType+entityId]')
              .equals(key)
              .toArray())
              .sort(compareOutboxOrder)
          : [];
        const current = entityType === 'product'
          ? await syncDatabase.products.get([this.profile.id, change.entity_id])
          : undefined;

        if (entityType === 'product' && serverDeleted && pending.length > 0) {
          const first = pending[0];
          const last = pending[pending.length - 1];
          if (last.operation === 'patch' && current && !current.deleted) {
            const localSet = cloneJson(current.value);
            const quarantined: ConflictRecord = {
              profileId: this.profile.id,
              mutationId: first.mutationId,
              entityType: 'product',
              entityId: change.entity_id,
              baseRevision: first.baseRevision,
              serverRecordRevision: revision,
              fields: Object.keys(localSet).sort(),
              localOperation: 'patch',
              localSet,
              localUnset: [],
              serverRecord: null,
              createdAt: last.createdAt,
            };
            quarantined.id = await syncDatabase.conflicts.add(quarantined);
            openConflicts.push(quarantined);
          }
          await syncDatabase.outbox.bulkDelete(pending
            .map(record => record.id)
            .filter((id): id is number => id != null));
          pending = [];
        }

        if (entityType === 'product' && serverDeleted && current && !current.deleted && openConflicts.length > 0) {
          const latestConflict = [...openConflicts].sort((left, right) => (
            right.createdAt - left.createdAt || (right.id ?? 0) - (left.id ?? 0)
          ))[0];
          latestConflict.localOperation = 'patch';
          latestConflict.localSet = cloneJson(current.value);
          latestConflict.localUnset = [];
          latestConflict.fields = Object.keys(current.value).sort();
          if (latestConflict.id != null) {
            await syncDatabase.conflicts.update(latestConflict.id, {
              localOperation: 'patch',
              localSet: latestConflict.localSet,
              localUnset: [],
              fields: latestConflict.fields,
            });
          }
        }
        for (const conflict of openConflicts) {
          if (conflict.id == null) continue;
          await syncDatabase.conflicts.update(conflict.id, {
            serverRecordRevision: revision,
            serverRecord: serverDeleted ? null : cloneJson(value),
          });
        }

        if (entityType === 'product' && openConflicts.length > 0) {
          const compatibleServerValue = serverDeleted
            ? {}
            : normalizeServerProductValue(
                change.entity_id,
                value,
                change.legacy_last_update_time,
              );
          const local = overlayLocalIntents(
            compatibleServerValue,
            serverDeleted,
            openConflicts,
            pending,
          );
          if (current || !local.deleted) {
            await syncDatabase.products.put({
              profileId: this.profile.id,
              asin: change.entity_id,
              value: local.value,
              legacyLastUpdateTime: change.legacy_last_update_time
                ?? current?.legacyLastUpdateTime
                ?? 0,
              recordRevision: revision,
              deleted: local.deleted ? 1 : 0,
              updatedAt: Date.now(),
            });
          }
        } else if (entityType === 'product') {
          await this.rebuildProductFromShadow(change.entity_id, change.legacy_last_update_time);
        }
      },
    );
  }

  async replaceSnapshot(
    records: V2SnapshotRecord[],
    quarantineOutboxForGenerationReset = false,
    preserveLegacyBootstrapIntent = false,
  ): Promise<void> {
    const shadows: ShadowRecord[] = records.map(record => ({
      profileId: this.profile.id,
      entityType: record.entity_type,
      entityId: record.entity_id,
      value: cloneJson(record.data ?? record.record ?? record.value ?? {}),
      recordRevision: record.record_revision,
      deleted: 0,
    }));
    const productRecords = records.filter(record => record.entity_type === 'product');
    const snapshotProducts = new Map(productRecords.map(record => [record.entity_id, record]));
    await syncDatabase.transaction(
      'rw',
      [syncDatabase.shadows, syncDatabase.products, syncDatabase.outbox, syncDatabase.conflicts],
      async () => {
      const initialProducts = await syncDatabase.products
        .where('profileId')
        .equals(this.profile.id)
        .toArray();
      const initialConflicts = (await syncDatabase.conflicts
        .where('profileId')
        .equals(this.profile.id)
        .toArray())
        .filter(conflict => conflict.resolvedAt == null);
      let queued = (await syncDatabase.outbox
        .where('profileId')
        .equals(this.profile.id)
        .toArray())
        .sort(compareOutboxOrder);

      if (preserveLegacyBootstrapIntent) {
        const explicitEntities = new Set([
          ...queued.map(record => `${record.entityType}\u0000${record.entityId}`),
          ...initialConflicts.map(conflict => `${conflict.entityType}\u0000${conflict.entityId}`),
        ]);
        for (const current of initialProducts) {
          if (current.deleted || explicitEntities.has(`product\u0000${current.asin}`)) continue;
          const snapshot = snapshotProducts.get(current.asin);
          const serverTimestamp = Number(snapshot?.legacy_last_update_time) || 0;
          const preserveLocal = !snapshot || current.legacyLastUpdateTime > serverTimestamp;
          if (!preserveLocal) continue;
          const rawServerValue = cloneJson(snapshot?.data ?? snapshot?.record ?? snapshot?.value ?? {});
          const serverValue = snapshot
            ? normalizeServerProductValue(
                current.asin,
                rawServerValue,
                snapshot.legacy_last_update_time,
              )
            : {};
          const set: JsonObject = {};
          // A legacy cache has no common field-level base. Treat its present
          // fields as intent, but do not infer deletion of unknown server fields.
          Object.entries(current.value).forEach(([key, value]) => {
            if (!jsonFieldsEqual(serverValue, current.value, key)) set[key] = cloneJson(value);
          });
          if (Object.keys(set).length === 0) continue;
          const mutation: OutboxRecord = {
            profileId: this.profile.id,
            mutationId: createUuid(),
            clientId: this.profile.clientId,
            entityType: 'product',
            entityId: current.asin,
            baseRevision: snapshot?.record_revision ?? 0,
            operation: 'patch',
            set,
            unset: [],
            state: 'pending',
            attempts: 0,
            createdAt: Math.max(Date.now(), current.updatedAt + 1),
          };
          mutation.id = await syncDatabase.outbox.add(mutation);
          queued.push(mutation);
        }
        queued = queued.sort(compareOutboxOrder);
      }
      const grouped = new Map<string, OutboxRecord[]>();
      queued.forEach(mutation => {
        const key = `${mutation.entityType}\u0000${mutation.entityId}`;
        const entries = grouped.get(key) ?? [];
        entries.push(mutation);
        grouped.set(key, entries);
      });
      const quarantinedIds: number[] = [];
      for (const mutations of grouped.values()) {
        const first = mutations[0];
        const snapshot = records.find(record => (
          record.entity_type === first.entityType && record.entity_id === first.entityId
        ));
        const lostExistingServerRecord = !snapshot
          && mutations.some(mutation => mutation.baseRevision > 0);
        if (!quarantineOutboxForGenerationReset && !lostExistingServerRecord) continue;

        const serverRecord = snapshot
          ? cloneJson(snapshot.data ?? snapshot.record ?? snapshot.value ?? {})
          : null;
        const serverBase = snapshot && first.entityType === 'product'
          ? normalizeServerProductValue(
              first.entityId,
              serverRecord ?? {},
              snapshot.legacy_last_update_time,
            )
          : serverRecord ?? {};
        let desired = cloneJson(serverBase);
        let localOperation: 'patch' | 'delete' = 'patch';
        const lastMutation = mutations[mutations.length - 1];
        const currentProduct = !snapshot && first.entityType === 'product'
          ? await syncDatabase.products.get([this.profile.id, first.entityId])
          : undefined;
        if (currentProduct && !currentProduct.deleted && lastMutation.operation === 'patch') {
          desired = cloneJson(currentProduct.value);
        } else {
          for (const mutation of mutations) {
            if (mutation.operation === 'delete') {
              desired = {};
              localOperation = 'delete';
            } else {
              desired = applyPatch(desired, mutation.set, mutation.unset);
              localOperation = 'patch';
            }
          }
        }
        const localSet: JsonObject = {};
        const localUnset: string[] = [];
        if (localOperation === 'patch') {
          Object.entries(desired).forEach(([key, value]) => {
            if (JSON.stringify(serverBase[key]) !== JSON.stringify(value)) {
              localSet[key] = cloneJson(value);
            }
          });
          Object.keys(serverBase).forEach(key => {
            if (!Object.prototype.hasOwnProperty.call(desired, key)) localUnset.push(key);
          });
        }
        await syncDatabase.conflicts.add({
          profileId: this.profile.id,
          mutationId: first.mutationId,
          entityType: first.entityType,
          entityId: first.entityId,
          baseRevision: first.baseRevision,
          serverRecordRevision: snapshot?.record_revision ?? 0,
          fields: localOperation === 'delete'
            ? ['__delete__']
            : [...new Set([...Object.keys(localSet), ...localUnset])],
          localOperation,
          localSet,
          localUnset,
          serverRecord,
          createdAt: lastMutation.createdAt,
        });
        quarantinedIds.push(...mutations
          .map(record => record.id)
          .filter((id): id is number => id != null));
      }
      await syncDatabase.outbox.bulkDelete(quarantinedIds);

      const openConflicts = (await syncDatabase.conflicts
        .where('profileId')
        .equals(this.profile.id)
        .toArray())
        .filter(conflict => conflict.resolvedAt == null);
      const productConflictsByAsin = new Map<string, ConflictRecord[]>();
      for (const conflict of openConflicts) {
        const snapshot = records.find(record => (
          record.entity_type === conflict.entityType && record.entity_id === conflict.entityId
        ));
        const serverRecord = snapshot
          ? cloneJson(snapshot.data ?? snapshot.record ?? snapshot.value ?? {})
          : null;
        const serverRecordRevision = snapshot?.record_revision ?? 0;
        if (conflict.id != null) {
          await syncDatabase.conflicts.update(conflict.id, {
            serverRecord,
            serverRecordRevision,
          });
        }
        conflict.serverRecord = serverRecord;
        conflict.serverRecordRevision = serverRecordRevision;
        if (conflict.entityType === 'product') {
          const entries = productConflictsByAsin.get(conflict.entityId) ?? [];
          entries.push(conflict);
          productConflictsByAsin.set(conflict.entityId, entries);
        }
      }

      await syncDatabase.shadows.where('profileId').equals(this.profile.id).delete();
      await syncDatabase.shadows.bulkPut(shadows);

      const existing = initialProducts;
      const existingByAsin = new Map(existing.map(record => [record.asin, record]));
      const pending = (await syncDatabase.outbox
        .where('profileId')
        .equals(this.profile.id)
        .toArray())
        .sort(compareOutboxOrder);
      const pendingByAsin = new Map<string, OutboxRecord[]>();
      pending.filter(record => record.entityType === 'product').forEach(record => {
        const entries = pendingByAsin.get(record.entityId) ?? [];
        entries.push(record);
        pendingByAsin.set(record.entityId, entries);
      });
      const allAsins = new Set([
        ...existingByAsin.keys(),
        ...snapshotProducts.keys(),
        ...pendingByAsin.keys(),
        ...productConflictsByAsin.keys(),
      ]);

      for (const asin of allAsins) {
        const snapshot = snapshotProducts.get(asin);
        const current = existingByAsin.get(asin);
        const localMutations = pendingByAsin.get(asin) ?? [];
        const conflicts = productConflictsByAsin.get(asin) ?? [];
        if (conflicts.length > 0) {
          const rawServerValue = cloneJson(snapshot?.data ?? snapshot?.record ?? snapshot?.value ?? {});
          const serverValue = normalizeServerProductValue(
            asin,
            rawServerValue,
            snapshot?.legacy_last_update_time,
          );
          const local = overlayLocalIntents(serverValue, !snapshot, conflicts, localMutations);
          if (current || !local.deleted) {
            await syncDatabase.products.put({
              profileId: this.profile.id,
              asin,
              value: local.value,
              legacyLastUpdateTime: Math.max(
                snapshot?.legacy_last_update_time ?? 0,
                current?.legacyLastUpdateTime ?? 0,
              ),
              recordRevision: snapshot?.record_revision
                ?? conflicts[0].serverRecordRevision
                ?? current?.recordRevision
                ?? 0,
              deleted: local.deleted ? 1 : 0,
              updatedAt: Date.now(),
            });
          }
          continue;
        }
        if (!snapshot && localMutations.length === 0) {
          if (current) {
            current.deleted = 1;
            current.recordRevision = 0;
            await syncDatabase.products.put(current);
          }
          continue;
        }

        let value = snapshot
          ? normalizeServerProductValue(
              asin,
              cloneJson(snapshot.data ?? snapshot.record ?? snapshot.value ?? {}),
              snapshot.legacy_last_update_time,
            )
          : {};
        let deleted: 0 | 1 = snapshot ? 0 : 1;
        localMutations.forEach(mutation => {
          if (mutation.operation === 'delete') {
            value = {};
            deleted = 1;
          } else {
            value = applyPatch(value, mutation.set, mutation.unset);
            deleted = 0;
          }
        });
        await syncDatabase.products.put({
          profileId: this.profile.id,
          asin,
          value,
          legacyLastUpdateTime: localMutations.length > 0
            ? Math.max(
                snapshot?.legacy_last_update_time ?? 0,
                current?.legacyLastUpdateTime ?? 0,
              )
            : snapshot?.legacy_last_update_time ?? current?.legacyLastUpdateTime ?? 0,
          recordRevision: snapshot?.record_revision ?? 0,
          deleted,
          updatedAt: Date.now(),
        });
      }
    });
  }

  async getCanonicalShadowRecords(): Promise<Array<{
    entity_type: string;
    entity_id: string;
    data: JsonObject;
  }>> {
    return (await syncDatabase.shadows.where('profileId').equals(this.profile.id).toArray())
      .filter(record => !record.deleted)
      .map(record => ({
        entity_type: record.entityType,
        entity_id: record.entityId,
        data: cloneJson(record.value),
      }));
  }

  private async rebuildProductFromShadow(asin: string, legacyTimestamp?: number): Promise<void> {
    const key: [string, SyncEntityType, string] = [this.profile.id, 'product', asin];
    const shadow = await syncDatabase.shadows.get(key);
    const pending = (await this.getOutbox()).filter(
      record => record.entityType === 'product' && record.entityId === asin,
    );
    const current = await syncDatabase.products.get([this.profile.id, asin]);
    if ((!shadow || shadow.deleted) && pending.length === 0) {
      if (current) {
        current.deleted = 1;
        current.recordRevision = shadow?.recordRevision ?? current.recordRevision;
        await syncDatabase.products.put(current);
      }
      return;
    }
    let value = shadow && !shadow.deleted
      ? normalizeServerProductValue(
          asin,
          cloneJson(shadow.value),
          legacyTimestamp ?? current?.legacyLastUpdateTime,
        )
      : {};
    let deleted = shadow?.deleted ?? 0;
    pending.forEach(record => {
      if (record.operation === 'delete') {
        value = {};
        deleted = 1;
      } else {
        value = applyPatch(value, record.set, record.unset);
        deleted = 0;
      }
    });
    await syncDatabase.products.put({
      profileId: this.profile.id,
      asin,
      value,
      legacyLastUpdateTime: legacyTimestamp ?? current?.legacyLastUpdateTime ?? 0,
      recordRevision: shadow?.recordRevision ?? 0,
      deleted,
      updatedAt: Date.now(),
    });
  }
}

export const applyPatch = (base: JsonObject, set: JsonObject, unset: string[]): JsonObject => {
  const result = cloneJson(base);
  Object.entries(set).forEach(([key, value]) => { result[key] = cloneJson(value); });
  unset.forEach(key => { delete result[key]; });
  return result;
};

export const openProductRepository = async (
  baseUrl: string,
  token: string | null,
): Promise<ProductSyncRepository> => new ProductSyncRepository(await ensureSyncProfile(baseUrl, token));

export const clearAllSyncData = async (): Promise<void> => {
  const tables = [
    syncDatabase.products,
    syncDatabase.shadows,
    syncDatabase.outbox,
    syncDatabase.conflicts,
    syncDatabase.syncStates,
    syncDatabase.profiles,
  ];
  await syncDatabase.transaction('rw', tables, async () => {
    for (const table of tables) await table.clear();
  });
};

export const resetSyncDatabaseForTests = async (): Promise<void> => {
  syncDatabase.close();
  await Dexie.delete('vine-product-manager-sync');
  await syncDatabase.open();
};
