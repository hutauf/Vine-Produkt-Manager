import { Product } from '../types';
import { normalizeDateString } from './dateUtils';

export const parseProductsFromFile = (file: File): Promise<Product[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const jsonData = JSON.parse(content);
        const products: Product[] = [];

        if (Array.isArray(jsonData)) {
          jsonData.forEach((productData: any, index: number) => {
            if (!productData.ASIN) {
              console.warn(`Product at index ${index} in array is missing ASIN. Skipping.`);
              return;
            }
            const normalizedOrderDate = normalizeDateString(productData.date, `order date for ASIN ${productData.ASIN} from array item ${index}`, productData.ASIN);
            const parsedTeilwert = parseFloat(productData.teilwert);

            products.push({
              ASIN: productData.ASIN,
              name: productData.name || 'N/A',
              ordernumber: productData.ordernumber || 'N/A',
              date: normalizedOrderDate,
              etv: parseFloat(productData.etv) || 0,
              keepa: productData.keepa != null ? parseFloat(productData.keepa) : null,
              teilwert: !isNaN(parsedTeilwert) ? parsedTeilwert : null,
              teilwert_v2: productData.teilwert_v2 != null ? parseFloat(productData.teilwert_v2) : null,
              pdf: productData.pdf,
              myTeilwert: productData.myTeilwert != null ? parseFloat(productData.myTeilwert) : null,
              myTeilwertReason: productData.myTeilwertReason || '',
              usageStatus: Array.isArray(productData.usageStatus) ? productData.usageStatus : [],
              salePrice: productData.salePrice != null ? parseFloat(productData.salePrice) : null,
              saleDate: productData.saleDate || undefined,
              buyerAddress: productData.buyerAddress || undefined,
              privatentnahmeDate: productData.privatentnahmeDate || undefined,
              last_update_time: typeof productData.last_update_time === 'number' ? productData.last_update_time : undefined,
              festgeschrieben: productData.festgeschrieben === 1 ? 1 : undefined,
              rechnungsNummer: productData.rechnungsNummer || undefined,
              entnahmeBelegNummer: productData.entnahmeBelegNummer || undefined,
            });
          });
        } else if (typeof jsonData === 'object' && jsonData !== null) {
          for (const key in jsonData) {
            if (!key.startsWith('ASIN_')) continue;
            const asin = key.substring(5);
            const productString = jsonData[key];
            if (typeof productString !== 'string') {
              console.warn(`Invalid data format for key ${key}: value is not a stringified JSON. Skipping.`);
              continue;
            }

            try {
              const productData = JSON.parse(productString);
              const normalizedOrderDate = normalizeDateString(productData.date, `order date for ASIN ${asin} from stringified JSON`, asin);
              const parsedTeilwert = parseFloat(productData.teilwert);

              products.push({
                ASIN: asin,
                name: productData.name || 'N/A',
                ordernumber: productData.ordernumber || 'N/A',
                date: normalizedOrderDate,
                etv: parseFloat(productData.etv) || 0,
                keepa: productData.keepa != null ? parseFloat(productData.keepa) : null,
                teilwert: !isNaN(parsedTeilwert) ? parsedTeilwert : null,
                teilwert_v2: productData.teilwert_v2 != null ? parseFloat(productData.teilwert_v2) : null,
                pdf: productData.pdf,
                myTeilwert: productData.myTeilwert != null ? parseFloat(productData.myTeilwert) : null,
                myTeilwertReason: productData.myTeilwertReason || '',
                usageStatus: Array.isArray(productData.usageStatus) ? productData.usageStatus : [],
                salePrice: productData.salePrice != null ? parseFloat(productData.salePrice) : null,
                saleDate: productData.saleDate || undefined,
                buyerAddress: productData.buyerAddress || undefined,
                privatentnahmeDate: productData.privatentnahmeDate || undefined,
                last_update_time: typeof productData.last_update_time === 'number' ? productData.last_update_time : undefined,
                festgeschrieben: productData.festgeschrieben === 1 ? 1 : undefined,
                rechnungsNummer: productData.rechnungsNummer || undefined,
                entnahmeBelegNummer: productData.entnahmeBelegNummer || undefined,
              });
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
