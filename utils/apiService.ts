
import { Product, ProductUsage } from '../types';
import { normalizeDateString } from './dateUtils'; // Import the new utility
import { TEILWERT_V2_API_URL } from '../constants';


// This is what the API expects for the 'value' part when stringified,
// and what we get back when parsing the 'value' string.
export interface ProductApiValue {
  name: string;
  ordernumber: string;
  date: string; // Format: DD/MM/YYYY (Order Date) or ISO String
  etv: number;
  keepa?: number | null;
  teilwert: number | null; 
  pdf?: string;
  myTeilwert?: number | null;
  myTeilwertReason?: string;
  usageStatus: ProductUsage[]; // Multiple statuses possible
  salePrice?: number | null;
  saleDate?: string; // Format: TT.MM.JJJJ (Sale Date)
  buyerAddress?: string;
  privatentnahmeDate?: string; // Format: TT.MM.JJJJ
  festgeschrieben?: 1; // New field
  rechnungsNummer?: string; // New field
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


interface ApiResponse<T> {
  status: 'success' | 'error';
  message?: string;
  data?: T;
  inserted?: number;
  updated?: number;
  skipped?: number;
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
const productToApiValue = (product: Product): ProductApiValue => {
  const { ASIN, last_update_time, ...apiValueFields } = product;
  const apiValue: ProductApiValue = {
    name: apiValueFields.name,
    ordernumber: apiValueFields.ordernumber,
    date: apiValueFields.date,
    etv: apiValueFields.etv,
    teilwert: apiValueFields.teilwert, 
    usageStatus: apiValueFields.usageStatus,
    ...(apiValueFields.keepa !== undefined && { keepa: apiValueFields.keepa }),
    ...(apiValueFields.pdf !== undefined && { pdf: apiValueFields.pdf }),
    ...(apiValueFields.myTeilwert !== undefined && { myTeilwert: apiValueFields.myTeilwert }),
    ...(apiValueFields.myTeilwertReason !== undefined && { myTeilwertReason: apiValueFields.myTeilwertReason }),
    ...(apiValueFields.salePrice !== undefined && { salePrice: apiValueFields.salePrice }),
    ...(apiValueFields.saleDate !== undefined && { saleDate: apiValueFields.saleDate }),
    ...(apiValueFields.buyerAddress !== undefined && { buyerAddress: apiValueFields.buyerAddress }),
    ...(apiValueFields.privatentnahmeDate !== undefined && { privatentnahmeDate: apiValueFields.privatentnahmeDate }),
    ...(apiValueFields.festgeschrieben !== undefined && { festgeschrieben: apiValueFields.festgeschrieben }),
    ...(apiValueFields.rechnungsNummer !== undefined && { rechnungsNummer: apiValueFields.rechnungsNummer }),
  };
  return apiValue;
};


// Function to convert ApiProductEntry (from main DB) to Product
const apiEntryToProduct = (apiEntry: ApiProductEntry): Product => {
  try {
    const valueData = JSON.parse(apiEntry.value) as Partial<ProductApiValue>; 

    const normalizedOrderDate = normalizeDateString(valueData.date, 'order date from API', apiEntry.ASIN);
    
    const product: Product = {
      ASIN: apiEntry.ASIN,
      name: valueData.name || 'N/A',
      ordernumber: valueData.ordernumber || 'N/A',
      date: normalizedOrderDate, 
      etv: typeof valueData.etv === 'number' ? valueData.etv : 0,
      keepa: typeof valueData.keepa === 'number' ? valueData.keepa : null,
      teilwert: typeof valueData.teilwert === 'number' ? valueData.teilwert : null, 
      pdf: valueData.pdf || undefined,
      myTeilwert: typeof valueData.myTeilwert === 'number' ? valueData.myTeilwert : null,
      myTeilwertReason: valueData.myTeilwertReason || '',
      usageStatus: Array.isArray(valueData.usageStatus) ? valueData.usageStatus : [],
      salePrice: typeof valueData.salePrice === 'number' ? valueData.salePrice : null,
      saleDate: valueData.saleDate || undefined, 
      buyerAddress: valueData.buyerAddress || undefined,
      privatentnahmeDate: valueData.privatentnahmeDate || undefined, 
      last_update_time: typeof apiEntry.last_update_time === 'number' ? apiEntry.last_update_time : 0,
      festgeschrieben: valueData.festgeschrieben === 1 ? 1 : undefined,
      rechnungsNummer: valueData.rechnungsNummer || undefined, 
    };

    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(product.date)) {
        console.warn(`Product ${product.ASIN} has an unexpected order date format ('${product.date}') AFTER normalization. Expected DD/MM/YYYY. This indicates a deeper issue.`);
        product.date = '01/01/1970'; 
    }
    if (product.saleDate && !/^\d{2}\.\d{2}\.\d{4}$/.test(product.saleDate)) {
        console.warn(`Product ${product.ASIN} has invalid sale date format: "${product.saleDate}". Expected TT.MM.JJJJ.`);
    }
    if (product.privatentnahmeDate && !/^\d{2}\.\d{2}\.\d{4}$/.test(product.privatentnahmeDate)) {
        console.warn(`Product ${product.ASIN} has invalid privatentnahme date format: "${product.privatentnahmeDate}". Expected TT.MM.JJJJ.`);
    }

    return product;
  } catch (e: any) {
    console.error(`Failed to parse product value for ASIN ${apiEntry.ASIN}:`, e.message, `Value: "${apiEntry.value}"`);
    return {
      ASIN: apiEntry.ASIN, name: 'Error: Corrupted Data', ordernumber: 'N/A', date: '01/01/1970',
      etv: 0, teilwert: null, usageStatus: [], last_update_time: apiEntry.last_update_time || 0,
    };
  }
};


export const apiGetAllProducts = async (baseUrl: string, token: string): Promise<ApiResponse<Product[]>> => {
  const body = { token, request: "get_all" };
  const response = await fetchApiPost<ApiProductEntry[]>(baseUrl, body);

  if (response.status === 'success' && response.data) {
    try {
      if (!Array.isArray(response.data)) {
          console.error("API get_all (main products) did not return an array in 'data' field:", response.data);
          return { status: 'error', message: "Invalid data structure received from server (expected array for main products)." };
      }
      const products = response.data
        .map(apiEntry => {
            if (!apiEntry || typeof apiEntry.ASIN !== 'string' || typeof apiEntry.value !== 'string') {
                console.warn("Skipping invalid API entry (main products):", apiEntry);
                return null; 
            }
            return apiEntryToProduct(apiEntry);
        })
        .filter(product => product !== null) as Product[];
      return { status: 'success', data: products };
    } catch (parseError: any) { 
      console.error("Error parsing main product data from server:", parseError);
      return { status: 'error', message: parseError.message || "Failed to parse one or more main product data entries from server." };
    }
  }
  return response as ApiResponse<any>; 
};

export const apiUpdateProducts = async (baseUrl: string, token: string, productsToUpdate: Product[]): Promise<ApiResponse<null>> => {
  if (productsToUpdate.length === 0) {
    return { status: 'success', message: 'No products to update.', inserted:0, updated:0, skipped:0 };
  }
  
  const payload = productsToUpdate.map(p => ({
    ASIN: p.ASIN,
    timestamp: p.last_update_time || Math.floor(Date.now() / 1000), 
    value: JSON.stringify(productToApiValue(p)),
  }));
  const body = { token, request: "update_asin", payload };
  return fetchApiPost<null>(baseUrl, body);
};

export const apiUpdateSingleProduct = async (baseUrl: string, token: string, productToUpdate: Product): Promise<ApiResponse<null>> => {
  const payload = [{
    ASIN: productToUpdate.ASIN,
    timestamp: productToUpdate.last_update_time || Math.floor(Date.now() / 1000), 
    value: JSON.stringify(productToApiValue(productToUpdate)),
  }];
  const body = { token, request: "update_asin", payload };
  return fetchApiPost<null>(baseUrl, body);
};


export const apiDeleteAllData = async (baseUrl: string, token: string): Promise<ApiResponse<null>> => {
  const body = { token, request: "delete_all" };
  return fetchApiPost<null>(baseUrl, body);
};

// New function to get Teilwert v2 data
// The response structure is expected to be: { status: "success", data: { "ASIN1": "{\"Teilwert\": 12.34, ...}", "ASIN2": "{...}" } }
export const apiGetTeilwertV2Data = async (token: string): Promise<ApiResponse<{[asin: string]: string}>> => {
  if (!token) {
    return { status: 'error', message: 'API token is not set for Teilwert V2.' };
  }
  const body = {
    token: token,
    database: "v2processstatus",
    request: "get_all" // Assuming "get_all" is the correct request type
  };
  // Using TEILWERT_V2_API_URL directly as per specification
  return fetchApiPost<{[asin: string]: string}>(TEILWERT_V2_API_URL, body);
};

export const apiGetImages = async (asins: string[]): Promise<{[asin: string]: string[]}> => {
  const resp = await fetch('/get_images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ asins })
  });
  if (!resp.ok) throw new Error('failed to fetch images');
  return resp.json();
};
