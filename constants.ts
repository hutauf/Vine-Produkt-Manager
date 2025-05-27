
import { ProductUsage } from './types';

export const PRODUCT_USAGE_OPTIONS: ProductUsage[] = [
  ProductUsage.STORNIERT,
  ProductUsage.VERKAUFT,
  ProductUsage.ENTSORGT,
  ProductUsage.PRIVATENTNAHME,
  ProductUsage.LAGER,
  ProductUsage.DEFEKT,
  ProductUsage.BETRIEBLICHE_NUTZUNG,
];

export const DEFAULT_EUER_SETTINGS = {
  useTeilwertForIncome: false,
  homeOfficePauschale: 1260,
  streuArtikelLimitActive: false,
  streuArtikelLimitValue: 11.90,
  euerMethodETVInOutTeilwertEntnahme: false, // Default for new EÜR method
};

export const TAB_OPTIONS = {
  DASHBOARD: "Dashboard",
  EUER: "EÜR",
  LAGER: "Lager",
  VERKAUFE: "Verkäufe",
  SETTINGS: "Einstellungen",
};
