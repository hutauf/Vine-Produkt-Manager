
import { Product, ProductUsage } from '../types';
import { normalizeDateString } from './dateUtils'; // Import the new utility

const API_BASE_URL = "https://hutaufvine.pythonanywhere.com/data_operations";

// This is what the API expects for the 'value' part when stringified,
// and what we get back when parsing the 'value' string.
export interface ProductApiValue {
  name: string;
  ordernumber: string;
  date: string; // Format: DD/MM/YYYY (Order Date) or ISO String
  etv: number;
  keepa?: number | null;
  teilwert: number;
  pdf?: string;
  myTeilwert?: number | null;
  myTeilwertReason?: string;
  usageStatus: ProductUsage[]; // Multiple statuses possible
  salePrice?: number | null;
  saleDate?: string; // Format: TT.MM.JJJJ (Sale Date)
  buyerAddress?: string;
}

// This is the structure of an entry as defined by the API
export interface ApiProductEntry {
  ASIN: string;
  last_update_time: number; // Unix timestamp (integer seconds)
  value: string; // JSON.stringified ProductApiValue
}


interface ApiResponse<T> {
  status: 'success' | 'error';
  message?: string;
  data?: T;
  inserted?: number;
  updated?: number;
  skipped?: number;
}

async function fetchApi<T = any>(token: string, requestType: string, payload?: any): Promise<ApiResponse<T>> {
  if (!token) {
    return { status: 'error', message: 'API token is not set.' };
  }
  try {
    const response = await fetch(API_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token,
        request: requestType,
        payload,
      }),
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
    console.error(`API call ${requestType} failed:`, error);
    let errorMessage = 'An unknown network error occurred.';
    if (error instanceof TypeError && error.message.toLowerCase().includes('failed to fetch')) {
      errorMessage = `Failed to fetch data from the API. This could be due to:
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

// Function to convert Product to ProductApiValue (for stringification)
const productToApiValue = (product: Product): ProductApiValue => {
  // When sending to API, we want to keep the DD/MM/YYYY format for dates.
  // last_update_time is not part of the 'value' payload, it's a sibling in ApiProductEntry.
  const { ASIN, last_update_time, ...apiValue } = product;
  return apiValue as ProductApiValue;
};

// Function to convert ApiProductEntry to Product
const apiEntryToProduct = (apiEntry: ApiProductEntry): Product => {
  try {
    const valueData = JSON.parse(apiEntry.value) as Partial<ProductApiValue>; 

    const normalizedOrderDate = normalizeDateString(valueData.date, 'order date from API', apiEntry.ASIN);
    // For saleDate, it's expected to be TT.MM.JJJJ from user input, which is how it should be stored.
    // If API could return ISO for saleDate, it would need normalization too.
    // const normalizedSaleDate = valueData.saleDate ? normalizeDateString(valueData.saleDate, 'sale date from API', apiEntry.ASIN) : undefined;

    const product: Product = {
      ASIN: apiEntry.ASIN,
      name: valueData.name || 'N/A',
      ordernumber: valueData.ordernumber || 'N/A',
      date: normalizedOrderDate, // Use normalized date
      etv: typeof valueData.etv === 'number' ? valueData.etv : 0,
      keepa: typeof valueData.keepa === 'number' ? valueData.keepa : null,
      teilwert: typeof valueData.teilwert === 'number' ? valueData.teilwert : 0,
      pdf: valueData.pdf || undefined,
      myTeilwert: typeof valueData.myTeilwert === 'number' ? valueData.myTeilwert : null,
      myTeilwertReason: valueData.myTeilwertReason || '',
      usageStatus: Array.isArray(valueData.usageStatus) ? valueData.usageStatus : [],
      salePrice: typeof valueData.salePrice === 'number' ? valueData.salePrice : null,
      saleDate: valueData.saleDate || undefined, 
      buyerAddress: valueData.buyerAddress || undefined,
      last_update_time: typeof apiEntry.last_update_time === 'number' ? apiEntry.last_update_time : 0, // Ensure it's a number
    };

    // Final validation on the formats. normalizeDateString should ensure DD/MM/YYYY or fallback.
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(product.date)) {
        // This warning should ideally not trigger if normalizeDateString works perfectly,
        // except if normalizeDateString returned its input due to an extreme edge case.
        console.warn(`Product ${product.ASIN} has an unexpected order date format ('${product.date}') AFTER normalization. Expected DD/MM/YYYY. This indicates a deeper issue.`);
        // Force fallback if somehow it's still not DD/MM/YYYY
        product.date = '01/01/1970'; 
    }
    if (product.saleDate && !/^\d{2}\.\d{2}\.\d{4}$/.test(product.saleDate)) {
        console.warn(`Product ${product.ASIN} has invalid sale date format: "${product.saleDate}". Expected TT.MM.JJJJ.`);
        // product.saleDate = undefined; // Or handle as per app logic
    }

    return product;
  } catch (e: any) {
    console.error(`Failed to parse product value for ASIN ${apiEntry.ASIN}:`, e.message, `Value: "${apiEntry.value}"`);
    // Create a minimal valid product to prevent app crash
    return {
      ASIN: apiEntry.ASIN,
      name: 'Error: Corrupted Data',
      ordernumber: 'N/A',
      date: '01/01/1970',
      etv: 0,
      teilwert: 0,
      usageStatus: [],
      last_update_time: apiEntry.last_update_time || 0,
    };
  }
};


export const apiGetAllProducts = async (token: string): Promise<ApiResponse<Product[]>> => {
  const response = await fetchApi<ApiProductEntry[]>(token, "get_all");
  if (response.status === 'success' && response.data) {
    try {
      const products = response.data.map(apiEntryToProduct);
      return { status: 'success', data: products };
    } catch (parseError: any) { 
      console.error("Error parsing product data from server:", parseError);
      return { status: 'error', message: parseError.message || "Failed to parse one or more product data entries from server." };
    }
  }
  return response as ApiResponse<any>; // Type assertion for error cases
};

export const apiUpdateProducts = async (token: string, productsToUpdate: Product[]): Promise<ApiResponse<null>> => {
  if (productsToUpdate.length === 0) {
    return { status: 'success', message: 'No products to update.', inserted:0, updated:0, skipped:0 };
  }
  
  const payload = productsToUpdate.map(p => ({
    ASIN: p.ASIN,
    // The server uses this timestamp to compare with its stored last_update_time
    timestamp: p.last_update_time || Math.floor(Date.now() / 1000), 
    value: JSON.stringify(productToApiValue(p)),
  }));
  return fetchApi<null>(token, "update_asin", payload);
};

export const apiUpdateSingleProduct = async (token: string, productToUpdate: Product): Promise<ApiResponse<null>> => {
  const payload = [{
    ASIN: productToUpdate.ASIN,
    // When manually editing, this timestamp should be the current time to signify "latest"
    timestamp: productToUpdate.last_update_time || Math.floor(Date.now() / 1000), 
    value: JSON.stringify(productToApiValue(productToUpdate)),
  }];
  return fetchApi<null>(token, "update_asin", payload);
};


export const apiDeleteAllData = async (token: string): Promise<ApiResponse<null>> => {
  return fetchApi<null>(token, "delete_all");
};
