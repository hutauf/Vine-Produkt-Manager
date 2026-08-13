import {
  DataOperationResponse,
  V2Capabilities,
  V2Mutation,
  V2PullData,
  V2PushData,
  V2SnapshotData,
} from './syncTypes';

export class SyncProtocolError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code?: string,
    readonly snapshotRequired = false,
  ) {
    super(message);
    this.name = 'SyncProtocolError';
  }
}

interface OperationEnvelope {
  token: string;
  request: string;
  payload?: unknown;
}

const operationRequest = async <T extends object>(
  baseUrl: string,
  body: OperationEnvelope,
): Promise<T & DataOperationResponse> => {
  let response: Response;
  try {
    response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': '69420',
      },
      body: JSON.stringify(body),
      mode: 'cors',
    });
  } catch (error) {
    throw new SyncProtocolError(
      `Netzwerkfehler: ${error instanceof Error ? error.message : String(error)}`,
      0,
    );
  }

  let decoded: DataOperationResponse & Record<string, unknown>;
  try {
    decoded = await response.json() as DataOperationResponse & Record<string, unknown>;
  } catch {
    throw new SyncProtocolError(
      `Serverantwort ist kein JSON (HTTP ${response.status}).`,
      response.status,
    );
  }
  if (!response.ok || decoded.status !== 'success') {
    throw new SyncProtocolError(
      decoded.message || `API-Fehler HTTP ${response.status}.`,
      response.status,
      typeof decoded.code === 'string' ? decoded.code : undefined,
      decoded.snapshot_required === true,
    );
  }
  const nested = decoded.data && typeof decoded.data === 'object' && !Array.isArray(decoded.data)
    ? decoded.data as Record<string, unknown>
    : {};
  return { ...decoded, ...nested } as T & DataOperationResponse;
};

const isLegacyCapabilityMiss = (error: unknown): boolean => (
  error instanceof SyncProtocolError
  && error.statusCode === 400
  && /unknown request type/i.test(error.message)
);

export const detectV2Capabilities = async (
  baseUrl: string,
  token: string,
  clientVersion: string,
): Promise<V2Capabilities | null> => {
  try {
    const response = await operationRequest<V2Capabilities>(baseUrl, {
      token,
      request: 'get_capabilities_v2',
      payload: {
        client: { name: 'Vine-Produkt-Manager', version: clientVersion },
        supported_protocols: [2, 1],
      },
    });
    if (response.protocol_version !== 2 || typeof response.generation_id !== 'string') {
      throw new SyncProtocolError('Server meldet eine ungültige V2-Capability.', 200);
    }
    return response;
  } catch (error) {
    if (isLegacyCapabilityMiss(error)) return null;
    throw error;
  }
};

export const pushV2Mutations = async (
  baseUrl: string,
  token: string,
  generationId: string,
  clientId: string,
  mutations: V2Mutation[],
  exchange?: {
    pullSince: number;
    pullLimit?: number;
    entityTypes?: Array<'product' | 'storage_location' | 'procedure_doc'>;
  },
): Promise<V2PushData> => operationRequest<V2PushData>(baseUrl, {
  token,
  request: 'sync_v2_push',
  payload: {
    generation_id: generationId,
    client_id: clientId,
    mutations,
    ...(exchange ? {
      pull_since: exchange.pullSince,
      ...(exchange.pullLimit != null ? { pull_limit: exchange.pullLimit } : {}),
      ...(exchange.entityTypes ? { entity_types: exchange.entityTypes } : {}),
    } : {}),
  },
});

export const pullV2Changes = async (
  baseUrl: string,
  token: string,
  generationId: string,
  cursor: number,
  limit?: number,
  includeHash = false,
): Promise<V2PullData> => operationRequest<V2PullData>(baseUrl, {
  token,
  request: 'sync_v2_pull',
  payload: {
    generation_id: generationId,
    cursor,
    ...(limit != null ? { limit } : {}),
    entity_types: ['product'],
    ...(includeHash ? { include_hash: true } : {}),
  },
});

export const fetchV2SnapshotPage = async (
  baseUrl: string,
  token: string,
  generationId: string | undefined,
  sessionId: string | undefined,
  offset: number,
  limit?: number,
): Promise<V2SnapshotData> => operationRequest<V2SnapshotData>(baseUrl, {
  token,
  request: 'sync_v2_snapshot',
  payload: {
    ...(generationId ? { generation_id: generationId } : {}),
    ...(sessionId ? { session_id: sessionId } : {}),
    offset,
    ...(limit != null ? { limit } : {}),
  },
});
