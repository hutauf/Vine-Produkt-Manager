
export enum ProductUsage {
  STORNIERT = "storniert", // cancelled
  VERKAUFT = "verkauft",   // sold
  ENTSORGT = "entsorgt",   // disposed
  PRIVATENTNAHME = "Privatentnahme", // private use
  LAGER = "Lager",       // inventory
  DEFEKT = "defekt",       // defective
  BETRIEBLICHE_NUTZUNG = "betriebliche Nutzung", // business use
}

export interface Product {
  ASIN: string;
  name: string;
  ordernumber: string;
  date: string; // Format: DD/MM/YYYY (Order Date)
  etv: number;
  keepa?: number | null;
  teilwert: number;
  pdf?: string;
  myTeilwert?: number | null;
  myTeilwertReason?: string;
  usageStatus: ProductUsage[]; // Multiple statuses possible
  salePrice?: number | null;
  saleDate?: string; // Format: TT.MM.JJJJ (Sale Date)
  buyerAddress?: string; // Optional buyer address
  last_update_time?: number; // Unix timestamp (integer seconds) from server
}

export interface EuerSettings {
  useTeilwertForIncome: boolean;
  homeOfficePauschale: number;
  streuArtikelLimitActive: boolean;
  streuArtikelLimitValue: number; // e.g., 11.90 or 10
  euerMethodETVInOutTeilwertEntnahme: boolean; // New EÜR calculation method
}
