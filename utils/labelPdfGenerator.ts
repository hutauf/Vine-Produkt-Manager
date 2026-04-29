import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

export interface LabelData {
  type: 'product' | 'location';
  id: string; // ASIN or location_id
  meta?: boolean;
  name?: string; // Optional product name or additional text
}

export const downloadLabelPdf = async (data: LabelData, filename: string): Promise<void> => {
  // Create a small PDF for a label printer. e.g. 62mm x 29mm or something common.
  // 62x29 is a standard Brother DK-11209 label size.
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [62, 29]
  });

  // Always use QR Code for both products and locations (more robust)
  const qrDataUrl = await QRCode.toDataURL(data.id, { margin: 1, scale: 5 });
  
  // Position QR code on the left side
  doc.addImage(qrDataUrl, 'PNG', 2, 2, 25, 25);

  if (data.type === 'location') {
    doc.setFontSize(10);
    doc.text('Lagerort:', 29, 10);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    
    // Split text if it's too long
    const splitId = doc.splitTextToSize(data.id, 30);
    doc.text(splitId, 29, 16);
  } else {
    // Product Label
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    const splitId = doc.splitTextToSize(data.id, 32);
    doc.text(splitId, 29, 8); // Print ASIN
    
    if (data.meta && data.name) {
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      const splitName = doc.splitTextToSize(data.name, 32);
      // Only print first 4 lines to fit
      doc.text(splitName.slice(0, 4), 29, 14);
    }
  }

  doc.save(filename);
};
