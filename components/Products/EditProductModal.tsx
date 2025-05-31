
import React, { useState, useEffect } from 'react';
import { Product, ProductUsage, EuerSettings, BelegSettings } from '../../types';
import { PRODUCT_USAGE_OPTIONS } from '../../constants';
import Modal from '../Common/Modal';
import Button from '../Common/Button';
import { FaRegCalendarCheck, FaExclamationTriangle, FaSave, FaCheckCircle } from 'react-icons/fa';
import {
    parseGermanDate,
    getTodayGermanFormat,
    convertGermanToISO,
    convertISOToGerman
} from '../../utils/dateUtils';
import ConfirmGoBDChangeModal from '../Common/ConfirmGoBDChangeModal';

interface EditProductModalProps {
  product: Product;
  isOpen: boolean;
  onClose: () => void;
  onSave: (product: Product) => Promise<void>; // Changed to Promise
  onSaveAndFinalize?: (product: Product, attachPdf: boolean) => Promise<{success: boolean; message: string}>; // New optional prop
  euerSettings: EuerSettings; // New prop
  belegSettings: BelegSettings; // New prop
  // context?: 'dashboard' | 'belege'; // Optional: to slightly alter behavior if needed
}

const isValidGermanDate = (dateString: string): boolean => {
  if (!dateString) return false;
  return !!parseGermanDate(dateString);
};

const EditProductModal: React.FC<EditProductModalProps> = ({ 
    product, 
    isOpen, 
    onClose, 
    onSave, 
    onSaveAndFinalize,
    euerSettings,
    belegSettings
}) => {
  const [formData, setFormData] = useState({
    myTeilwert: product.myTeilwert?.toString() ?? '',
    myTeilwertReason: product.myTeilwertReason ?? '',
    usageStatus: product.usageStatus ?? [],
    salePrice: product.salePrice?.toString() ?? '',
    saleDate: product.saleDate ?? '',
    privatentnahmeDate: product.privatentnahmeDate ?? '',
    buyerAddress: product.buyerAddress ?? '',
  });
  
  const [modalError, setModalError] = useState<string | null>(null);
  const [showGoBDConfirmModal, setShowGoBDConfirmModal] = useState(false);
  const [goBDActionType, setGoBDActionType] = useState<'save' | 'saveAndFinalize' | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingAndFinalizing, setIsSavingAndFinalizing] = useState(false);


  useEffect(() => {
    if (isOpen) {
      setFormData({
        myTeilwert: product.myTeilwert?.toString() ?? '',
        myTeilwertReason: product.myTeilwertReason ?? '',
        usageStatus: product.usageStatus ?? [],
        salePrice: product.salePrice?.toString() ?? '',
        saleDate: product.saleDate ?? '',
        privatentnahmeDate: product.privatentnahmeDate ?? '',
        buyerAddress: product.buyerAddress ?? '',
      });
      setModalError(null);
      setShowGoBDConfirmModal(false);
      setGoBDActionType(null);
      setIsSaving(false);
      setIsSavingAndFinalizing(false);
    }
  }, [product, isOpen]);

  const handleChange = (field: keyof typeof formData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const validateForm = (): boolean => {
    const { usageStatus, saleDate, salePrice } = formData;
    const isSold = usageStatus.includes(ProductUsage.VERKAUFT);
    const finalSaleDate = saleDate; // Already normalized via input usually
    const salePriceValue = salePrice.trim();

    if (isSold) {
      if (!finalSaleDate) {
        setModalError("Verkaufsdatum ist für verkaufte Produkte erforderlich.");
        return false;
      }
      if (!isValidGermanDate(finalSaleDate)) {
        setModalError("Verkaufsdatum muss im Format TT.MM.JJJJ sein und gültig sein.");
        return false;
      }
      if (salePriceValue === '' || isNaN(parseFloat(salePriceValue))) {
        setModalError("Verkaufspreis ist für verkaufte Produkte erforderlich und muss eine Zahl sein.");
        return false;
      }
    }
    if (formData.privatentnahmeDate.trim() !== '' && !isValidGermanDate(formData.privatentnahmeDate)) {
        setModalError("Privatentnahmedatum muss im Format TT.MM.JJJJ sein oder leer gelassen werden.");
        return false;
    }
    setModalError(null);
    return true;
  };

  const buildUpdatedProduct = (): Product => {
    const { myTeilwert, myTeilwertReason, usageStatus, salePrice, saleDate, privatentnahmeDate, buyerAddress } = formData;
    const isSold = usageStatus.includes(ProductUsage.VERKAUFT);
    const salePriceValue = salePrice.trim();

    return {
      ...product,
      myTeilwert: myTeilwert === '' ? null : parseFloat(myTeilwert),
      myTeilwertReason: myTeilwertReason,
      usageStatus: usageStatus,
      salePrice: isSold && salePriceValue !== '' && !isNaN(parseFloat(salePriceValue)) ? parseFloat(salePriceValue) : null,
      saleDate: isSold && saleDate !== '' ? saleDate : undefined,
      buyerAddress: isSold ? buyerAddress : undefined,
      privatentnahmeDate: privatentnahmeDate !== '' ? privatentnahmeDate : undefined,
    };
  };

  const proceedWithSaveAction = async (actionType: 'save' | 'saveAndFinalize') => {
    if (!validateForm()) {
      if (actionType === 'save') setIsSaving(false);
      if (actionType === 'saveAndFinalize') setIsSavingAndFinalizing(false);
      return;
    }
    const updatedProduct = buildUpdatedProduct();

    if (actionType === 'save') {
      setIsSaving(true);
      await onSave(updatedProduct);
      setIsSaving(false);
      onClose(); // Close modal after successful save
    } else if (actionType === 'saveAndFinalize' && onSaveAndFinalize) {
      setIsSavingAndFinalizing(true);
      const result = await onSaveAndFinalize(updatedProduct, true); // Default attachPdf to true from modal
      setIsSavingAndFinalizing(false);
      if (result.success) {
        onClose(); // Close modal after successful save & finalize
      }
      // Feedback for finalize is handled by App.tsx typically
    }
  };

  const handleAttempt = (actionType: 'save' | 'saveAndFinalize') => {
    if (product.festgeschrieben === 1) {
      const myTeilwertChanged = (formData.myTeilwert === '' ? null : parseFloat(formData.myTeilwert)) !== (product.myTeilwert ?? null);
      const myTeilwertReasonChanged = formData.myTeilwertReason !== (product.myTeilwertReason ?? '');
      const wasStorniert = product.usageStatus.includes(ProductUsage.STORNIERT);
      const isStorniertNow = formData.usageStatus.includes(ProductUsage.STORNIERT);
      const storniertChanged = !wasStorniert && isStorniertNow;
      const wasDefekt = product.usageStatus.includes(ProductUsage.DEFEKT);
      const isDefektNow = formData.usageStatus.includes(ProductUsage.DEFEKT);
      const defektChanged = wasDefekt !== isDefektNow;

      if (myTeilwertChanged || myTeilwertReasonChanged || storniertChanged || defektChanged) {
        setGoBDActionType(actionType);
        setShowGoBDConfirmModal(true);
        return; 
      }
    }
    proceedWithSaveAction(actionType);
  };
  
  const handleConfirmGoBDSave = () => {
    if (goBDActionType) {
      proceedWithSaveAction(goBDActionType);
    }
    setShowGoBDConfirmModal(false);
  };


  const handleUsageStatusChange = (statusToToggle: ProductUsage) => {
    const wasSoldBefore = formData.usageStatus.includes(ProductUsage.VERKAUFT);
    setFormData(prev => {
      const newStatusSet = new Set(prev.usageStatus);
      const exclusiveGroup: ProductUsage[] = [
        ProductUsage.VERKAUFT, ProductUsage.ENTSORGT, ProductUsage.STORNIERT,
        ProductUsage.PRIVATENTNAHME, ProductUsage.LAGER, ProductUsage.BETRIEBLICHE_NUTZUNG
      ];

      if (newStatusSet.has(statusToToggle)) {
        newStatusSet.delete(statusToToggle);
      } else {
        newStatusSet.add(statusToToggle);
        if (exclusiveGroup.includes(statusToToggle)) {
          exclusiveGroup.forEach(s => { if (s !== statusToToggle) newStatusSet.delete(s); });
        }
        if (statusToToggle === ProductUsage.LAGER) newStatusSet.delete(ProductUsage.BETRIEBLICHE_NUTZUNG);
        if (statusToToggle === ProductUsage.BETRIEBLICHE_NUTZUNG) newStatusSet.delete(ProductUsage.LAGER);
      }
      
      const newUsageStatus = Array.from(newStatusSet);
      let newSaleDate = prev.saleDate;
      if (statusToToggle === ProductUsage.VERKAUFT && !wasSoldBefore && newUsageStatus.includes(ProductUsage.VERKAUFT)) {
         if (prev.saleDate.trim() === '') newSaleDate = getTodayGermanFormat();
      }
      return {...prev, usageStatus: newUsageStatus, saleDate: newSaleDate};
    });
  };

  const handleNativeSaleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleChange('saleDate', convertISOToGerman(e.target.value));
  };
  const handleNativePrivatentnahmeDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleChange('privatentnahmeDate', convertISOToGerman(e.target.value));
  };
  const setPrivatentnahmeDateToToday = () => handleChange('privatentnahmeDate', getTodayGermanFormat());

  const isSold = formData.usageStatus.includes(ProductUsage.VERKAUFT);
  const isSalePriceInvalid = isSold && (formData.salePrice.trim() === '' || isNaN(parseFloat(formData.salePrice.trim())));
  const isSaleDateVisuallyInvalid = formData.saleDate.trim() !== '' && !isValidGermanDate(formData.saleDate);
  const isPrivatentnahmeDateVisuallyInvalid = formData.privatentnahmeDate.trim() !== '' && !isValidGermanDate(formData.privatentnahmeDate);

  const canFinalize = onSaveAndFinalize &&
                      product.festgeschrieben !== 1 &&
                      !(euerSettings.streuArtikelLimitActive && product.etv < euerSettings.streuArtikelLimitValue) &&
                      belegSettings.userData.nameOrCompany.trim() !== '' &&
                      belegSettings.userData.addressLine1.trim() !== '' &&
                      belegSettings.userData.addressLine2.trim() !== '' &&
                      belegSettings.userData.vatId.trim() !== '';
  
  let finalizeDisabledTooltip = "";
  if (product.festgeschrieben === 1) finalizeDisabledTooltip = "Produkt ist bereits festgeschrieben.";
  else if (euerSettings.streuArtikelLimitActive && product.etv < euerSettings.streuArtikelLimitValue) finalizeDisabledTooltip = "Streuartikel können nicht festgeschrieben werden.";
  else if (!(belegSettings.userData.nameOrCompany.trim() && belegSettings.userData.addressLine1.trim() && belegSettings.userData.addressLine2.trim() && belegSettings.userData.vatId.trim())) {
    finalizeDisabledTooltip = "Absenderdaten (Name, Adresse, USt-IdNr.) in Beleg-Einstellungen fehlen.";
  }


  return (
    <>
    <Modal isOpen={isOpen && !showGoBDConfirmModal} onClose={onClose} title={`Produkt bearbeiten: ${product.name.substring(0,30)}...`} size="lg">
      <div className="space-y-4 max-h-[calc(80vh-100px)] overflow-y-auto pr-2 pb-4">
        {modalError && (
            <div className="bg-red-500 text-white p-3 rounded-md text-sm mb-4">{modalError}</div>
        )}
        {product.festgeschrieben === 1 && (
          <div className="p-3 bg-yellow-500/20 border border-yellow-600 rounded-md text-yellow-300 text-sm flex items-center">
            <FaExclamationTriangle className="h-5 w-5 mr-2 text-yellow-400" />
            Produkt ist festgeschrieben. Änderungen können GoBD verletzen.
          </div>
        )}

        {/* Form fields ... */}
        <div>
          <label htmlFor="myTeilwert" className="block text-sm font-medium text-gray-300">Eigener Teilwert (optional)</label>
          <input 
            id="myTeilwert" 
            type="number" 
            step="0.01" 
            value={formData.myTeilwert} 
            onChange={(e) => handleChange('myTeilwert', e.target.value)} 
            placeholder={product.teilwert != null ? product.teilwert.toFixed(2) : 'N/A'} // <--- MODIFIED HERE
            className="mt-1 block w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm text-gray-100 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm"
          />
        </div>
        <div>
          <label htmlFor="myTeilwertReason" className="block text-sm font-medium text-gray-300">Begründung für eigenen Teilwert (max. 1000 Zeichen)</label>
          <textarea id="myTeilwertReason" value={formData.myTeilwertReason} onChange={(e) => handleChange('myTeilwertReason', e.target.value.substring(0, 1000))} rows={3} maxLength={1000} className="mt-1 block w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm text-gray-100 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm"/>
          <p className="text-xs text-gray-400 mt-1">{formData.myTeilwertReason.length}/1000 Zeichen</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Verwendungsstatus</label>
          <p className="text-xs text-gray-400 mb-2">Hinweis: Storniert, Verkauft, Entsorgt, Privatentnahme, Lager und Betriebl. Nutzung schließen sich gegenseitig aus. Defekt ist eine Zusatzinfo.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {PRODUCT_USAGE_OPTIONS.map(status => (
              <label key={status} className="flex items-center space-x-2 p-2 bg-slate-700 rounded-md hover:bg-slate-600 cursor-pointer">
                <input type="checkbox" checked={formData.usageStatus.includes(status)} onChange={() => handleUsageStatusChange(status)} className="form-checkbox h-4 w-4 text-sky-600 bg-slate-600 border-slate-500 rounded focus:ring-sky-500" aria-label={status}/>
                <span className="text-sm text-gray-200">{status}</span>
              </label>
            ))}
          </div>
        </div>
        <div>
            <label htmlFor="privatentnahmeDateNative" className="block text-sm font-medium text-gray-300 mt-3">Privatentnahmedatum (TT.MM.JJJJ) <span className="text-xs text-gray-400">(optional)</span></label>
             <input type="date" id="privatentnahmeDateNative" value={convertGermanToISO(formData.privatentnahmeDate)} onChange={handleNativePrivatentnahmeDateChange} className={`mt-1 block w-full px-3 py-2 bg-slate-700 border rounded-md shadow-sm text-gray-100 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm ${isPrivatentnahmeDateVisuallyInvalid ? 'border-red-500' : 'border-slate-600'}`} style={{ colorScheme: 'dark' }} aria-describedby={isPrivatentnahmeDateVisuallyInvalid ? "privatentnahmeDate-error" : undefined}/>
            {isPrivatentnahmeDateVisuallyInvalid && (<p id="privatentnahmeDate-error" className="mt-1 text-xs text-red-400">Ungültiges Datum oder Format.</p>)}
            <Button variant="ghost" size="sm" onClick={setPrivatentnahmeDateToToday} className="mt-2 text-xs" leftIcon={<FaRegCalendarCheck className="mr-1"/>}>Heute für Privatentnahme setzen</Button>
        </div>
        {isSold && (
          <>
            <hr className="border-slate-600 my-4" />
            <h4 className="text-md font-semibold text-gray-200 mb-2">Verkaufsdetails (erforderlich bei Verkauf)</h4>
            <div>
              <label htmlFor="salePrice" className="block text-sm font-medium text-gray-300">Verkaufspreis (€) <span className="text-red-400">*</span></label>
              <input id="salePrice" type="number" step="0.01" value={formData.salePrice} onChange={(e) => handleChange('salePrice', e.target.value)} className={`mt-1 block w-full px-3 py-2 bg-slate-700 border rounded-md shadow-sm text-gray-100 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm ${isSalePriceInvalid ? 'border-red-500' : 'border-slate-600'}`} aria-required={isSold ? "true" : "false"}/>
               {isSalePriceInvalid && (<p className="mt-1 text-xs text-red-400">Verkaufspreis ist erforderlich und muss eine Zahl sein.</p>)}
            </div>
            <div>
              <label htmlFor="saleDateNative" className="block text-sm font-medium text-gray-300 mt-2">Verkaufsdatum (TT.MM.JJJJ) <span className="text-red-400">*</span></label>
               <input type="date" id="saleDateNative" value={convertGermanToISO(formData.saleDate)} onChange={handleNativeSaleDateChange} className={`mt-1 block w-full px-3 py-2 bg-slate-700 border rounded-md shadow-sm text-gray-100 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm ${isSaleDateVisuallyInvalid ? 'border-red-500' : 'border-slate-600'}`} style={{ colorScheme: 'dark' }} aria-required={isSold ? "true" : "false"} aria-describedby={isSaleDateVisuallyInvalid ? "saleDate-error" : undefined}/>
              {isSaleDateVisuallyInvalid && (<p id="saleDate-error" className="mt-1 text-xs text-red-400">Ungültiges Datum oder Format. Erforderlich bei Verkauf.</p>)}
              {isSold && formData.saleDate.trim() === '' && modalError && (<p id="saleDate-required-error" className="mt-1 text-xs text-red-400">{modalError.includes("Verkaufsdatum") ? modalError : "Verkaufsdatum ist erforderlich."}</p>)}
            </div>
            <div>
              <label htmlFor="buyerAddress" className="block text-sm font-medium text-gray-300 mt-2">Käuferadresse (optional)</label>
              <textarea id="buyerAddress" value={formData.buyerAddress} onChange={(e) => handleChange('buyerAddress', e.target.value)} rows={3} className="mt-1 block w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm text-gray-100 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm" placeholder="Name&#10;Straße Hausnr.&#10;PLZ Ort"/>
            </div>
          </>
        )}
      </div>
      <div className="flex flex-wrap justify-end space-x-3 pt-4 border-t border-slate-700 mt-4">
        {product.myTeilwert !== null && (
            <Button variant="ghost" onClick={() => { handleChange('myTeilwert', ''); handleChange('myTeilwertReason', ''); }} disabled={isSaving || isSavingAndFinalizing}>
            Eigenen Teilwert zurücksetzen
        </Button>
        )}
        <Button variant="secondary" onClick={onClose} disabled={isSaving || isSavingAndFinalizing}>Abbrechen</Button>
        <Button
            onClick={() => handleAttempt('save')}
            disabled={isSaving || isSavingAndFinalizing || isSaleDateVisuallyInvalid || isPrivatentnahmeDateVisuallyInvalid || (isSold && isSalePriceInvalid)}
            isLoading={isSaving}
            leftIcon={<FaSave />}
        >
          {isSaving ? 'Speichert...' : 'Speichern'}
        </Button>
        {onSaveAndFinalize && (
            <Button
                onClick={() => handleAttempt('saveAndFinalize')}
                disabled={isSaving || isSavingAndFinalizing || !canFinalize || isSaleDateVisuallyInvalid || isPrivatentnahmeDateVisuallyInvalid || (isSold && isSalePriceInvalid)}
                isLoading={isSavingAndFinalizing}
                leftIcon={<FaCheckCircle />}
                title={!canFinalize ? finalizeDisabledTooltip : "Speichern und Beleg festschreiben"}
            >
            {isSavingAndFinalizing ? 'Wird festgeschr...' : 'Speichern & Festschreiben'}
            </Button>
        )}
      </div>
    </Modal>

    <ConfirmGoBDChangeModal
        isOpen={showGoBDConfirmModal}
        onClose={() => {
            setShowGoBDConfirmModal(false);
            setGoBDActionType(null);
            // Reset loading states if GoBD modal is simply closed without confirm
            if (goBDActionType === 'save') setIsSaving(false);
            if (goBDActionType === 'saveAndFinalize') setIsSavingAndFinalizing(false);
        }}
        onConfirm={handleConfirmGoBDSave}
        isLoading={goBDActionType === 'save' ? isSaving : isSavingAndFinalizing} 
    />
    </>
  );
};

export default EditProductModal;