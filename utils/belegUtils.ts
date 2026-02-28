import { Product, BelegSettings, EuerSettings, ProductUsage } from '../types';
import { getEffectivePrivatentnahmeDate } from './dateUtils';
import { getProductBaseValue, isProductIgnoredForBelegAndEuer, getProductBookingFlow, ProductBookingEntry } from './euerUtils';

export const generateBelegTextForPdf = (
  product: Product,
  belegSettings: BelegSettings,
  euerSettings: EuerSettings,
  invoiceNumberToUse: string | undefined
): string => {
  if (isProductIgnoredForBelegAndEuer(product, euerSettings) && product.festgeschrieben !== 1) {
    return 'Streuartikel: Für dieses Produkt wird kein Beleg generiert.';
  }

  const { userData, recipientData } = belegSettings;
  const actualBelegValueSource = getProductBaseValue(product, euerSettings);
  if (actualBelegValueSource == null) {
    return `Fehler: Teilwert für Produkt ${product.ASIN} fehlt.`;
  }
  const actualBelegValue = actualBelegValueSource as number;

  if (!invoiceNumberToUse && product.festgeschrieben !== 1) {
    invoiceNumberToUse = product.rechnungsNummer ? product.rechnungsNummer : 'N/A (Nummer fehlt)';
  } else if (!invoiceNumberToUse && product.festgeschrieben === 1 && !product.rechnungsNummer) {
    invoiceNumberToUse = 'N/A (Bulk)';
  } else if (!invoiceNumberToUse && product.festgeschrieben === 1 && product.rechnungsNummer) {
    invoiceNumberToUse = product.rechnungsNummer;
  }

  const today = new Date().toLocaleDateString('de-DE');
  let text = `Proformarechnung\n`;
  text += `Rechnungsnummer: ${invoiceNumberToUse || 'N/A (Unbekannt)'}\n`;
  text += `Belegdatum: ${today}\n`;
  text += `Leistungsdatum: ${product.date}\n\n`;

  text += `Von:\n`;
  text += `${userData.nameOrCompany || '(Ihr Name/Firma)'}\n`;
  text += `${userData.addressLine1 || '(Ihre Straße Nr.)'}\n`;
  text += `${userData.addressLine2 || '(Ihre PLZ Ort)'}\n`;
  if (userData.vatId) text += `USt-IdNr.: ${userData.vatId}\n`;
  text += `\n`;

  text += `An (Leistungsempfänger):\n`;
  text += `${recipientData.companyName}\n`;
  text += `${recipientData.addressLine1}\n`;
  text += `${recipientData.addressLine2}\n`;
  text += `USt-IdNr.: ${recipientData.vatId}\n\n`;

  text += `Produkt:\n`;
  text += `${product.name} (ASIN: ${product.ASIN})\n\n`;

  text += `Leistung:\n`;
  text += `Schreiben einer Rezension für das genannte Produkt im Rahmen des Amazon Vine Programms.\n\n`;

  const nonPrivatentnahmeStatuses: ProductUsage[] = [
    ProductUsage.BETRIEBLICHE_NUTZUNG, ProductUsage.LAGER, ProductUsage.STORNIERT,
    ProductUsage.ENTSORGT, ProductUsage.VERKAUFT,
  ];
  const isPrivatentnahmeTextNeeded = !nonPrivatentnahmeStatuses.some(s => product.usageStatus.includes(s)) || product.usageStatus.includes(ProductUsage.PRIVATENTNAHME);

  if (isPrivatentnahmeTextNeeded) {
    const effectivePrivatentnahmeDate = getEffectivePrivatentnahmeDate(product, euerSettings);
    if (effectivePrivatentnahmeDate) {
      text += `Zeitpunkt der Privatentnahme nach Testabschluss: ${effectivePrivatentnahmeDate.toLocaleDateString('de-DE')}\n`;
    }
  }
  text += `\n`;

  if (product.myTeilwert != null && product.myTeilwertReason) {
    text += `Begründung für abweichenden Wert: ${product.myTeilwertReason}\n\n`;
  }

  text += `Wert der Leistung: ${actualBelegValue.toFixed(2)} EUR\n\n`;
  text += `Gesamtbetrag: ${actualBelegValue.toFixed(2)} EUR\n\n`;

  if (userData.isKleinunternehmer) {
    text += `Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.\n`;
  } else {
    text += `Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge).\n`;
  }
  text += `\n--------------------------------------\n`;
  text += `Dieser Beleg dient zur Dokumentation im Rahmen des Amazon Vine Programms.\n`;

  return text;
};

export const generateBulkBelegTextForPdf = (
  selectedProducts: Product[],
  belegSettings: BelegSettings,
  euerSettings: EuerSettings,
  invoiceNumber: string,
  performancePeriodStart: string,
  performancePeriodEnd: string
): string => {
  const { userData, recipientData } = belegSettings;
  const today = new Date().toLocaleDateString('de-DE');

  let text = `Proformarechnung (Sammelbeleg)\n`;
  text += `Rechnungsnummer: ${invoiceNumber}\n`;
  text += `Belegdatum: ${today}\n`;
  text += `Leistungszeitraum: ${performancePeriodStart} - ${performancePeriodEnd}\n\n`;

  text += `Von:\n`;
  text += `${userData.nameOrCompany || '(Ihr Name/Firma)'}\n`;
  text += `${userData.addressLine1 || '(Ihre Straße Nr.)'}\n`;
  text += `${userData.addressLine2 || '(Ihre PLZ Ort)'}\n`;
  if (userData.vatId) text += `USt-IdNr.: ${userData.vatId}\n`;
  text += `\n`;

  text += `An (Leistungsempfänger):\n`;
  text += `${recipientData.companyName}\n`;
  text += `${recipientData.addressLine1}\n`;
  text += `${recipientData.addressLine2}\n`;
  text += `USt-IdNr.: ${recipientData.vatId}\n\n`;

  text += `Leistung:\n`;
  text += `Schreiben von Rezensionen für die nachfolgend genannten Produkte im Rahmen des Amazon Vine Programms.\n\n`;

  text += `Abgerechnete Produkte:\n`;
  let totalValue = 0;
  for (const p of selectedProducts) {
    const einzelwertForBeleg = getProductBaseValue(p, euerSettings);
    if (einzelwertForBeleg == null) {
      return `Fehler: Teilwert für Produkt ${p.ASIN} fehlt.`;
    }
    totalValue += einzelwertForBeleg;
    text += `- Produkt: ${p.name.substring(0, 50)}${p.name.length > 50 ? '...' : ''} (ASIN: ${p.ASIN})\n`;
    text += `  Bestelldatum: ${p.date}, Einzelwert: ${einzelwertForBeleg.toFixed(2)} EUR\n`;
  }
  text += `\n`;

  text += `Gesamtwert der erbrachten Leistungen: ${totalValue.toFixed(2)} EUR\n\n`;
  text += `Gesamtbetrag: ${totalValue.toFixed(2)} EUR\n\n`;

  if (userData.isKleinunternehmer) {
    text += `Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.\n`;
  } else {
    text += `Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge).\n`;
  }
  text += `\n--------------------------------------\n`;
  text += `Dieser Beleg dient zur Dokumentation im Rahmen des Amazon Vine Programms.\n`;

  return text;
};

const formatBookingLines = (products: Product[], entriesByAsin: Map<string, ProductBookingEntry[]>, type: 'Ausgabe' | 'Entnahme') => {
  let lines = '';
  let sum = 0;
  products.forEach(p => {
    const entry = (entriesByAsin.get(p.ASIN) || []).find(e => e.type === type);
    if (!entry) return;
    sum += entry.amount;
    lines += `- ${p.name.substring(0, 40)}${p.name.length > 40 ? '...' : ''} (ASIN: ${p.ASIN})\n`;
    lines += `  Datum: ${entry.date.toLocaleDateString('de-DE')} | Betrag: ${entry.amount.toFixed(2)} EUR | Basis: ${entry.source}\n`;
  });
  return { lines, sum };
};

export const generateAusgabenBelegText = (
  products: Product[],
  belegSettings: BelegSettings,
  euerSettings: EuerSettings,
  invoiceNumber: string
): string => {
  const entriesByAsin = new Map(products.map(p => [p.ASIN, getProductBookingFlow(p, euerSettings)]));
  const { lines, sum } = formatBookingLines(products, entriesByAsin, 'Ausgabe');
  if (!lines) return 'Fehler: Für die gewählten Produkte existieren gemäß Einstellungen keine Ausgabenbuchungen.';

  const { userData, recipientData } = belegSettings;
  const today = new Date().toLocaleDateString('de-DE');
  let text = `Ausgabebeleg\n`;
  text += `Bezug auf Einnahmebeleg: ${invoiceNumber}\n`;
  text += `Belegnummer: ${invoiceNumber}-Ausgabebeleg\n`;
  text += `Erstellt am: ${today}\n\n`;
  text += `Von: ${userData.nameOrCompany || '(Ihr Name/Firma)'}\n`;
  text += `An: ${recipientData.companyName}\n\n`;
  text += `Erfasste Ausgabenpositionen:\n${lines}\n`;
  text += `Gesamtausgabe: ${sum.toFixed(2)} EUR\n`;
  return text;
};

export const generateEntnahmeBelegText = (
  products: Product[],
  euerSettings: EuerSettings,
  entnahmeBelegnummer: string
): string => {
  const entriesByAsin = new Map(products.map(p => [p.ASIN, getProductBookingFlow(p, euerSettings)]));
  const { lines, sum } = formatBookingLines(products, entriesByAsin, 'Entnahme');
  if (!lines) return 'Fehler: Für die gewählten Produkte existieren gemäß Einstellungen keine Entnahmebuchungen.';

  let text = `Entnahmebeleg\n`;
  text += `Entnahme-Belegnummer: ${entnahmeBelegnummer}\n`;
  text += `Erstellt am: ${new Date().toLocaleDateString('de-DE')}\n\n`;
  text += `Erfasste Entnahmepositionen:\n${lines}\n`;
  text += `Gesamt-Entnahme: ${sum.toFixed(2)} EUR\n`;
  return text;
};
