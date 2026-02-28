import { EuerSettings, Product, ProductUsage } from '../types';
import { getEffectivePrivatentnahmeDate, parseDMYtoDate, parseGermanDate } from './dateUtils';

export type BookingType = 'Einnahme' | 'Ausgabe' | 'Entnahme' | 'Verkauf';

export interface ProductBookingEntry {
  type: BookingType;
  date: Date;
  amount: number;
  source: 'ETV' | 'Teilwert' | 'Verkaufspreis';
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

export const getProductBookingFlow = (product: Product, settings: EuerSettings): ProductBookingEntry[] => {
  if (isProductIgnoredForBelegAndEuer(product, settings)) return [];

  const orderDate = parseDMYtoDate(product.date);
  if (!orderDate || product.usageStatus.includes(ProductUsage.STORNIERT)) return [];

  const baseValue = getProductBaseValue(product, settings) ?? 0;
  const entnahmeValue = getPreferredTeilwert(product) ?? baseValue;
  const entries: ProductBookingEntry[] = [];

  const effectivePrivatentnahmeDate = getEffectivePrivatentnahmeDate(product, settings);
  const privatentnahmeSameYear = !!effectivePrivatentnahmeDate && effectivePrivatentnahmeDate.getFullYear() === orderDate.getFullYear();
  const isPrivatentnahme = product.usageStatus.includes(ProductUsage.PRIVATENTNAHME) || !product.usageStatus.length;
  const isLagerOderBetrieblich = product.usageStatus.includes(ProductUsage.LAGER) || product.usageStatus.includes(ProductUsage.BETRIEBLICHE_NUTZUNG);

  if (settings.privatentnahmeSameYearAsOnlyIncome && product.usageStatus.includes(ProductUsage.PRIVATENTNAHME) && privatentnahmeSameYear) {
    entries.push({
      type: 'Einnahme',
      date: orderDate,
      amount: baseValue,
      source: settings.useTeilwertForIncome || (product.myTeilwert != null && product.myTeilwert > product.etv) ? 'Teilwert' : 'ETV',
    });
  } else if (settings.euerMethodETVInOutTeilwertEntnahme) {
    entries.push({
      type: 'Einnahme',
      date: orderDate,
      amount: baseValue,
      source: settings.useTeilwertForIncome || (product.myTeilwert != null && product.myTeilwert > product.etv) ? 'Teilwert' : 'ETV',
    });
    entries.push({
      type: 'Ausgabe',
      date: orderDate,
      amount: baseValue,
      source: settings.useTeilwertForIncome || (product.myTeilwert != null && product.myTeilwert > product.etv) ? 'Teilwert' : 'ETV',
    });

    if (effectivePrivatentnahmeDate && isPrivatentnahme && !isLagerOderBetrieblich) {
      entries.push({
        type: 'Entnahme',
        date: effectivePrivatentnahmeDate,
        amount: entnahmeValue,
        source: 'Teilwert',
      });
    }
  } else {
    if (
      product.usageStatus.includes(ProductUsage.LAGER) ||
      product.usageStatus.includes(ProductUsage.BETRIEBLICHE_NUTZUNG) ||
      product.usageStatus.includes(ProductUsage.ENTSORGT) ||
      product.usageStatus.includes(ProductUsage.VERKAUFT) ||
      isPrivatentnahme
    ) {
      entries.push({
        type: 'Einnahme',
        date: orderDate,
        amount: baseValue,
        source: settings.useTeilwertForIncome || (product.myTeilwert != null && product.myTeilwert > product.etv) ? 'Teilwert' : 'ETV',
      });
    }

    if (product.usageStatus.includes(ProductUsage.BETRIEBLICHE_NUTZUNG) || product.usageStatus.includes(ProductUsage.LAGER) || product.usageStatus.includes(ProductUsage.ENTSORGT) || product.usageStatus.includes(ProductUsage.VERKAUFT)) {
      entries.push({
        type: 'Ausgabe',
        date: orderDate,
        amount: baseValue,
        source: settings.useTeilwertForIncome || (product.myTeilwert != null && product.myTeilwert > product.etv) ? 'Teilwert' : 'ETV',
      });
    }
  }

  if (product.usageStatus.includes(ProductUsage.VERKAUFT) && product.salePrice != null && product.saleDate) {
    const saleDate = parseGermanDate(product.saleDate);
    if (saleDate) {
      entries.push({
        type: 'Verkauf',
        date: saleDate,
        amount: product.salePrice,
        source: 'Verkaufspreis',
      });
    }
  }

  return entries.sort((a, b) => a.date.getTime() - b.date.getTime());
};
