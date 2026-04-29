export interface DataOperationResponse<T> {
  status: 'success' | 'error';
  message?: string;
  data?: T;
  inserted?: number;
  updated?: number;
  skipped?: number;
}

export interface StorageLocationValue {
  status?: 'free' | 'occupied' | string;
  note?: string;
  [key: string]: unknown;
}

export interface StorageLocationEntry {
  location_id: string;
  timestamp: number;
  value: StorageLocationValue;
}

interface RawStorageLocationEntry {
  location_id: string;
  timestamp: number;
  value: string;
}

async function postDataOperation<T>(baseUrl: string, token: string, request: string, payload?: unknown): Promise<DataOperationResponse<T>> {
  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '69420' },
      body: JSON.stringify({ token, request, ...(payload !== undefined ? { payload } : {}) }),
      mode: 'cors',
    });

    if (!response.ok) {
      return { status: 'error', message: `HTTP ${response.status}: ${response.statusText}` };
    }

    try {
      return (await response.json()) as DataOperationResponse<T>;
    } catch (error) {
      return { status: 'error', message: `Ungültige JSON-Antwort vom Server: ${error instanceof Error ? error.message : 'Unknown parse error'}` };
    }
  } catch (error) {
    return { status: 'error', message: `Netzwerkfehler bei /data_operations: ${error instanceof Error ? error.message : 'Unknown network error'}` };
  }
}

function parseLocation(entry: RawStorageLocationEntry): StorageLocationEntry {
  let parsedValue: StorageLocationValue = {};
  try {
    parsedValue = JSON.parse(entry.value ?? '{}') as StorageLocationValue;
  } catch {
    parsedValue = {};
  }

  return {
    location_id: entry.location_id,
    timestamp: entry.timestamp,
    value: parsedValue,
  };
}

export async function listStorageLocations(baseUrl: string, token: string): Promise<DataOperationResponse<StorageLocationEntry[]>> {
  const result = await postDataOperation<RawStorageLocationEntry[]>(baseUrl, token, 'list_storage_locations');
  if (result.status !== 'success' || !result.data) return result as DataOperationResponse<StorageLocationEntry[]>;

  return { ...result, data: result.data.map(parseLocation) };
}

export async function getStorageLocationsByIds(baseUrl: string, token: string, locationIds: string[]): Promise<DataOperationResponse<StorageLocationEntry[]>> {
  const result = await postDataOperation<RawStorageLocationEntry[]>(baseUrl, token, 'get_storage_location', locationIds);
  if (result.status !== 'success' || !result.data) return result as DataOperationResponse<StorageLocationEntry[]>;

  return { ...result, data: result.data.map(parseLocation) };
}

export interface UpdateStorageLocationInput {
  location_id: string;
  timestamp?: number;
  value: StorageLocationValue;
}

export async function updateStorageLocations(baseUrl: string, token: string, entries: UpdateStorageLocationInput[]): Promise<DataOperationResponse<null>> {
  const now = Math.floor(Date.now() / 1000);
  const payload = entries.map((entry) => ({
    location_id: entry.location_id,
    timestamp: entry.timestamp ?? now,
    value: JSON.stringify(entry.value),
  }));

  return postDataOperation<null>(baseUrl, token, 'update_storage_location', payload);
}

export async function mergeStorageLocationValue(baseUrl: string, token: string, locationId: string, partialValue: StorageLocationValue): Promise<DataOperationResponse<null>> {
  return updateStorageLocations(baseUrl, token, [
    {
      location_id: locationId,
      timestamp: 0,
      value: partialValue,
    },
  ]);
}
