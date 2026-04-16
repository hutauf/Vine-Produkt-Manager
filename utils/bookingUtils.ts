import { EuerSettings, Product, ProductUsage } from '../types';
import { getEffectivePrivatentnahmeDate, parseDMYtoDate } from './dateUtils';
import { getPreferredTeilwert, getProductBaseValue, isProductIgnoredForBelegAndEuer } from './euerUtils';

export type BookingType = 'Einnahme' | 'Ausgabe' | 'Entnahme' | 'Verkauf';

export interface ProductBookingEntry {
  type: BookingType;
  date: Date;
  amount: number | null;
  label: string;
  receiptRelevant: boolean;
}

export const getProductBookingEntries = (product: Product, settings: EuerSettings): ProductBookingEntry[] => {
  const orderDate = parseDMYtoDate(product.date);
  if (!orderDate || isProductIgnoredForBelegAndEuer(product, settings)) return [];
  if (product.usageStatus.includes(ProductUsage.STORNIERT)) return [];

  const baseValue = getProductBaseValue(product, settings);

  const entries: ProductBookingEntry[] = [];
  const effectivePrivatentnahmeDate = getEffectivePrivatentnahmeDate(product, settings);
  const entnahmeValue = getPreferredTeilwert(product) ?? baseValue;
  const isPrivatentnahmeOrDefault = product.usageStatus.includes(ProductUsage.PRIVATENTNAHME) || !product.usageStatus.length;
  const isLagerOrBusiness = product.usageStatus.includes(ProductUsage.LAGER) || product.usageStatus.includes(ProductUsage.BETRIEBLICHE_NUTZUNG);
  const sameYearPrivateOnlyMode = Boolean(
    settings.privatentnahmeSameYearAsOnlyIncome &&
    isPrivatentnahmeOrDefault &&
    effectivePrivatentnahmeDate &&
    effectivePrivatentnahmeDate.getUTCFullYear() === orderDate.getUTCFullYear()
  );

  if (sameYearPrivateOnlyMode) {
    entries.push({ type: 'Einnahme', date: orderDate, amount: baseValue, label: 'Basiswert', receiptRelevant: true });
  } else if (settings.euerMethodETVInOutTeilwertEntnahme) {
    entries.push({ type: 'Einnahme', date: orderDate, amount: baseValue, label: 'Basiswert', receiptRelevant: true });
    entries.push({ type: 'Ausgabe', date: orderDate, amount: baseValue, label: 'Basiswert', receiptRelevant: true });

    if (isPrivatentnahmeOrDefault && !isLagerOrBusiness && effectivePrivatentnahmeDate) {
      entries.push({ type: 'Entnahme', date: effectivePrivatentnahmeDate, amount: entnahmeValue ?? null, label: 'Teilwert', receiptRelevant: true });
    }
  } else {
    const isOrderIncomeStatus = product.usageStatus.includes(ProductUsage.LAGER) ||
      product.usageStatus.includes(ProductUsage.BETRIEBLICHE_NUTZUNG) ||
      product.usageStatus.includes(ProductUsage.ENTSORGT) ||
      product.usageStatus.includes(ProductUsage.VERKAUFT);

    if (isOrderIncomeStatus) {
      entries.push({ type: 'Einnahme', date: orderDate, amount: baseValue, label: 'Basiswert', receiptRelevant: true });
    }

    if (isPrivatentnahmeOrDefault && effectivePrivatentnahmeDate) {
      entries.push({ type: 'Einnahme', date: effectivePrivatentnahmeDate, amount: baseValue, label: 'Basiswert', receiptRelevant: true });
    }

    if (product.usageStatus.includes(ProductUsage.BETRIEBLICHE_NUTZUNG)) {
      entries.push({ type: 'Ausgabe', date: orderDate, amount: baseValue, label: 'Basiswert', receiptRelevant: true });
    } else if (
      product.usageStatus.includes(ProductUsage.LAGER) ||
      product.usageStatus.includes(ProductUsage.ENTSORGT) ||
      product.usageStatus.includes(ProductUsage.VERKAUFT)
    ) {
      entries.push({ type: 'Ausgabe', date: orderDate, amount: baseValue, label: 'Basiswert', receiptRelevant: true });
    }
  }

  if (product.usageStatus.includes(ProductUsage.VERKAUFT) && product.saleDate && product.salePrice != null) {
    const [d, m, y] = product.saleDate.split('.').map(Number);
    const saleDate = new Date(Date.UTC(y, m - 1, d));
    if (!Number.isNaN(saleDate.getTime())) {
      entries.push({ type: 'Verkauf', date: saleDate, amount: product.salePrice, label: 'Verkaufspreis', receiptRelevant: false });
    }
  }

  return entries.sort((a, b) => a.date.getTime() - b.date.getTime());
};

export const formatBookingDate = (date: Date): string => date.toLocaleDateString('de-DE');
