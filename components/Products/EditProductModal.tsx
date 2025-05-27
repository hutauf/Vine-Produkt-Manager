import React, { useState, useEffect } from 'react';
import { Product, ProductUsage } from '../../types';
import { PRODUCT_USAGE_OPTIONS } from '../../constants';
import Modal from '../Common/Modal';
import Button from '../Common/Button';

interface EditProductModalProps {
  product: Product;
  isOpen: boolean;
  onClose: () => void;
  onSave: (product: Product) => void;
}

// Helper function to validate German date format (TT.MM.JJJJ)
const isValidGermanDate = (dateString: string): boolean => {
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(dateString)) {
    return false;
  }
  const parts = dateString.split('.');
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);

  if (year < 1900 || year > 2100 || month === 0 || month > 12) { // Adjusted year range
    return false;
  }
  const monthLength = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year % 400 === 0 || (year % 100 !== 0 && year % 4 === 0)) {
    monthLength[1] = 29; // Leap year
  }
  return day > 0 && day <= monthLength[month - 1];
};

// Helper function to normalize German date input (D.M.YYYY -> DD.MM.YYYY)
const normalizeGermanDateInput = (dateString: string): string => {
  if (typeof dateString !== 'string') return '';

  const parts = dateString.trim().split('.');
  if (parts.length !== 3) {
    return dateString; // Not in D.M.Y structure, let validation handle it
  }

  let [day, month, year] = parts;

  // Pad day if it's a single digit and numeric
  if (day.length === 1 && /^\d$/.test(day)) {
    day = '0' + day;
  }

  // Pad month if it's a single digit and numeric
  if (month.length === 1 && /^\d$/.test(month)) {
    month = '0' + month;
  }
  
  // Year is expected to be 4 digits, validation will catch if not.
  return `${day}.${month}.${year}`;
};


const EditProductModal: React.FC<EditProductModalProps> = ({ product, isOpen, onClose, onSave }) => {
  const [myTeilwert, setMyTeilwert] = useState<string>(product.myTeilwert?.toString() ?? '');
  const [myTeilwertReason, setMyTeilwertReason] = useState<string>(product.myTeilwertReason ?? '');
  const [usageStatus, setUsageStatus] = useState<ProductUsage[]>(product.usageStatus ?? []);
  const [salePrice, setSalePrice] = useState<string>(product.salePrice?.toString() ?? '');
  const [saleDate, setSaleDate] = useState<string>(product.saleDate ?? ''); // Expects TT.MM.JJJJ
  const [buyerAddress, setBuyerAddress] = useState<string>(product.buyerAddress ?? '');
  const [modalError, setModalError] = useState<string | null>(null);


  useEffect(() => {
    setMyTeilwert(product.myTeilwert?.toString() ?? '');
    setMyTeilwertReason(product.myTeilwertReason ?? '');
    setUsageStatus(product.usageStatus ?? []);
    setSalePrice(product.salePrice?.toString() ?? '');
    setSaleDate(product.saleDate ?? ''); // Expects TT.MM.JJJJ
    setBuyerAddress(product.buyerAddress ?? '');
    setModalError(null); // Reset error when product changes
  }, [product]);

  const handleSave = () => {
    setModalError(null);
    const isSold = usageStatus.includes(ProductUsage.VERKAUFT);
    
    // Ensure saleDate is normalized before validation if it wasn't blurred
    const finalSaleDate = normalizeGermanDateInput(saleDate);

    if (isSold) {
      if (!finalSaleDate) {
        setModalError("Verkaufsdatum ist für verkaufte Produkte erforderlich.");
        return;
      }
      if (!isValidGermanDate(finalSaleDate)) {
        setModalError("Verkaufsdatum muss im Format TT.MM.JJJJ sein und gültig sein (z.B. 31.12.2023).");
        return;
      }
       // salePrice can be 0, so only check if it's empty string if it needs to be a number
      if (salePrice === '' || isNaN(parseFloat(salePrice))) {
        // Or require salePrice > 0 if that's a business rule
        // setModalError("Verkaufspreis ist für verkaufte Produkte erforderlich und muss eine Zahl sein.");
        // return;
      }
    }

    const updatedProduct: Product = {
      ...product,
      myTeilwert: myTeilwert === '' ? null : parseFloat(myTeilwert),
      myTeilwertReason: myTeilwertReason,
      usageStatus: usageStatus,
      salePrice: isSold && salePrice !== '' ? parseFloat(salePrice) : null,
      saleDate: isSold && finalSaleDate !== '' ? finalSaleDate : undefined,
      buyerAddress: isSold ? buyerAddress : undefined,
    };
    onSave(updatedProduct);
  };

  const handleUsageStatusChange = (status: ProductUsage) => {
    setUsageStatus(prev =>
      prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
    );
  };
  
  const handleSaleDateBlur = () => {
    setSaleDate(normalizeGermanDateInput(saleDate));
  };

  const isSold = usageStatus.includes(ProductUsage.VERKAUFT);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Produkt bearbeiten: ${product.name.substring(0,30)}...` } size="lg">
      <div className="space-y-4 max-h-[calc(80vh-100px)] overflow-y-auto pr-2 pb-4"> {/* Added max-h, overflow, padding */}
        {modalError && (
            <div className="bg-red-500 text-white p-3 rounded-md text-sm mb-4">{modalError}</div>
        )}
        <div>
          <label htmlFor="myTeilwert" className="block text-sm font-medium text-gray-300">
            Eigener Teilwert (optional)
          </label>
          <input
            id="myTeilwert"
            type="number"
            step="0.01"
            value={myTeilwert}
            onChange={(e) => setMyTeilwert(e.target.value)}
            placeholder={product.teilwert.toFixed(2)}
            className="mt-1 block w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm text-gray-100 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm"
          />
        </div>
        <div>
          <label htmlFor="myTeilwertReason" className="block text-sm font-medium text-gray-300">
            Begründung für eigenen Teilwert (max. 1000 Zeichen)
          </label>
          <textarea
            id="myTeilwertReason"
            value={myTeilwertReason}
            onChange={(e) => setMyTeilwertReason(e.target.value.substring(0, 1000))}
            rows={3}
            maxLength={1000}
            className="mt-1 block w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm text-gray-100 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm"
          />
           <p className="text-xs text-gray-400 mt-1">{myTeilwertReason.length}/1000 Zeichen</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Verwendungsstatus</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {PRODUCT_USAGE_OPTIONS.map(status => (
              <label key={status} className="flex items-center space-x-2 p-2 bg-slate-700 rounded-md hover:bg-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={usageStatus.includes(status)}
                  onChange={() => handleUsageStatusChange(status)}
                  className="form-checkbox h-4 w-4 text-sky-600 bg-slate-600 border-slate-500 rounded focus:ring-sky-500"
                  aria-label={status}
                />
                <span className="text-sm text-gray-200">{status}</span>
              </label>
            ))}
          </div>
        </div>

        {isSold && (
          <>
            <hr className="border-slate-600 my-4" />
            <h4 className="text-md font-semibold text-gray-200 mb-2">Verkaufsdetails (erforderlich bei Verkauf)</h4>
            <div>
              <label htmlFor="salePrice" className="block text-sm font-medium text-gray-300">
                Verkaufspreis (€)
              </label>
              <input
                id="salePrice"
                type="number"
                step="0.01"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                className="mt-1 block w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm text-gray-100 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm"
              />
            </div>
            <div>
              <label htmlFor="saleDate" className="block text-sm font-medium text-gray-300">
                Verkaufsdatum (TT.MM.JJJJ) <span className="text-red-400">*</span>
              </label>
              <input
                id="saleDate"
                type="text" 
                placeholder="TT.MM.JJJJ"
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
                onBlur={handleSaleDateBlur} // Normalize on blur
                required={isSold}
                aria-required={isSold}
                className={`mt-1 block w-full px-3 py-2 bg-slate-700 border rounded-md shadow-sm text-gray-100 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm ${isSold && !isValidGermanDate(normalizeGermanDateInput(saleDate)) && saleDate !== '' ? 'border-red-500' : 'border-slate-600'}`}
              />
            </div>
            <div>
              <label htmlFor="buyerAddress" className="block text-sm font-medium text-gray-300 mt-2">
                Käuferadresse (optional)
              </label>
              <textarea
                id="buyerAddress"
                value={buyerAddress}
                onChange={(e) => setBuyerAddress(e.target.value)}
                rows={3}
                className="mt-1 block w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm text-gray-100 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm"
                placeholder="Name des Käufers&#10;Straße Hausnummer&#10;PLZ Ort"
              />
            </div>
          </>
        )}
      </div>
      <div className="flex justify-end space-x-3 pt-4 border-t border-slate-700 mt-4">
        {product.myTeilwert !== null && (
            <Button variant="ghost" onClick={() => {
            setMyTeilwert('');
            setMyTeilwertReason('');
            }}>
            Eigenen Teilwert zurücksetzen
        </Button>
        )}
        <Button variant="secondary" onClick={onClose}>Abbrechen</Button>
        <Button onClick={handleSave}>Speichern</Button>
      </div>
    </Modal>
  );
};

export default EditProductModal;