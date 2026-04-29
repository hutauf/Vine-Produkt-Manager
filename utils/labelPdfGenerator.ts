import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';

export interface LabelData {
  type: 'product' | 'location';
  id: string; // ASIN or location_id
  meta?: boolean;
  name?: string; // Optional product name or additional text
}

export const generateLabelPdf = async (data: LabelData): Promise<string> => {
  // Create a small PDF for a label printer. e.g. 62mm x 29mm or something common.
  // 62x29 is a standard Brother DK-11209 label size.
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [62, 29]
  });

  doc.setFontSize(8);

  if (data.type === 'location') {
    // Generate QR code for location
    const qrDataUrl = await QRCode.toDataURL(data.id, { margin: 1, scale: 5 });
    doc.addImage(qrDataUrl, 'PNG', 2, 2, 25, 25);
    
    doc.setFontSize(10);
    doc.text('Lagerort:', 29, 10);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    
    // Split text if it's too long
    const splitId = doc.splitTextToSize(data.id, 30);
    doc.text(splitId, 29, 16);

  } else {
    // Generate Barcode for Product (ASIN)
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, data.id, {
      format: 'CODE128',
      displayValue: true,
      fontSize: 16,
      margin: 0,
      height: 50
    });
    
    const barcodeDataUrl = canvas.toDataURL('image/png');
    
    // Position barcode in the center-ish
    doc.addImage(barcodeDataUrl, 'PNG', 5, 5, 52, 15);
    
    if (data.meta && data.name) {
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      const splitName = doc.splitTextToSize(data.name, 60);
      // Only print first 2 lines
      doc.text(splitName.slice(0, 2), 5, 24);
    }
  }

  return doc.output('datauristring');
};
