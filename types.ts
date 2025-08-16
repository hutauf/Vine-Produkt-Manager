
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
  teilwert: number | null; 
  teilwert_v2: number | null; 
  pdf?: string;
  myTeilwert?: number | null;
  myTeilwertReason?: string;
  usageStatus: ProductUsage[]; // Multiple statuses possible
  salePrice?: number | null;
  saleDate?: string; // Format: TT.MM.JJJJ (Sale Date)
  buyerAddress?: string; // Optional buyer address
  privatentnahmeDate?: string; // Format: TT.MM.JJJJ (Private Withdrawal Date)
  last_update_time?: number; // Unix timestamp (integer seconds) from server
  festgeschrieben?: 1;
  rechnungsNummer?: string;
}

export interface EuerSettings {
  useTeilwertForIncome: boolean;
  homeOfficePauschale: number;
  streuArtikelLimitActive: boolean;
  streuArtikelLimitValue: number; // e.g., 11.90 or 10
  euerMethodETVInOutTeilwertEntnahme: boolean; // New EÜR calculation method
  defaultPrivatentnahmeDelay: string; // e.g., "0d", "7d", "14d", "28d", "90d", "180d"
  ignoreETVZeroProducts: boolean; // New setting
  useTeilwertV2: boolean; // New setting for Teilwert v2 source
}

export interface UserAddressData {
  nameOrCompany: string;
  addressLine1: string;
  addressLine2: string;
  vatId: string;
  isKleinunternehmer: boolean;
}

export interface RecipientAddressData {
  companyName: string;
  addressLine1: string;
  addressLine2: string;
  country?: string;
  vatId: string;
}

export interface BelegSettings {
  userData: UserAddressData;
  recipientData: RecipientAddressData;
}

export interface SalesPageProps {
  products: Product[];
  onUpdateProduct: (product: Product) => Promise<void>;
  euerSettings: EuerSettings;
  belegSettings: BelegSettings;
}

export interface AdditionalExpense {
  id: string;
  date: string; // TT.MM.JJJJ
  name: string;
  amount: number;
}

export interface VermoegenPageProps {
  products: Product[];
  additionalExpenses: AdditionalExpense[];
  onAddExpense: (expense: Omit<AdditionalExpense, 'id'>) => void;
  onDeleteExpense: (id: string) => void;
  onUpdateProduct: (product: Product) => Promise<void>;
  euerSettings: EuerSettings;
  belegSettings: BelegSettings;
}

export interface EuerPageProps {
  products: Product[];
  settings: EuerSettings;
  onSettingsChange: (settings: EuerSettings) => void;
  additionalExpenses: AdditionalExpense[]; // Added for EÜR calculation
}