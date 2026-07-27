import { ProductUsage } from '../types';

export interface ProductCompatibilityFields {
  usageStatus?: unknown;
  myTeilwert?: unknown;
  myteilwert?: unknown;
  verkauft?: unknown;
  lager?: unknown;
  entsorgt?: unknown;
  storniert?: unknown;
  betriebsausgabe?: unknown;
}

const LEGACY_USAGE_FIELDS = [
  ['verkauft', ProductUsage.VERKAUFT],
  ['lager', ProductUsage.LAGER],
  ['entsorgt', ProductUsage.ENTSORGT],
  ['storniert', ProductUsage.STORNIERT],
  ['betriebsausgabe', ProductUsage.BETRIEBLICHE_NUTZUNG],
] as const;

export const getPreferredMyTeilwert = (fields: ProductCompatibilityFields): unknown =>
  Object.prototype.hasOwnProperty.call(fields, 'myteilwert')
    ? fields.myteilwert
    : fields.myTeilwert;

/**
 * Resolve legacy boolean usage flags into the canonical usageStatus list.
 *
 * Precedence rules:
 * 1. A non-empty usageStatus list is authoritative. Legacy booleans must not
 *    remove or add statuses in that case.
 * 2. If usageStatus is missing or empty, true legacy booleans are used to
 *    reconstruct the list.
 * 3. false legacy booleans never remove entries from the canonical list.
 */
export const applyLegacyUsageFlags = (fields: ProductCompatibilityFields): ProductUsage[] => {
  if (Array.isArray(fields.usageStatus) && fields.usageStatus.length > 0) {
    return [...new Set(fields.usageStatus as ProductUsage[])];
  }

  const usageStatus: ProductUsage[] = [];
  LEGACY_USAGE_FIELDS.forEach(([field, status]) => {
    if (fields[field] === true && !usageStatus.includes(status)) {
      usageStatus.push(status);
    }
  });

  return usageStatus;
};

export const usageStatusToLegacyFlags = (usageStatus: ProductUsage[]) => ({
  verkauft: usageStatus.includes(ProductUsage.VERKAUFT),
  lager: usageStatus.includes(ProductUsage.LAGER),
  entsorgt: usageStatus.includes(ProductUsage.ENTSORGT),
  storniert: usageStatus.includes(ProductUsage.STORNIERT),
  betriebsausgabe: usageStatus.includes(ProductUsage.BETRIEBLICHE_NUTZUNG),
});
