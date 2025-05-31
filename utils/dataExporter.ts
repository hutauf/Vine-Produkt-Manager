
import { Product } from '../types';
import * as XLSX from 'xlsx';

export const exportToJson = (data: Product[], filename: string) => {
  const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
    JSON.stringify(data, null, 2) // Pretty print JSON
  )}`;
  const link = document.createElement("a");
  link.href = jsonString;
  link.download = filename;
  link.click();
};

export const exportToXlsx = (data: Product[], filename: string) => {
  const worksheetData = data.map(p => ({
    ASIN: p.ASIN,
    Name: p.name,
    Bestelldatum: p.date, // DD/MM/YYYY
    Bestellnummer: p.ordernumber,
    ETV: p.etv,
    Keepa: p.keepa,
    Teilwert_Original: p.teilwert,
    Teilwert_Eigen: p.myTeilwert,
    Teilwert_Begruendung: p.myTeilwertReason,
    Status: p.usageStatus.join(', '),
    PDF_Link: p.pdf,
    Verkaufspreis: p.salePrice,
    Verkaufsdatum: p.saleDate, // TT.MM.JJJJ
    Kaeufer_Adresse: p.buyerAddress,
    Privatentnahme_Datum: p.privatentnahmeDate, // TT.MM.JJJJ - Added
    Festgeschrieben: p.festgeschrieben === 1 ? 'Ja' : 'Nein', // New field
    Rechnungsnummer: p.rechnungsNummer, // New field
  }));

  const worksheet = XLSX.utils.json_to_sheet(worksheetData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Produkte");

  // Auto-size columns (basic attempt)
  const colWidths = Object.keys(worksheetData[0] || {}).map(key => {
      const columnData = worksheetData.map(row => row[key as keyof typeof row]);
      const maxLength = Math.max(
        ...columnData.map(val => (val?.toString() ?? '').length),
        key.length
      );
      return { wch: maxLength + 2 }; // Add a little padding
  });
  worksheet['!cols'] = colWidths;
  
  XLSX.writeFile(workbook, filename);
};