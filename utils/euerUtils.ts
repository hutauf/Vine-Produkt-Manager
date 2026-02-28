import { EuerSettings, Product, ProductUsage } from '../types';
import { getEffectivePrivatentnahmeDate } from './dateUtils';

export type BookingType = 'einnahme' | 'ausgabe' | 'entnahme' | 'verkauf';

export interface BookingFlowEntry {
  type: BookingType;
  date: Date;
  amount: number;
  label: string;
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

export const getBookingFlowForProduct = (product: Product, settings: EuerSettings): BookingFlowEntry[] => {
  if (product.usageStatus.includes(ProductUsage.STORNIERT)) return [];
  if (isProductIgnoredForBelegAndEuer(product, settings)) return [];

  const orderDateParts = product.date?.split('/').map(Number);
  if (!orderDateParts || orderDateParts.length !== 3) return [];

  const orderDate = new Date(orderDateParts[2], orderDateParts[1] - 1, orderDateParts[0]);
  if (isNaN(orderDate.getTime())) return [];

  const baseValue = getProductBaseValue(product, settings) ?? 0;
  const teilwertValue = getPreferredTeilwert(product) ?? baseValue;
  const effectivePrivatentnahme = getEffectivePrivatentnahmeDate(product, settings);

  const isPrivatentnahmeOnly = product.usageStatus.includes(ProductUsage.PRIVATENTNAHME);
  const isLagerOrBusiness = product.usageStatus.includes(ProductUsage.LAGER) || product.usageStatus.includes(ProductUsage.BETRIEBLICHE_NUTZUNG);
  const sameYearPrivatentnahme = effectivePrivatentnahme != null && effectivePrivatentnahme.getFullYear() === orderDate.getFullYear();

  const shouldOnlyBookIncome = settings.privatentnahmeSameYearAsOnlyIncome && isPrivatentnahmeOnly && sameYearPrivatentnahme;

  const flow: BookingFlowEntry[] = [];

  if (shouldOnlyBookIncome) {
    flow.push({ type: 'einnahme', date: orderDate, amount: baseValue, label: 'Einnahme' });
  } else if (settings.euerMethodETVInOutTeilwertEntnahme) {
    flow.push({ type: 'einnahme', date: orderDate, amount: baseValue, label: 'Einnahme' });
    flow.push({ type: 'ausgabe', date: orderDate, amount: baseValue, label: 'Ausgabe' });

    if ((isPrivatentnahmeOnly || product.usageStatus.length === 0) && !isLagerOrBusiness && effectivePrivatentnahme) {
      flow.push({ type: 'entnahme', date: effectivePrivatentnahme, amount: teilwertValue, label: 'Entnahme' });
    }
  } else {
    const hasClassicIncome = product.usageStatus.includes(ProductUsage.LAGER) ||
      product.usageStatus.includes(ProductUsage.BETRIEBLICHE_NUTZUNG) ||
      product.usageStatus.includes(ProductUsage.ENTSORGT) ||
      product.usageStatus.includes(ProductUsage.VERKAUFT) ||
      isPrivatentnahmeOnly ||
      product.usageStatus.length === 0;

    if (hasClassicIncome) {
      const dateForIncome = isPrivatentnahmeOnly && effectivePrivatentnahme ? effectivePrivatentnahme : orderDate;
      flow.push({ type: 'einnahme', date: dateForIncome, amount: baseValue, label: 'Einnahme' });
    }

    if (product.usageStatus.includes(ProductUsage.LAGER) || product.usageStatus.includes(ProductUsage.BETRIEBLICHE_NUTZUNG) || product.usageStatus.includes(ProductUsage.ENTSORGT) || product.usageStatus.includes(ProductUsage.VERKAUFT)) {
      flow.push({ type: 'ausgabe', date: orderDate, amount: baseValue, label: 'Ausgabe' });
    }
  }

  if (product.usageStatus.includes(ProductUsage.VERKAUFT) && product.salePrice != null && product.saleDate) {
    const saleParts = product.saleDate.split('.').map(Number);
    if (saleParts.length === 3) {
      const saleDate = new Date(saleParts[2], saleParts[1] - 1, saleParts[0]);
      if (!isNaN(saleDate.getTime())) {
        flow.push({ type: 'verkauf', date: saleDate, amount: product.salePrice, label: 'Verkauf' });
      }
    }
  }

  return flow;
};
