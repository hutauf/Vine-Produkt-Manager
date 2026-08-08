
import { Product, ProductHistoryEntry, ProductUsage } from '../types';
import { normalizeDateString } from './dateUtils'; // Import the new utility
import {
  usageStatusToLegacyFlags,
} from './productCompatibility';
import { normalizeSyncedProduct } from './syncProductCompatibility';
import { openProductRepository } from './syncDatabase';
import {
  detectSyncProtocol,
  queueProductsForSync,
  runV2Sync,
  runWithProfileSyncLock,
} from './syncEngine';


// This is what the API expects for the 'value' part when stringified,
// and what we get back when parsing the 'value' string.
export interface ProductApiValue {
  [key: string]: unknown;
  name: string;
  ordernumber: string;
  date?: string; // Calendar date in DD/MM/YYYY; absent when unknown
  etv: number;
  keepa?: number | null;
  teilwert: number | null; 
  teilwert_v2?: number | null;
  pdf?: string;
  myTeilwert?: number | null;
  myteilwert?: number | null;
  myTeilwertReason?: string;
  usageStatus: ProductUsage[]; // Multiple statuses possible
  verkauft?: boolean;
  lager?: boolean;
  entsorgt?: boolean;
  storniert?: boolean;
  betriebsausgabe?: boolean;
  salePrice?: number | null;
  saleDate?: string; // Format: TT.MM.JJJJ (Sale Date)
  buyerAddress?: string;
  privatentnahmeDate?: string; // Format: TT.MM.JJJJ
  festgeschrieben?: 1; // New field
  rechnungsNummer?: string; // New field
  entnahmeBelegNummer?: string;
  storageLocationId?: string;
  barcodes?: string[];
}

// This is the structure of an entry as defined by the API for the main product database
export interface ApiProductEntry {
  ASIN: string;
  last_update_time: number; // Unix timestamp (integer seconds)
  value: string; // JSON.stringified ProductApiValue
}

// Structure for Teilwert v2 data entries (value is stringified JSON containing at least "Teilwert")
export interface TeilwertV2ApiValue {
    Teilwert: number;
    // other fields might exist but are not used yet
}


export interface ApiResponse<T> {
  status: 'success' | 'error';
  message?: string;
  data?: T;
  inserted?: number;
  updated?: number;
  skipped?: number;
  syncProtocol?: 'v1' | 'v2';
  conflicts?: number;
}

export interface ProcedureDocEntry {
  doc_id: string;
  timestamp: number;
  value: string;
}

interface RawProcedureDocEntry {
  doc_id: string;
  last_update_time?: number;
  timestamp?: number;
  value: string;
}

type RawProductValue = Record<string, unknown>;

interface CanonicalProductEntries {
  entries: ApiProductEntry[];
  corrections: ApiProductEntry[];
}

// Generic fetch function, now accepts full URL
async function fetchApiPost<T = any>(fullUrl: string, bodyPayload: any): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': '69420',
      },
      body: JSON.stringify(bodyPayload),
      mode: 'cors',
    });

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        return { status: 'error', message: `API Error: ${response.status} ${response.statusText}. Response body was not valid JSON.` };
      }
      return { status: 'error', message: errorData?.message || `API Error: ${response.status} ${response.statusText}` };
    }
    return (await response.json()) as ApiResponse<T>;
  } catch (error) {
    console.error(`API call to ${fullUrl} failed:`, error);
    let errorMessage = 'An unknown network error occurred.';
    if (error instanceof TypeError && error.message.toLowerCase().includes('failed to fetch')) {
      errorMessage = `Failed to fetch data from the API (${fullUrl}). This could be due to:
1. Network connectivity issues.
2. Server-side CORS misconfiguration (ensure OPTIONS preflight requests are handled for POST with Content-Type: application/json).
3. "Outgoing CORS rules" or network restrictions in the frontend's hosting environment. Check platform settings for domain whitelisting or proxy configuration.
Original error: ${error.message}`;
    } else if (error instanceof Error) {
      errorMessage = `Network error or invalid response: ${error.message}`;
    }
    return { status: 'error', message: errorMessage };
  }
}


// Function to convert Product to ProductApiValue (for stringification to main DB)
export const productToApiValue = (product: Product): ProductApiValue => {
  const { ASIN, last_update_time, ...apiValueFields } = product;
  const usageStatus = Array.isArray(apiValueFields.usageStatus) ? apiValueFields.usageStatus : [];
  const legacyUsageFlags = usageStatusToLegacyFlags(usageStatus);
  const normalizedOrderDate = normalizeDateString(
    apiValueFields.date,
    'order date for API update',
    ASIN,
  );
  const apiValue: ProductApiValue = {
    ...apiValueFields,
    name: apiValueFields.name,
    ordernumber: apiValueFields.ordernumber,
    ...(normalizedOrderDate && { date: normalizedOrderDate }),
    etv: apiValueFields.etv,
    teilwert: apiValueFields.teilwert,
    ...(apiValueFields.teilwert_v2 !== undefined && { teilwert_v2: apiValueFields.teilwert_v2 }),
    usageStatus,
    ...(apiValueFields.keepa !== undefined && { keepa: apiValueFields.keepa }),
    ...(apiValueFields.pdf !== undefined && { pdf: apiValueFields.pdf }),
    ...(apiValueFields.myTeilwert !== undefined && { myTeilwert: apiValueFields.myTeilwert }),
    ...(apiValueFields.myTeilwert !== undefined && { myteilwert: apiValueFields.myTeilwert }),
    ...(apiValueFields.myTeilwertReason !== undefined && { myTeilwertReason: apiValueFields.myTeilwertReason }),
    ...legacyUsageFlags,
    ...(apiValueFields.salePrice !== undefined && { salePrice: apiValueFields.salePrice }),
    ...(apiValueFields.saleDate !== undefined && { saleDate: apiValueFields.saleDate }),
    ...(apiValueFields.buyerAddress !== undefined && { buyerAddress: apiValueFields.buyerAddress }),
    ...(apiValueFields.privatentnahmeDate !== undefined && { privatentnahmeDate: apiValueFields.privatentnahmeDate }),
    ...(apiValueFields.festgeschrieben !== undefined && { festgeschrieben: apiValueFields.festgeschrieben }),
    ...(apiValueFields.rechnungsNummer !== undefined && { rechnungsNummer: apiValueFields.rechnungsNummer }),
    ...(apiValueFields.entnahmeBelegNummer !== undefined && { entnahmeBelegNummer: apiValueFields.entnahmeBelegNummer }),
    ...(apiValueFields.storageLocationId !== undefined && { storageLocationId: apiValueFields.storageLocationId }),
    ...(apiValueFields.barcodes !== undefined && { barcodes: apiValueFields.barcodes }),
  };
  if (!normalizedOrderDate) delete apiValue.date;
  return apiValue;
};
const parseRawProductValue = (entry: ApiProductEntry): RawProductValue => {
  const parsed = JSON.parse(entry.value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Product ${entry.ASIN} does not contain a JSON object.`);
  }
  return parsed as RawProductValue;
};

/**
 * Groups case-only ASIN variants and merges their raw JSON without dropping
 * fields unknown to this frontend. Newer records win; on equal timestamps the
 * already canonical uppercase key wins.
 */
export const canonicalizeApiProductEntries = (
  apiEntries: ApiProductEntry[],
): CanonicalProductEntries => {
  const groupedEntries = new Map<string, ApiProductEntry[]>();
  apiEntries.forEach(entry => {
    const canonicalAsin = entry.ASIN.trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(canonicalAsin)) {
      throw new Error(`Invalid ASIN received from API: ${entry.ASIN}`);
    }
    const group = groupedEntries.get(canonicalAsin) || [];
    group.push(entry);
    groupedEntries.set(canonicalAsin, group);
  });

  const entries: ApiProductEntry[] = [];
  const corrections: ApiProductEntry[] = [];
  groupedEntries.forEach((variants, canonicalAsin) => {
    const orderedVariants = [...variants].sort((left, right) => {
      const timestampDifference = (Number(left.last_update_time) || 0)
        - (Number(right.last_update_time) || 0);
      if (timestampDifference !== 0) return timestampDifference;
      const canonicalDifference = Number(left.ASIN === canonicalAsin)
        - Number(right.ASIN === canonicalAsin);
      if (canonicalDifference !== 0) return canonicalDifference;
      return left.ASIN.localeCompare(right.ASIN);
    });
    const mergedValue: RawProductValue = {};
    orderedVariants.forEach(variant => {
      Object.assign(mergedValue, parseRawProductValue(variant));
    });
    if (Object.prototype.hasOwnProperty.call(mergedValue, 'date')) {
      const normalizedDate = normalizeDateString(
        typeof mergedValue.date === 'string' ? mergedValue.date : undefined,
        'order date during ASIN cleanup',
        canonicalAsin,
      );
      if (normalizedDate) {
        mergedValue.date = normalizedDate;
      } else {
        delete mergedValue.date;
      }
    }

    const canonicalEntry: ApiProductEntry = {
      ASIN: canonicalAsin,
      last_update_time: Math.max(
        ...orderedVariants.map(variant => Number(variant.last_update_time) || 0),
      ),
      value: JSON.stringify(mergedValue),
    };
    entries.push(canonicalEntry);
    if (
      variants.length > 1
      || variants.some(variant => variant.ASIN !== canonicalAsin)
    ) {
      corrections.push(canonicalEntry);
    }
  });
  return { entries, corrections };
};


// Function to convert ApiProductEntry (from main DB) to Product
export const apiEntryToProduct = (apiEntry: ApiProductEntry): Product => {
  try {
    const valueData = JSON.parse(apiEntry.value) as RawProductValue;
    const product = normalizeSyncedProduct(
      apiEntry.ASIN,
      valueData,
      typeof apiEntry.last_update_time === 'number' ? apiEntry.last_update_time : 0,
    );

    if (product.saleDate && !/^\d{2}\.\d{2}\.\d{4}$/.test(product.saleDate)) {
        console.warn(`Product ${product.ASIN} has invalid sale date format: "${product.saleDate}". Expected TT.MM.JJJJ.`);
    }
    if (product.privatentnahmeDate && !/^\d{2}\.\d{2}\.\d{4}$/.test(product.privatentnahmeDate)) {
        console.warn(`Product ${product.ASIN} has invalid privatentnahme date format: "${product.privatentnahmeDate}". Expected TT.MM.JJJJ.`);
    }

    return product;
  } catch (e: any) {
    console.error(`Failed to parse product value for ASIN ${apiEntry.ASIN}:`, e.message);
    return {
      ASIN: apiEntry.ASIN, name: 'Error: Corrupted Data', ordernumber: 'N/A', date: '',
      etv: 0, teilwert: null, teilwert_v2: null, usageStatus: [], last_update_time: apiEntry.last_update_time || 0,
    };
  }
};


export const apiGetAllProducts = async (baseUrl: string, token: string): Promise<ApiResponse<Product[]>> => {
  const repository = await openProductRepository(baseUrl, token);
  try {
    const capabilities = await detectSyncProtocol(repository, baseUrl, token);
    if (capabilities) {
      const result = await runV2Sync(repository, baseUrl, token, capabilities);
      return {
        status: 'success',
        data: result.products,
        syncProtocol: 'v2',
        conflicts: result.conflicts,
        message: [
          result.warning,
          result.conflicts > 0
            ? `${result.conflicts} Synchronisationskonflikt(e) benötigen eine Auflösung.`
            : undefined,
        ].filter(Boolean).join(' ') || undefined,
      };
    }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return runWithProfileSyncLock(repository.profile.id, async () => {
    const body = { token, request: "get_all" };
    const response = await fetchApiPost<ApiProductEntry[]>(baseUrl, body);

    if (response.status === 'success' && response.data) {
      try {
        if (!Array.isArray(response.data)) {
          console.error("API get_all (main products) did not return an array in 'data' field.");
          return { status: 'error', message: "Invalid data structure received from server (expected array for main products)." };
        }
        const validEntries = response.data.filter(apiEntry => {
          const valid = apiEntry
            && typeof apiEntry.ASIN === 'string'
            && typeof apiEntry.value === 'string';
          if (!valid) console.warn("Skipping invalid API entry (main products).");
          return valid;
        });
        const canonicalized = canonicalizeApiProductEntries(validEntries);
        if (canonicalized.corrections.length > 0) {
          const cleanupResponse = await fetchApiPost<null>(baseUrl, {
            token,
            request: 'update_asin',
            payload: canonicalized.corrections.map(entry => ({
              ASIN: entry.ASIN,
              timestamp: 0,
              value: entry.value,
            })),
          });
          if (cleanupResponse.status !== 'success') {
            return {
              status: 'error',
              message: `ASIN cleanup failed: ${cleanupResponse.message || 'unknown backend error'}`,
            };
          }
        }
        const products = canonicalized.entries.map(apiEntryToProduct);
        const mergedProducts = await repository.applyV1ServerProducts(products);
        return {
          status: 'success',
          data: mergedProducts,
          syncProtocol: 'v1',
          message: 'Server unterstützt noch keinen inkrementellen V2-Sync; kompatibler V1-Vollsync ist aktiv.',
        } as ApiResponse<Product[]>;
      } catch (parseError: any) {
        console.error("Error parsing main product data from server:", parseError);
        return { status: 'error', message: parseError.message || "Failed to parse one or more main product data entries from server." };
      }
    }
    return {
      status: response.status,
      message: response.message,
      inserted: response.inserted,
      updated: response.updated,
      skipped: response.skipped,
    };
  });
};

export const apiUpdateProducts = async (
  baseUrl: string,
  token: string,
  productsToUpdate: Product[],
  baseProducts: Array<Product | undefined> = [],
): Promise<ApiResponse<null>> => {
  if (productsToUpdate.length === 0) {
    return { status: 'success', message: 'No products to update.', inserted:0, updated:0, skipped:0 };
  }
  const repository = await openProductRepository(baseUrl, token);
  await queueProductsForSync(repository, productsToUpdate, baseProducts);
  try {
    const capabilities = await detectSyncProtocol(repository, baseUrl, token);
    if (capabilities) {
      const result = await runV2Sync(repository, baseUrl, token, capabilities);
      const targetAsins = new Set(productsToUpdate.map(product => product.ASIN.trim().toUpperCase()));
      const targetConflicts = new Set((await repository.listConflicts())
        .filter(conflict => (
          conflict.entityType === 'product' && targetAsins.has(conflict.entityId)
        ))
        .map(conflict => conflict.entityId));
      return {
        status: 'success',
        message: [
          'Inkrementelle Synchronisierung abgeschlossen.',
          result.warning,
          result.conflicts > 0
            ? `${result.conflicts} Änderung(en) stehen in der Konfliktliste.`
            : undefined,
        ].filter(Boolean).join(' '),
        updated: result.pushed,
        inserted: 0,
        skipped: targetConflicts.size,
        syncProtocol: 'v2',
        conflicts: result.conflicts,
      };
    }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return runWithProfileSyncLock(repository.profile.id, async () => {
    const preparedV1 = await repository.prepareV1Upload(
      productsToUpdate.map(product => product.ASIN),
    );
    const productsForV1 = preparedV1.products;
    const blockedByConflict = preparedV1.blockedAsins.length;
    if (productsForV1.length === 0) {
      return {
        status: 'success',
        message: blockedByConflict > 0
          ? `${blockedByConflict} Änderung(en) stehen in der Konfliktliste und wurden nicht per V1 überschrieben.`
          : 'Keine synchronisierbaren Produkte gefunden.',
        inserted: 0,
        updated: 0,
        skipped: blockedByConflict,
        syncProtocol: 'v1',
        conflicts: await repository.countConflicts(),
      } as ApiResponse<null>;
    }
    const payload = productsForV1.map(p => ({
      ASIN: p.ASIN,
      timestamp: p.last_update_time || Math.floor(Date.now() / 1000),
      value: JSON.stringify(productToApiValue(p)),
    }));
    const body = { token, request: "update_asin", payload };
    const response = await fetchApiPost<null>(baseUrl, body);
    if (response.status === 'success') {
      const serverSkipped = response.skipped ?? 0;
      if (serverSkipped === 0) {
        await repository.acknowledgeV1Products(productsForV1, preparedV1.mutationIds);
      }
      response.skipped = serverSkipped + blockedByConflict;
      response.syncProtocol = 'v1';
      response.conflicts = await repository.countConflicts();
      response.message = [
        response.message
          ?? 'Kompatibler V1-Vollsync aktiv; für schnelleren Sync kann der Server aktualisiert werden.',
        blockedByConflict > 0
          ? `${blockedByConflict} Änderung(en) stehen in der Konfliktliste und wurden nicht per V1 überschrieben.`
          : undefined,
      ].filter(Boolean).join(' ');
    }
    return response;
  });
};

export const apiUpdateSingleProduct = async (
  baseUrl: string,
  token: string,
  productToUpdate: Product,
  baseProduct?: Product,
): Promise<ApiResponse<null>> => {
  return apiUpdateProducts(baseUrl, token, [productToUpdate], baseProduct ? [baseProduct] : []);
};


export const apiDeleteAllData = async (baseUrl: string, token: string): Promise<ApiResponse<null>> => {
  const repository = await openProductRepository(baseUrl, token);
  return runWithProfileSyncLock(repository.profile.id, async () => {
    const body = { token, request: "delete_all" };
    const response = await fetchApiPost<null>(baseUrl, body);
    if (response.status === 'success') await repository.acknowledgeRemoteDelete();
    return response;
  });
};



export const apiGetImages = async (asins: string[]): Promise<{[asin: string]: string[]}> => {
  const resp = await fetch('/oracle2/api/get_images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ asins })
  });
  if (!resp.ok) throw new Error('failed to fetch images');
  return resp.json();
};

export const apiGetAsinHistory = async (baseUrl: string, token: string, asin: string): Promise<ApiResponse<ProductHistoryEntry[]>> => {
  const body = { token, request: "get_asin_history", payload: { ASIN: asin } };
  const response = await fetchApiPost<ProductHistoryEntry[]>(baseUrl, body);
  return response;
};

export const apiGetProcedureDoc = async (baseUrl: string, token: string, docId: string): Promise<ApiResponse<ProcedureDocEntry[]>> => {
  const body = { token, request: "get_procedure_doc", payload: [docId] };
  const response = await fetchApiPost<RawProcedureDocEntry[]>(baseUrl, body);
  if (response.status !== 'success' || !response.data) {
    return response as ApiResponse<ProcedureDocEntry[]>;
  }

  return {
    ...response,
    data: response.data.map(entry => ({
      doc_id: entry.doc_id,
      timestamp: entry.last_update_time ?? entry.timestamp ?? 0,
      value: entry.value,
    })),
  };
};

export const apiUpdateProcedureDoc = async (
  baseUrl: string,
  token: string,
  docId: string,
  value: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): Promise<ApiResponse<null>> => {
  const body = {
    token,
    request: "update_procedure_doc",
    payload: [{ doc_id: docId, timestamp, value }],
  };
  return fetchApiPost<null>(baseUrl, body);
};
