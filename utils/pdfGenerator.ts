// utils/pdfGenerator.ts
import { jsPDF } from 'jspdf';
import { PDFDocument } from 'pdf-lib';

// Helper: fetch PDF as Uint8Array
async function fetchPdf(url: string): Promise<Uint8Array> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText} (URL: ${url})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch (error) {
    console.error("Error fetching external PDF:", error);
    if (error instanceof Error && error.message.toLowerCase().includes('failed to fetch')) {
        throw new Error(`Konnte externes PDF nicht laden (URL: ${url}). Mögliche Ursachen: Netzwerkproblem, ungültige URL oder CORS-Beschränkung des Servers, der die PDF-Datei bereitstellt.`);
    }
    throw error; // Re-throw other errors
  }
}


// Helper function for y-increment and page add, scoped to be callable within generatePdfFromText
const createYIncrementer = (doc: jsPDF, margin: number, initialLineHeight: number) => {
  let yPos = margin;
  let currentLineHeight = initialLineHeight;
  const pageHeight = doc.internal.pageSize.height;

  const incrementY = (amount = currentLineHeight) => {
    yPos += amount;
    if (yPos > pageHeight - margin - currentLineHeight) { // Ensure space for at least one more line
      doc.addPage();
      yPos = margin;
    }
  };
  
  const setY = (newY: number) => { yPos = newY; };
  const getY = () => yPos;
  const setLineHeight = (lh: number) => { currentLineHeight = lh; };


  return { incrementY, getY, setY, setLineHeight };
};


const generateMainPdfBytesFromText = (
  text: string,
  isBulkBeleg: boolean = false
): ArrayBuffer => {
  const doc = new jsPDF({
    unit: 'mm',
    format: 'a4',
  });

  const margin = 15; // mm
  const initialLineHeight = isBulkBeleg ? 5 : 7; // Smaller line height for potentially longer bulk belegs
  
  const pageHeight = doc.internal.pageSize.height;
  const pageWidth = doc.internal.pageSize.width;
  const usableWidth = pageWidth - margin * 2;

  const { incrementY, getY, setY, setLineHeight } = createYIncrementer(doc, margin, initialLineHeight);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  const lines = text.split('\n');

  lines.forEach(line => {
    let currentFontWeight = 'normal';
    let isAmountLine = false;
    let label = line;
    let value = '';
    let currentFontSize = 10;
    let isProductListItem = false;

    if (line.startsWith('Proformarechnung') && !line.startsWith('Rechnungsnummer:')) {
      currentFontWeight = 'bold';
      currentFontSize = 14;
    } else if (['Von:', 'An (Leistungsempfänger):', 'Produkt:', 'Leistung:', 'Abgerechnete Produkte:'].includes(line.trim())) {
      currentFontWeight = 'bold';
      currentFontSize = 11;
    } else if (line.startsWith('Gesamtbetrag:') || line.startsWith('Wert der Leistung:') || line.startsWith('Gesamtwert der erbrachten Leistungen:')) {
      currentFontWeight = 'bold';
      isAmountLine = true;
      const colonIndex = line.lastIndexOf(':');
      if (colonIndex !== -1) {
        label = line.substring(0, colonIndex + 1);
        value = line.substring(colonIndex + 1).trim();
      }
      currentFontSize = 11;
    } else if (isBulkBeleg && line.trim().startsWith('- Produkt:')) {
      currentFontSize = 8; // Smaller font for product list items in bulk
      isProductListItem = true;
    } else if (isBulkBeleg && line.trim().startsWith('  Bestelldatum:')) {
      currentFontSize = 8;
      isProductListItem = true;
      label = "  " + line.trim(); // Indent further
    }
    
    doc.setFontSize(currentFontSize);
    doc.setFont(undefined, currentFontWeight);
    
    // Adjust line height based on font size (approx)
    const dynamicLineHeight = currentFontSize * 0.35 * (isProductListItem ? 1.2 : 1.8) ; // Slightly more compact for list items
    setLineHeight(dynamicLineHeight);

    const splitLabelLines = doc.splitTextToSize(label, usableWidth);

    if (isAmountLine && value) {
        doc.text(splitLabelLines, margin, getY());
        
        doc.setFont(undefined, 'bold'); // Value part also bold for amounts
        const valueWidth = doc.getTextWidth(value);
        const yForValue = getY() + (splitLabelLines.length > 1 ? (splitLabelLines.length -1) * dynamicLineHeight * 0.8 : 0);
        doc.text(value, pageWidth - margin - valueWidth, yForValue); 
        incrementY(dynamicLineHeight * splitLabelLines.length * (isProductListItem ? 0.8 : 0.9));

    } else {
        doc.text(splitLabelLines, margin, getY());
        incrementY(dynamicLineHeight * splitLabelLines.length * (isProductListItem ? 0.8 : 0.9)); 
    }
  });
  
  return doc.output('arraybuffer');
};

export const generatePdfWithAppendedDocs = async (
  mainTextContent: string,
  filename: string,
  externalPdfUrls: string[] = [], // Array of URLs
  isBulkBelegLayout: boolean = false
): Promise<void> => {
  const mainPdfBytes = generateMainPdfBytesFromText(mainTextContent, isBulkBelegLayout);

  if (externalPdfUrls.length === 0) {
    const blob = new Blob([mainPdfBytes], { type: 'application/pdf' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    return;
  }

  try {
    let currentMergedPdfDoc = await PDFDocument.load(mainPdfBytes);

    for (const url of externalPdfUrls) {
      if (url) { // Make sure URL is not empty or undefined
        const externalPdfBytes = await fetchPdf(url); // fetchPdf throws if it fails
        const externalPdfDocToAppend = await PDFDocument.load(externalPdfBytes);
        const copiedPages = await currentMergedPdfDoc.copyPages(externalPdfDocToAppend, externalPdfDocToAppend.getPageIndices());
        copiedPages.forEach(page => currentMergedPdfDoc.addPage(page));
      }
    }

    const mergedPdfFinalBytes = await currentMergedPdfDoc.save();
    const blob = new Blob([mergedPdfFinalBytes], { type: 'application/pdf' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

  } catch (error) {
    console.error("Error during PDF merging process:", error);
    throw new Error(`Fehler beim Erstellen oder Anhängen von PDFs: ${error instanceof Error ? error.message : String(error)}.`);
  }
};


// Existing function, now simplified to use the new core generator
export const generatePdfFromText = async (
  text: string,
  filename: string,
  externalPdfUrl?: string // URL of the single external PDF to append
): Promise<void> => {
  const urlsToAppend = externalPdfUrl ? [externalPdfUrl] : [];
  await generatePdfWithAppendedDocs(text, filename, urlsToAppend, false);
};
