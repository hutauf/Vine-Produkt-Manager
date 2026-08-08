import { Product } from '../types';
import { normalizeDateString } from './dateUtils';
import { applyLegacyUsageFlags, getPreferredMyTeilwert } from './productCompatibility';
import { JsonObject } from './syncTypes';

const parseNullableNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/**
 * Convert a raw product object from either sync protocol into the frontend's
 * compatibility shape. The leading spread deliberately keeps fields which a
 * newer client or server knows but this version does not.
 *
 * This function does not make any conflict decision. In particular,
 * `legacyLastUpdateTime` is metadata only; V2 callers must use revisions after
 * the one-time legacy bootstrap has completed.
 */
export const normalizeSyncedProduct = (
  asin: string,
  rawValue: JsonObject,
  legacyLastUpdateTime = 0,
): Product => {
  const normalizedOrderDate = normalizeDateString(
    typeof rawValue.date === 'string' ? rawValue.date : undefined,
    'order date from API',
    asin,
  );
  return {
    ...rawValue,
    ASIN: asin,
    name: typeof rawValue.name === 'string' && rawValue.name ? rawValue.name : 'N/A',
    ordernumber: typeof rawValue.ordernumber === 'string' && rawValue.ordernumber
      ? rawValue.ordernumber
      : 'N/A',
    date: normalizedOrderDate,
    etv: parseNullableNumber(rawValue.etv) ?? 0,
    keepa: parseNullableNumber(rawValue.keepa),
    teilwert: parseNullableNumber(rawValue.teilwert),
    teilwert_v2: parseNullableNumber(rawValue.teilwert_v2),
    pdf: typeof rawValue.pdf === 'string' && rawValue.pdf ? rawValue.pdf : undefined,
    myTeilwert: parseNullableNumber(getPreferredMyTeilwert(rawValue)),
    myTeilwertReason: typeof rawValue.myTeilwertReason === 'string'
      ? rawValue.myTeilwertReason
      : '',
    usageStatus: applyLegacyUsageFlags(rawValue),
    salePrice: parseNullableNumber(rawValue.salePrice),
    saleDate: typeof rawValue.saleDate === 'string' && rawValue.saleDate
      ? rawValue.saleDate
      : undefined,
    buyerAddress: typeof rawValue.buyerAddress === 'string' && rawValue.buyerAddress
      ? rawValue.buyerAddress
      : undefined,
    privatentnahmeDate: typeof rawValue.privatentnahmeDate === 'string'
      && rawValue.privatentnahmeDate
      ? rawValue.privatentnahmeDate
      : undefined,
    last_update_time: Number.isFinite(legacyLastUpdateTime) ? legacyLastUpdateTime : 0,
    festgeschrieben: rawValue.festgeschrieben === 1 ? 1 : undefined,
    rechnungsNummer: typeof rawValue.rechnungsNummer === 'string' && rawValue.rechnungsNummer
      ? rawValue.rechnungsNummer
      : undefined,
    entnahmeBelegNummer: typeof rawValue.entnahmeBelegNummer === 'string'
      && rawValue.entnahmeBelegNummer
      ? rawValue.entnahmeBelegNummer
      : undefined,
    storageLocationId: typeof rawValue.storageLocationId === 'string' && rawValue.storageLocationId
      ? rawValue.storageLocationId
      : undefined,
    barcodes: Array.isArray(rawValue.barcodes) ? [...rawValue.barcodes] as string[] : undefined,
  } as Product;
};
