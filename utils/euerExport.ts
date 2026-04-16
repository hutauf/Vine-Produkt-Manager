import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import { EuerSettings, Product, ProductUsage } from '../types';
import { parseGermanDate } from './dateUtils';
import { getProductBookingEntries } from './bookingUtils';
import { isProductIgnoredForBelegAndEuer } from './euerUtils';

export interface EuerExportRow {
  ASIN: string;
  Name: string;
  ETV: number;
  Teilwert: number | null;
  Bestelldatum: string;
  Status: string;
  Einnahmen_aus_Verkaeufen: number;
  Einnahmen_Produktzugaenge: number;
  Einnahmen_Privatentnahmen: number;
  Ausgaben_Anlagevermoegen: number;
  Ausgaben_Umlaufvermoegen: number;
}

const asCurrency = (value: number): string =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);

const round2 = (value: number): number => Math.round(value * 100) / 100;

export const buildEuerExportRows = (
  products: Product[],
  settings: EuerSettings,
  selectedYear: string
): EuerExportRow[] => {
  const rows: EuerExportRow[] = [];

  products.forEach((product) => {
    if (isProductIgnoredForBelegAndEuer(product, settings)) return;

    let einnahmenAusVerkaeufen = 0;
    let einnahmenProduktzugaenge = 0;
    let einnahmenPrivatentnahmen = 0;
    let ausgabenAnlagevermoegen = 0;
    let ausgabenUmlaufvermoegen = 0;

    const entries = getProductBookingEntries(product, settings);
    entries.forEach((entry) => {
      if (entry.amount == null) return;
      if (entry.date.getUTCFullYear().toString() !== selectedYear) return;

      if (entry.type === 'Einnahme') {
        einnahmenProduktzugaenge += entry.amount;
      } else if (entry.type === 'Entnahme') {
        einnahmenPrivatentnahmen += entry.amount;
      } else if (entry.type === 'Ausgabe') {
        if (product.usageStatus.includes(ProductUsage.BETRIEBLICHE_NUTZUNG)) {
          ausgabenAnlagevermoegen += entry.amount;
        } else if (
          product.usageStatus.includes(ProductUsage.LAGER) ||
          product.usageStatus.includes(ProductUsage.VERKAUFT) ||
          product.usageStatus.includes(ProductUsage.ENTSORGT)
        ) {
          ausgabenUmlaufvermoegen += entry.amount;
        } else {
          ausgabenAnlagevermoegen += entry.amount;
        }
      }
    });

    if (
      product.usageStatus.includes(ProductUsage.VERKAUFT) &&
      product.salePrice != null &&
      product.saleDate
    ) {
      const saleDate = parseGermanDate(product.saleDate);
      if (saleDate && saleDate.getFullYear().toString() === selectedYear) {
        einnahmenAusVerkaeufen += product.salePrice;
      }
    }

    const contributes =
      einnahmenAusVerkaeufen !== 0 ||
      einnahmenProduktzugaenge !== 0 ||
      einnahmenPrivatentnahmen !== 0 ||
      ausgabenAnlagevermoegen !== 0 ||
      ausgabenUmlaufvermoegen !== 0;

    if (!contributes) return;

    rows.push({
      ASIN: product.ASIN,
      Name: product.name,
      ETV: product.etv,
      Teilwert: product.myTeilwert ?? product.teilwert ?? product.teilwert_v2 ?? null,
      Bestelldatum: product.date,
      Status: product.usageStatus.join(', '),
      Einnahmen_aus_Verkaeufen: round2(einnahmenAusVerkaeufen),
      Einnahmen_Produktzugaenge: round2(einnahmenProduktzugaenge),
      Einnahmen_Privatentnahmen: round2(einnahmenPrivatentnahmen),
      Ausgaben_Anlagevermoegen: round2(ausgabenAnlagevermoegen),
      Ausgaben_Umlaufvermoegen: round2(ausgabenUmlaufvermoegen),
    });
  });

  return rows.sort((a, b) => a.ASIN.localeCompare(b.ASIN));
};

export const exportEuerRowsToXlsx = (rows: EuerExportRow[], selectedYear: string): void => {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, `EÜR ${selectedYear}`);

  const keys = Object.keys(rows[0] || {});
  worksheet['!cols'] = keys.map((key) => {
    const maxValueLength = Math.max(
      key.length,
      ...rows.map((row) => String(row[key as keyof EuerExportRow] ?? '').length)
    );
    return { wch: Math.min(maxValueLength + 2, 50) };
  });

  XLSX.writeFile(workbook, `EUER_Detail_${selectedYear}.xlsx`);
};

export const exportEuerRowsToPdf = (rows: EuerExportRow[], selectedYear: string): void => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 10;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const lineHeight = 6;

  const columns = [
    { key: 'ASIN', title: 'ASIN', width: 28 },
    { key: 'ETV', title: 'ETV', width: 20 },
    { key: 'Einnahmen_aus_Verkaeufen', title: 'Verkauf', width: 24 },
    { key: 'Einnahmen_Produktzugaenge', title: 'Produktzug.', width: 28 },
    { key: 'Einnahmen_Privatentnahmen', title: 'Privatent.', width: 26 },
    { key: 'Ausgaben_Anlagevermoegen', title: 'Anlage-A.', width: 24 },
    { key: 'Ausgaben_Umlaufvermoegen', title: 'Umlauf-A.', width: 24 },
  ] as const;

  const drawHeader = (y: number): number => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    let x = margin;
    columns.forEach((column) => {
      doc.text(column.title, x, y);
      x += column.width;
    });
    doc.line(margin, y + 1, pageWidth - margin, y + 1);
    return y + lineHeight;
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`EÜR Detailexport ${selectedYear}`, margin, margin);

  let y = drawHeader(margin + 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  rows.forEach((row) => {
    if (y > pageHeight - margin) {
      doc.addPage();
      y = drawHeader(margin);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
    }

    const values = [
      row.ASIN,
      asCurrency(row.ETV),
      asCurrency(row.Einnahmen_aus_Verkaeufen),
      asCurrency(row.Einnahmen_Produktzugaenge),
      asCurrency(row.Einnahmen_Privatentnahmen),
      asCurrency(row.Ausgaben_Anlagevermoegen),
      asCurrency(row.Ausgaben_Umlaufvermoegen),
    ];

    let x = margin;
    values.forEach((value, idx) => {
      const column = columns[idx];
      const text = idx === 0 ? value : value.replace('€', '').trim();
      doc.text(text, x, y);
      x += column.width;
    });
    y += lineHeight;
  });

  doc.save(`EUER_Detail_${selectedYear}.pdf`);
};
