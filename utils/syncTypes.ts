export type JsonObject = Record<string, unknown>;

export type SyncEntityType = 'product' | 'storage_location' | 'procedure_doc';
export type SyncProtocol = 'v1' | 'v2';

export interface SyncProfile {
  id: string;
  clientId: string;
  baseUrl: string;
  tokenFingerprint: string | null;
  localOnly: boolean;
  createdAt: number;
  lastUsedAt: number;
  localSeedClaimedBy?: string;
}

export interface StoredProductRecord {
  profileId: string;
  asin: string;
  value: JsonObject;
  legacyLastUpdateTime: number;
  recordRevision: number;
  deleted: 0 | 1;
  updatedAt: number;
}

export interface ShadowRecord {
  profileId: string;
  entityType: SyncEntityType;
  entityId: string;
  value: JsonObject;
  recordRevision: number;
  deleted: 0 | 1;
}

export interface OutboxRecord {
  id?: number;
  profileId: string;
  mutationId: string;
  clientId: string;
  entityType: SyncEntityType;
  entityId: string;
  baseRevision: number;
  operation: 'patch' | 'delete';
  set: JsonObject;
  unset: string[];
  state: 'pending' | 'sending';
  attempts: number;
  createdAt: number;
  lastAttemptAt?: number;
  lastError?: string;
}

export interface ConflictRecord {
  id?: number;
  profileId: string;
  mutationId: string;
  entityType: SyncEntityType;
  entityId: string;
  baseRevision: number;
  serverRecordRevision: number;
  fields: string[];
  localOperation?: 'patch' | 'delete';
  localSet: JsonObject;
  localUnset: string[];
  serverRecord: JsonObject | null;
  createdAt: number;
  resolvedAt?: number;
  resolution?: 'server' | 'local';
}

export interface SyncStateRecord {
  profileId: string;
  protocol: SyncProtocol;
  generationId: string | null;
  serverInstanceId: string | null;
  cursor: number;
  minAvailableRevision: number;
  datasetHash: string | null;
  capabilityCheckedAt: number | null;
  capabilityClientVersion?: string | null;
  lastSyncAt: number | null;
  lastError: string | null;
  snapshotRequired: boolean;
  capabilities?: V2Capabilities | null;
  lastIntegritySnapshotAt?: number | null;
  serverRepairRequired?: boolean;
}

export interface V2Capabilities {
  protocol_version: 2;
  sync_core_version: string;
  canonicalization: string;
  generation_id: string;
  server_instance_id?: string;
  current_revision: number;
  min_available_revision: number;
  entity_types: SyncEntityType[];
  limits?: {
    push_mutations?: number;
    pull_changes?: number;
    snapshot_records?: number;
    // Accepted for compatibility with early V2 development servers.
    max_mutations?: number;
    max_pull_limit?: number;
    max_snapshot_limit?: number;
  };
  dataset_hash?: string;
  features?: {
    push_pull_exchange?: boolean;
    on_demand_pull_hash?: boolean;
    authoritative_status_fields?: boolean;
    product_last_write_wins?: boolean;
    product_intent_age_lww?: boolean;
    product_delete_supported?: boolean;
  };
}

export interface V2Mutation {
  mutation_id: string;
  client_id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  base_revision: number;
  operation: 'patch' | 'delete';
  intent_age_ms?: number;
  set?: JsonObject;
  unset?: string[];
  authoritative_fields?: string[];
}

export interface V2MutationResult {
  mutation_id: string;
  status: 'applied' | 'noop' | 'conflict';
  revision?: number;
  record_revision?: number;
  data?: JsonObject | null;
  conflicting_fields?: string[];
  fields?: string[];
  record?: JsonObject | null;
  conflict?: {
    fields: string[] | Record<string, unknown>;
    server_revision: number | null;
    server_data: JsonObject | null;
  };
  message?: string;
}

export interface V2PushData {
  generation_id: string;
  current_revision: number;
  results: V2MutationResult[];
  dataset_hash?: string | null;
  changes?: V2Change[];
  next_cursor?: number;
  min_available_revision?: number;
  has_more?: boolean;
}

export interface V2Change {
  revision: number;
  entity_type: SyncEntityType | '__dataset__';
  entity_id: string;
  operation: 'patch' | 'upsert' | 'delete' | 'dataset_reset';
  set?: JsonObject;
  unset?: string[];
  data?: JsonObject | null;
  record?: JsonObject | null;
  record_revision?: number;
  legacy_last_update_time?: number;
}

export interface V2PullData {
  generation_id: string;
  changes: V2Change[];
  next_cursor: number;
  current_revision: number;
  min_available_revision: number;
  has_more: boolean;
  dataset_hash: string | null;
}

export interface V2SnapshotRecord {
  entity_type: SyncEntityType;
  entity_id: string;
  record_revision: number;
  legacy_last_update_time?: number;
  record?: JsonObject;
  value?: JsonObject;
  data?: JsonObject;
}

export interface V2SnapshotData {
  session_id: string;
  generation_id: string;
  snapshot_revision: number;
  records: V2SnapshotRecord[];
  next_offset: number | null;
  has_more: boolean;
  dataset_hash: string;
}

export interface DataOperationResponse<T = unknown> {
  status: 'success' | 'error';
  message?: string;
  code?: string;
  data?: T;
  snapshot_required?: boolean;
  inserted?: number;
  updated?: number;
  skipped?: number;
}

export interface SyncRunResult {
  protocol: SyncProtocol;
  products: import('../types').Product[];
  warning?: string;
  conflicts: number;
  pushed: number;
  pulled: number;
}
