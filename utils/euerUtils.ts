import { EuerSettings, Product } from '../types';

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
