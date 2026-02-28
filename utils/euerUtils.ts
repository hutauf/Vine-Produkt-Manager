import { EuerSettings, Product, ProductUsage } from '../types';
import { getEffectivePrivatentnahmeDate, parseDMYtoDate } from './dateUtils';

export type BookingType = 'Einnahme' | 'Ausgabe' | 'Entnahme';

export interface BookingFlowEntry {
  type: BookingType;
  date: Date;
  amount: number;
  note: string;
}

export const getPreferredTeilwert = (product: Product): number | null => {
  return product.myTeilwert ?? product.teilwert;
};

export const getProductBaseValue = (product: Product, settings: EuerSettings): number | null => {
  const preferredTeilwert = getPreferredTeilwert(product);

  if (product.myTeilwert != null && product.myTeilwert > product.etv) {
    return product.myTeilwert;
  }

  if (settings.useTeilwertForIncome) {
    return preferredTeilwert;
  }

  return product.etv;
};

export const getEntnahmeValue = (product: Product, settings: EuerSettings): number => {
  return getPreferredTeilwert(product) ?? getProductBaseValue(product, settings) ?? 0;
};

export const isProductIgnoredByStreuartikel = (product: Product, settings: EuerSettings): boolean => {
  if (!settings.streuArtikelLimitActive) return false;
  return product.etv === 0 || product.etv < settings.streuArtikelLimitValue;
};

export const isProductIgnoredByETVZeroSetting = (product: Product, settings: EuerSettings): boolean => {
  return !settings.streuArtikelLimitActive && settings.ignoreETVZeroProducts && product.etv === 0;
};

export const isProductIgnoredForBelegAndEuer = (product: Product, settings: EuerSettings): boolean => {
  return isProductIgnoredByStreuartikel(product, settings) || isProductIgnoredByETVZeroSetting(product, settings);
};

export const getBookingFlowEntries = (product: Product, settings: EuerSettings): BookingFlowEntry[] => {
  const orderDate = parseDMYtoDate(product.date);
  if (!orderDate || product.usageStatus.includes(ProductUsage.STORNIERT) || isProductIgnoredForBelegAndEuer(product, settings)) {
    return [];
  }

  const baseValue = getProductBaseValue(product, settings) ?? 0;
  const entnahmeValue = getEntnahmeValue(product, settings);
  const effectivePrivatentnahmeDate = getEffectivePrivatentnahmeDate(product, settings);
  const privatentnahmeYear = effectivePrivatentnahmeDate?.getFullYear();
  const orderYear = orderDate.getFullYear();

  const isPrivatentnahmeOrDefault = product.usageStatus.includes(ProductUsage.PRIVATENTNAHME) || !product.usageStatus.length;
  const isPrivateOnlyModeApplicable = settings.privatentnahmeSameYearAsOnlyIncome &&
    product.usageStatus.includes(ProductUsage.PRIVATENTNAHME) &&
    privatentnahmeYear != null &&
    privatentnahmeYear === orderYear;

  if (isPrivateOnlyModeApplicable) {
    return [{ type: 'Einnahme', date: orderDate, amount: baseValue, note: settings.useTeilwertForIncome ? 'Teilwert' : 'ETV' }];
  }

  const entries: BookingFlowEntry[] = [{ type: 'Einnahme', date: orderDate, amount: baseValue, note: settings.useTeilwertForIncome ? 'Teilwert' : 'ETV' }];

  if (settings.euerMethodETVInOutTeilwertEntnahme) {
    entries.push({ type: 'Ausgabe', date: orderDate, amount: baseValue, note: settings.useTeilwertForIncome ? 'Teilwert' : 'ETV' });

    const noEntnahmeBecauseBusinessUsage =
      product.usageStatus.includes(ProductUsage.LAGER) || product.usageStatus.includes(ProductUsage.BETRIEBLICHE_NUTZUNG);

    if (isPrivatentnahmeOrDefault && !noEntnahmeBecauseBusinessUsage && effectivePrivatentnahmeDate) {
      entries.push({ type: 'Entnahme', date: effectivePrivatentnahmeDate, amount: entnahmeValue, note: 'Teilwert' });
    }

    return entries;
  }

  const hasExpenseInLegacy =
    product.usageStatus.includes(ProductUsage.BETRIEBLICHE_NUTZUNG) ||
    product.usageStatus.includes(ProductUsage.LAGER) ||
    product.usageStatus.includes(ProductUsage.ENTSORGT) ||
    product.usageStatus.includes(ProductUsage.VERKAUFT);

  if (hasExpenseInLegacy) {
    entries.push({ type: 'Ausgabe', date: orderDate, amount: baseValue, note: settings.useTeilwertForIncome ? 'Teilwert' : 'ETV' });
  }

  if (isPrivatentnahmeOrDefault && effectivePrivatentnahmeDate) {
    entries.push({ type: 'Entnahme', date: effectivePrivatentnahmeDate, amount: entnahmeValue, note: settings.useTeilwertForIncome ? 'Teilwert' : 'ETV' });
  }

  return entries;
};
