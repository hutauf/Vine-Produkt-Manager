
import { ProductUsage, EuerSettings, UserAddressData, RecipientAddressData, BelegSettings } from './types';

export const PRODUCT_USAGE_OPTIONS: ProductUsage[] = [
  ProductUsage.STORNIERT,
  ProductUsage.VERKAUFT,
  ProductUsage.ENTSORGT,
  ProductUsage.PRIVATENTNAHME,
  ProductUsage.LAGER,
  ProductUsage.DEFEKT,
  ProductUsage.BETRIEBLICHE_NUTZUNG,
];

export const DEFAULT_PRIVATENTNAHME_DELAY_OPTIONS = [
  { value: "0d", label: "Bestelldatum" },
  { value: "1d", label: "1 Tag nach Bestellung" },
  { value: "7d", label: "1 Woche nach Bestellung" },
  { value: "14d", label: "2 Wochen nach Bestellung" },
  { value: "28d", label: "4 Wochen nach Bestellung" },
  { value: "90d", label: "3 Monate nach Bestellung" },
  { value: "180d", label: "6 Monate nach Bestellung" },
];

export const DEFAULT_EUER_SETTINGS: EuerSettings = {
  useTeilwertForIncome: false,
  homeOfficePauschale: 1260,
  streuArtikelLimitActive: false,
  streuArtikelLimitValue: 11.90,
  euerMethodETVInOutTeilwertEntnahme: false, // Default for new EÜR method
  defaultPrivatentnahmeDelay: "14d", // Default to 2 weeks
  ignoreETVZeroProducts: false, 
  useTeilwertV2: false, // Default for Teilwert v2 source
};

export const TAB_OPTIONS = {
  DASHBOARD: "Dashboard",
  EUER: "EÜR",
  VERMOEGEN: "Vermögen", // Changed from LAGER
  VERKAUFE: "Verkäufe",
  BELEGE: "Belege", 
  SETTINGS: "Einstellungen",
};

export const DEFAULT_USER_ADDRESS_DATA: UserAddressData = {
  nameOrCompany: '',
  addressLine1: '',
  addressLine2: '',
  vatId: '',
  isKleinunternehmer: true,
};

export const DEFAULT_RECIPIENT_ADDRESS_DATA: RecipientAddressData = {
  companyName: 'Amazon EU S.à r.l. (Société à responsabilité limitée)',
  addressLine1: '38 avenue John F. Kennedy',
  addressLine2: 'L-1855 Luxemburg',
  vatId: 'LU 20260743',
};

export const DEFAULT_BELEG_SETTINGS: BelegSettings = {
    userData: DEFAULT_USER_ADDRESS_DATA,
    recipientData: DEFAULT_RECIPIENT_ADDRESS_DATA,
};

export const BELEG_SETTINGS_STORAGE_KEY = 'vineApp_belegSettings';
export const DEFAULT_API_BASE_URL = "https://hutaufvine.pythonanywhere.com/data_operations";
export const API_BASE_URL_STORAGE_KEY = 'vineApp_apiBaseUrl';export const ADDITIONAL_EXPENSES_STORAGE_KEY = 'vineApp_additionalExpenses';