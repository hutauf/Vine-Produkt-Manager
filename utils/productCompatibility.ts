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

export const applyLegacyUsageFlags = (fields: ProductCompatibilityFields): ProductUsage[] => {
  let usageStatus = Array.isArray(fields.usageStatus)
    ? [...fields.usageStatus] as ProductUsage[]
    : [];

  LEGACY_USAGE_FIELDS.forEach(([field, status]) => {
    if (fields[field] === true && !usageStatus.includes(status)) {
      usageStatus.push(status);
    } else if (fields[field] === false) {
      usageStatus = usageStatus.filter(candidate => candidate !== status);
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
