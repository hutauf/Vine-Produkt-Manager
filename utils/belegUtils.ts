import { Product, BelegSettings, EuerSettings, ProductUsage } from '../types';
import { getEffectivePrivatentnahmeDate } from './dateUtils';
import { getProductBaseValue, isProductIgnoredByStreuartikel } from './euerUtils';
import { formatBookingDate, getProductBookingEntries } from './bookingUtils';

export const generateBelegTextForPdf = (
  product: Product,
  belegSettings: BelegSettings,
  euerSettings: EuerSettings,
  invoiceNumberToUse: string | undefined
): string => {
  if (isProductIgnoredByStreuartikel(product, euerSettings) && product.festgeschrieben !== 1) {
      return "Streuartikel: Für dieses Produkt wird kein Beleg generiert.";
  }

  const { userData, recipientData } = belegSettings;
  const actualBelegValueSource = getProductBaseValue(product, euerSettings);
  if (actualBelegValueSource == null) {
    return `Fehler: Teilwert für Produkt ${product.ASIN} fehlt.`;
  }
  const actualBelegValue = actualBelegValueSource as number;

  if (!invoiceNumberToUse && product.festgeschrieben !== 1) {
    invoiceNumberToUse = product.rechnungsNummer ? product.rechnungsNummer : "N/A (Nummer fehlt)";
  } else if (!invoiceNumberToUse && product.festgeschrieben === 1 && !product.rechnungsNummer) {
    invoiceNumberToUse = "N/A (Bulk)";
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
    const EinzelwertForBeleg = getProductBaseValue(p, euerSettings);
    if (EinzelwertForBeleg == null) {
      return `Fehler: Teilwert für Produkt ${p.ASIN} fehlt.`;
    }
    totalValue += EinzelwertForBeleg;
    text += `- Produkt: ${p.name.substring(0, 50)}${p.name.length > 50 ? '...' : ''} (ASIN: ${p.ASIN})\n`;
    text += `  Bestelldatum: ${p.date}, Einzelwert: ${EinzelwertForBeleg.toFixed(2)} EUR\n`;
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

const buildSideReceipt = (
  products: Product[],
  belegSettings: BelegSettings,
  euerSettings: EuerSettings,
  invoiceNumber: string,
  type: 'Ausgabe' | 'Entnahme'
): string => {
  const { userData, recipientData } = belegSettings;
  const today = new Date().toLocaleDateString('de-DE');
  const rows: { product: Product; amount: number; date: Date; }[] = [];

  products.forEach(product => {
    const relevant = getProductBookingEntries(product, euerSettings)
      .filter(entry => entry.type === type && entry.receiptRelevant);
    relevant.forEach(entry => rows.push({ product, amount: entry.amount, date: entry.date }));
  });

  if (!rows.length) {
    return `Fehler: Keine ${type}-Buchungen für die gewählten Produkte vorhanden.`;
  }

  let text = `${type}beleg\n`;
  text += `Belegnummer: ${invoiceNumber}\n`;
  text += `Belegdatum: ${today}\n\n`;
  text += `Von:\n${userData.nameOrCompany || '(Ihr Name/Firma)'}\n${userData.addressLine1 || '(Ihre Straße Nr.)'}\n${userData.addressLine2 || '(Ihre PLZ Ort)'}\n\n`;
  text += `An (Leistungsempfänger):\n${recipientData.companyName}\n${recipientData.addressLine1}\n${recipientData.addressLine2}\n\n`;
  text += `Enthaltene Produkte:\n`;

  let total = 0;
  rows.forEach(row => {
    total += row.amount;
    text += `- ${row.product.name.substring(0, 50)}${row.product.name.length > 50 ? '...' : ''} (ASIN: ${row.product.ASIN})\n`;
    text += `  Datum: ${formatBookingDate(row.date)}, Betrag: ${row.amount.toFixed(2)} EUR\n`;
  });

  text += `\nGesamtbetrag ${type}: ${total.toFixed(2)} EUR\n`;
  text += `\n--------------------------------------\n`;
  text += `Dieser Beleg dient zur Dokumentation der ${type.toLowerCase()}-Buchung im Rahmen des Amazon Vine Programms.\n`;
  return text;
};

export const generateAusgabeBelegTextForPdf = (
  products: Product[],
  belegSettings: BelegSettings,
  euerSettings: EuerSettings,
  invoiceNumber: string
): string => buildSideReceipt(products, belegSettings, euerSettings, invoiceNumber, 'Ausgabe');

export const generateEntnahmeBelegTextForPdf = (
  products: Product[],
  belegSettings: BelegSettings,
  euerSettings: EuerSettings,
  invoiceNumber: string
): string => buildSideReceipt(products, belegSettings, euerSettings, invoiceNumber, 'Entnahme');
