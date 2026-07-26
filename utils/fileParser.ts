import { Product } from '../types';
import { normalizeDateString } from './dateUtils';
import {
  applyLegacyUsageFlags,
  getPreferredMyTeilwert,
  ProductCompatibilityFields,
} from './productCompatibility';

const hasOwn = (value: object, field: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, field);

const parseNullableNumber = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const IMPORT_FIELD_SOURCES: Array<[keyof Product, readonly string[]]> = [
  ['name', ['name']],
  ['ordernumber', ['ordernumber']],
  ['date', ['date']],
  ['etv', ['etv']],
  ['keepa', ['keepa']],
  ['teilwert', ['teilwert']],
  ['teilwert_v2', ['teilwert_v2']],
  ['pdf', ['pdf']],
  ['myTeilwert', ['myTeilwert', 'myteilwert']],
  ['myTeilwertReason', ['myTeilwertReason']],
  ['usageStatus', ['usageStatus', 'verkauft', 'lager', 'entsorgt', 'storniert', 'betriebsausgabe']],
  ['salePrice', ['salePrice']],
  ['saleDate', ['saleDate']],
  ['buyerAddress', ['buyerAddress']],
  ['privatentnahmeDate', ['privatentnahmeDate']],
  ['last_update_time', ['last_update_time']],
  ['festgeschrieben', ['festgeschrieben']],
  ['rechnungsNummer', ['rechnungsNummer']],
  ['entnahmeBelegNummer', ['entnahmeBelegNummer']],
  ['storageLocationId', ['storageLocationId']],
  ['barcodes', ['barcodes']],
];

export interface ParsedProductFromFile {
  product: Product;
  presentFields: ReadonlySet<keyof Product>;
  compatibilityFields: ProductCompatibilityFields;
}

const parseProductData = (
  productData: Record<string, unknown>,
  asin: string,
  dateContext: string,
): ParsedProductFromFile => {
  const presentFields = new Set<keyof Product>(['ASIN']);
  IMPORT_FIELD_SOURCES.forEach(([productField, sourceFields]) => {
    if (sourceFields.some(sourceField => hasOwn(productData, sourceField))) {
      presentFields.add(productField);
    }
  });

  const normalizedOrderDate = normalizeDateString(
    typeof productData.date === 'string' ? productData.date : undefined,
    dateContext,
    asin,
  );
  const product: Product = {
    ASIN: asin,
    name: typeof productData.name === 'string' && productData.name ? productData.name : 'N/A',
    ordernumber: typeof productData.ordernumber === 'string' && productData.ordernumber ? productData.ordernumber : 'N/A',
    date: normalizedOrderDate,
    etv: parseNullableNumber(productData.etv) ?? 0,
    keepa: parseNullableNumber(productData.keepa),
    teilwert: parseNullableNumber(productData.teilwert),
    teilwert_v2: parseNullableNumber(productData.teilwert_v2),
    pdf: typeof productData.pdf === 'string' && productData.pdf ? productData.pdf : undefined,
    myTeilwert: parseNullableNumber(getPreferredMyTeilwert(productData)),
    myTeilwertReason: typeof productData.myTeilwertReason === 'string' ? productData.myTeilwertReason : '',
    usageStatus: applyLegacyUsageFlags(productData),
    salePrice: parseNullableNumber(productData.salePrice),
    saleDate: typeof productData.saleDate === 'string' && productData.saleDate ? productData.saleDate : undefined,
    buyerAddress: typeof productData.buyerAddress === 'string' && productData.buyerAddress ? productData.buyerAddress : undefined,
    privatentnahmeDate: typeof productData.privatentnahmeDate === 'string' && productData.privatentnahmeDate
      ? productData.privatentnahmeDate
      : undefined,
    last_update_time: typeof productData.last_update_time === 'number'
      ? productData.last_update_time
      : undefined,
    festgeschrieben: productData.festgeschrieben === 1 ? 1 : undefined,
    rechnungsNummer: typeof productData.rechnungsNummer === 'string' && productData.rechnungsNummer
      ? productData.rechnungsNummer
      : undefined,
    entnahmeBelegNummer: typeof productData.entnahmeBelegNummer === 'string' && productData.entnahmeBelegNummer
      ? productData.entnahmeBelegNummer
      : undefined,
    storageLocationId: typeof productData.storageLocationId === 'string' && productData.storageLocationId
      ? productData.storageLocationId
      : undefined,
    barcodes: Array.isArray(productData.barcodes) ? productData.barcodes as string[] : undefined,
  };

  return {
    product,
    presentFields,
    compatibilityFields: productData,
  };
};

export const mergeParsedProduct = (
  existingProduct: Product | undefined,
  parsedProduct: ParsedProductFromFile,
): Product => {
  if (!existingProduct) return parsedProduct.product;

  const mergedProduct: Product = { ...existingProduct };
  parsedProduct.presentFields.forEach(field => {
    if (field === 'ASIN' || field === 'last_update_time' || field === 'usageStatus') return;
    (mergedProduct as any)[field] = parsedProduct.product[field];
  });

  if (parsedProduct.presentFields.has('usageStatus')) {
    mergedProduct.usageStatus = applyLegacyUsageFlags({
      ...parsedProduct.compatibilityFields,
      usageStatus: hasOwn(parsedProduct.compatibilityFields, 'usageStatus')
        ? parsedProduct.compatibilityFields.usageStatus
        : existingProduct.usageStatus,
    });
  }

  return mergedProduct;
};

export const parseProductsFromFile = (file: File): Promise<ParsedProductFromFile[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const jsonData = JSON.parse(content);
        const products: ParsedProductFromFile[] = [];

        if (Array.isArray(jsonData)) {
          jsonData.forEach((productData: unknown, index: number) => {
            if (
              typeof productData !== 'object'
              || productData === null
              || typeof (productData as Record<string, unknown>).ASIN !== 'string'
              || !(productData as Record<string, unknown>).ASIN
            ) {
              console.warn(`Product at index ${index} in array is missing ASIN. Skipping.`);
              return;
            }

            const rawProduct = productData as Record<string, unknown>;
            const asin = rawProduct.ASIN as string;
            products.push(parseProductData(
              rawProduct,
              asin,
              `order date for ASIN ${asin} from array item ${index}`,
            ));
          });
        } else if (typeof jsonData === 'object' && jsonData !== null) {
          for (const key in jsonData) {
            if (!key.startsWith('ASIN_')) continue;
            const asin = key.substring(5);
            const productString = (jsonData as Record<string, unknown>)[key];
            if (typeof productString !== 'string') {
              console.warn(`Invalid data format for key ${key}: value is not a stringified JSON. Skipping.`);
              continue;
            }

            try {
              const productData = JSON.parse(productString);
              if (typeof productData !== 'object' || productData === null || Array.isArray(productData)) {
                throw new Error('product value must be an object');
              }
              products.push(parseProductData(
                productData as Record<string, unknown>,
                asin,
                `order date for ASIN ${asin} from stringified JSON`,
              ));
            } catch (e) {
              console.warn(`Failed to parse stringified JSON for key ${key}: ${(e as Error).message}. Skipping this entry.`);
            }
          }
        } else {
          reject(new Error('Ungültiges JSON-Format. Die Datei muss entweder ein Array von Produkten oder ein Objekt mit ASIN_-Schlüsseln sein.'));
          return;
        }

        resolve(products);
      } catch (error) {
        console.error('Error parsing file:', error);
        reject(new Error('Fehler beim Parsen der JSON-Datei. Detail: ' + (error instanceof Error ? error.message : String(error))));
      }
    };

    reader.onerror = (error) => {
      console.error('Error reading file:', error);
      reject(new Error('Fehler beim Lesen der Datei.'));
    };

    reader.readAsText(file);
  });
};
