
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Product, BelegSettings, UserAddressData, RecipientAddressData, ProductUsage, EuerSettings } from '../../types';
import Button from '../Common/Button';
import { FaSave, FaUserEdit, FaBuilding, FaListAlt, FaArchive, FaPrint, FaCheckCircle, FaInfoCircle, FaFilePdf, FaSpinner, FaExternalLinkAlt, FaEdit, FaCalendarAlt, FaBoxes } from 'react-icons/fa';
import { parseDMYtoDate, getEffectivePrivatentnahmeDate, convertGermanToISO, convertISOToGerman, getEndOfQuarter, getOldestUnfinalizedProductDate, parseGermanDate, formatDateToGermanDDMMYYYY } from '../../utils/dateUtils';
import { generatePdfWithAppendedDocs } from '../../utils/pdfGenerator'; 
import { generateBelegTextForPdf, generateBulkBelegTextForPdf } from '../../utils/belegUtils'; 
import EditProductModal from '../Products/EditProductModal'; 

interface BelegePageProps {
  products: Product[];
  euerSettings: EuerSettings;
  belegSettings: BelegSettings; 
  onBelegSettingsChange: (settings: BelegSettings | ((prevState: BelegSettings) => BelegSettings)) => void; 
  onUpdateProduct: (product: Product) => Promise<void>; 
  onExecuteFestschreiben: (product: Product, attachExtPdf: boolean) => Promise<{success: boolean; message: string; invoiceNumber?: string}>; 
  proposedInvoiceNumbers: Map<string, string>; 
  onSaveAndFinalizeProduct: (product: Product, attachPdf: boolean) => Promise<{success: boolean; message: string}>; 
  setAppFeedbackMessage: (feedback: { text: string, type: 'success' | 'error' | 'info' } | null) => void; 
  onExecuteBulkBelegFestschreiben: (
    selectedProducts: Product[], 
    invoiceNumber: string, 
    performanceStart: string, 
    performanceEnd: string, 
    attachExtPdfs: boolean
  ) => Promise<{success: boolean; message: string;}>;
}

const BelegePage: React.FC<BelegePageProps> = ({ 
    products, 
    euerSettings, 
    belegSettings,
    onBelegSettingsChange,
    onUpdateProduct,
    onExecuteFestschreiben,
    proposedInvoiceNumbers,
    onSaveAndFinalizeProduct,
    setAppFeedbackMessage,
    onExecuteBulkBelegFestschreiben
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'todo' | 'archiviert'>('todo');
  const [selectedProductForBeleg, setSelectedProductForBeleg] = useState<Product | null>(null);
  const [attachExternalPdf, setAttachExternalPdf] = useState<boolean>(true);
  const [isFestschreibenLoading, setIsFestschreibenLoading] = useState<boolean>(false);
  const [isEditingProductFromBelege, setIsEditingProductFromBelege] = useState<boolean>(false);

  // State for Bulk Beleg
  const [bulkStartDate, setBulkStartDate] = useState<string>('');
  const [bulkEndDate, setBulkEndDate] = useState<string>('');
  const [selectedBulkProductASINs, setSelectedBulkProductASINs] = useState<Set<string>>(new Set());
  const [bulkBelegPreviewText, setBulkBelegPreviewText] = useState<string>('');
  const [isBulkFestschreibenLoading, setIsBulkFestschreibenLoading] = useState<boolean>(false);

  const isStreuArtikel = useCallback((product: Product, settings: EuerSettings): boolean => {
    return settings.streuArtikelLimitActive && product.etv < settings.streuArtikelLimitValue;
  }, []);

  useEffect(() => {
    const nonStreuArtikelProducts = products.filter(p => !isStreuArtikel(p, euerSettings));
    const oldestDate = getOldestUnfinalizedProductDate(nonStreuArtikelProducts);
    if (oldestDate) {
      setBulkStartDate(convertGermanToISO(formatDateToGermanDDMMYYYY(oldestDate)));
      const eq = getEndOfQuarter(oldestDate);
      setBulkEndDate(convertGermanToISO(formatDateToGermanDDMMYYYY(eq)));
    } else {
      const today = new Date();
      setBulkStartDate(convertGermanToISO(formatDateToGermanDDMMYYYY(today)));
      const eq = getEndOfQuarter(today);
      setBulkEndDate(convertGermanToISO(formatDateToGermanDDMMYYYY(eq)));
    }
  }, [products, euerSettings, isStreuArtikel]);


  const productsForBulkSelection = useMemo(() => {
    const start = bulkStartDate ? parseGermanDate(convertISOToGerman(bulkStartDate)) : null;
    const end = bulkEndDate ? parseGermanDate(convertISOToGerman(bulkEndDate)) : null;

    if (!start || !end || start > end) return [];

    return products.filter(p => {
      if (p.festgeschrieben === 1) return false;
      if (isStreuArtikel(p, euerSettings)) return false; // Filter Streuartikel
      if (p.usageStatus.includes(ProductUsage.STORNIERT)) return false;

      const orderDate = parseDMYtoDate(p.date);
      return orderDate && orderDate >= start && orderDate <= end;
    }).sort((a,b) => (parseDMYtoDate(a.date)?.getTime() || 0) - (parseDMYtoDate(b.date)?.getTime() || 0));
  }, [products, bulkStartDate, bulkEndDate, euerSettings, isStreuArtikel]);

  useEffect(() => {
    setSelectedBulkProductASINs(new Set(productsForBulkSelection.map(p => p.ASIN)));
  }, [productsForBulkSelection]);
  
  const selectedProductsForBulkBeleg = useMemo(() => {
    return productsForBulkSelection.filter(p => selectedBulkProductASINs.has(p.ASIN));
  }, [productsForBulkSelection, selectedBulkProductASINs]);


  useEffect(() => { 
    if (selectedProductsForBulkBeleg.length > 0) {
      const oldestProduct = selectedProductsForBulkBeleg[0]; 
      const newestProduct = selectedProductsForBulkBeleg[selectedProductsForBulkBeleg.length - 1];
      const invoiceNumber = proposedInvoiceNumbers.get(oldestProduct.ASIN) || `SAMMEL-${new Date().getFullYear()}-MANGLI`;
      const performanceStart = oldestProduct.date; // DD/MM/YYYY
      const performanceEnd = newestProduct.date;   // DD/MM/YYYY
      
      const text = generateBulkBelegTextForPdf(
        selectedProductsForBulkBeleg,
        belegSettings,
        euerSettings,
        invoiceNumber,
        performanceStart,
        performanceEnd
      );
      setBulkBelegPreviewText(text);
    } else {
      setBulkBelegPreviewText("Keine Produkte für Sammelbeleg ausgewählt oder im Zeitraum vorhanden.");
    }
  }, [selectedProductsForBulkBeleg, belegSettings, euerSettings, proposedInvoiceNumbers]);

  const currentBelegDisplayInfo = useMemo(() => {
    if (!selectedProductForBeleg) {
      return {
        type: 'none' as const,
        productsInvolved: [] as Product[],
        invoiceNumber: '',
        previewTitle: "Kein Produkt ausgewählt",
        generatedText: "Bitte wählen Sie ein Produkt aus der Liste.",
        performancePeriodStart: undefined,
        performancePeriodEnd: undefined,
      };
    }
  
    if (activeSubTab === 'archiviert' && selectedProductForBeleg.festgeschrieben === 1 && selectedProductForBeleg.rechnungsNummer) {
      const invoiceNumber = selectedProductForBeleg.rechnungsNummer;
      const relatedProducts = products.filter(p => p.rechnungsNummer === invoiceNumber && !isStreuArtikel(p, euerSettings));
  
      if (relatedProducts.length > 1) { // It's a bulk invoice
        const sortedRelatedProducts = [...relatedProducts].sort((a, b) => (parseDMYtoDate(a.date)?.getTime() || 0) - (parseDMYtoDate(b.date)?.getTime() || 0));
        const performanceStart = sortedRelatedProducts[0].date;
        const performanceEnd = sortedRelatedProducts[sortedRelatedProducts.length - 1].date;
        return {
          type: 'bulk' as const,
          productsInvolved: sortedRelatedProducts,
          invoiceNumber,
          previewTitle: `Sammelbeleg gefunden: ${invoiceNumber}`,
          generatedText: generateBulkBelegTextForPdf(sortedRelatedProducts, belegSettings, euerSettings, invoiceNumber, performanceStart, performanceEnd),
          performancePeriodStart: performanceStart,
          performancePeriodEnd: performanceEnd,
        };
      }
    }
  
    const invoiceNumberToUse = selectedProductForBeleg.festgeschrieben === 1
      ? selectedProductForBeleg.rechnungsNummer
      : proposedInvoiceNumbers.get(selectedProductForBeleg.ASIN);
  
    return {
      type: 'single' as const,
      productsInvolved: [selectedProductForBeleg],
      invoiceNumber: invoiceNumberToUse || (selectedProductForBeleg.festgeschrieben === 1 ? 'N/A (Archiviert)' : 'Wird generiert...'),
      previewTitle: `Vorschau Einzelbeleg für: ${selectedProductForBeleg.ASIN}`, 
      generatedText: generateBelegTextForPdf(selectedProductForBeleg, belegSettings, euerSettings, invoiceNumberToUse),
      performancePeriodStart: undefined,
      performancePeriodEnd: undefined,
    };
  }, [selectedProductForBeleg, activeSubTab, products, belegSettings, euerSettings, proposedInvoiceNumbers, isStreuArtikel]);


  const handleSettingsChange = (
    section: 'userData' | 'recipientData',
    field: keyof UserAddressData | keyof RecipientAddressData,
    value: string | boolean
  ) => {
    onBelegSettingsChange(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field as string]: value,
      },
    }));
  };

  const handleProductSelect = (product: Product) => {
    if (activeSubTab === 'todo' && isStreuArtikel(product, euerSettings) && product.festgeschrieben !== 1) {
        return;
    }
    setSelectedProductForBeleg(product);
  };
  
  const handleEditProductFromBelege = () => {
    if (selectedProductForBeleg) {
      setIsEditingProductFromBelege(true);
    }
  };

  const handleMarkFestgeschrieben = async () => {
    if (currentBelegDisplayInfo.type !== 'single' || !currentBelegDisplayInfo.productsInvolved[0]) return;
    
    const productToFinalize = currentBelegDisplayInfo.productsInvolved[0];
    
    if (isStreuArtikel(productToFinalize, euerSettings)) {
        setAppFeedbackMessage({ text: "Fehler: Streuartikel können nicht festgeschrieben werden.", type: 'error'});
        return;
    }

    setIsFestschreibenLoading(true);
    setAppFeedbackMessage(null);

    const result = await onExecuteFestschreiben(productToFinalize, attachExternalPdf);
    
    setAppFeedbackMessage({ text: result.message, type: result.success ? 'success' : 'error'});
    if (result.success) {
        setSelectedProductForBeleg(null); 
    }
    setIsFestschreibenLoading(false);
  };

  const handleBulkProductSelectionChange = (asin: string) => {
    setSelectedBulkProductASINs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(asin)) {
        newSet.delete(asin);
      } else {
        newSet.add(asin);
      }
      return newSet;
    });
  };
  
  const handleBulkSelectAll = (selectAll: boolean) => {
    if (selectAll) {
      setSelectedBulkProductASINs(new Set(productsForBulkSelection.map(p => p.ASIN)));
    } else {
      setSelectedBulkProductASINs(new Set());
    }
  };

  const handleExecuteBulkFestschreiben = async () => {
    if (selectedProductsForBulkBeleg.length === 0) {
      setAppFeedbackMessage({ text: "Keine Produkte für den Sammelbeleg ausgewählt.", type: "error" });
      return;
    }
    const oldestProduct = selectedProductsForBulkBeleg[0]; 
    const newestProduct = selectedProductsForBulkBeleg[selectedProductsForBulkBeleg.length - 1];
    const invoiceNumberForBulk = proposedInvoiceNumbers.get(oldestProduct.ASIN) || `SAMMEL-${new Date().getFullYear()}-FEHLT`;

    if (invoiceNumberForBulk.includes("FEHLT")) {
         setAppFeedbackMessage({ text: "Konnte keine Rechnungsnummer für das älteste Produkt im Sammelbeleg finden.", type: "error" });
         return;
    }

    setIsBulkFestschreibenLoading(true);
    setAppFeedbackMessage(null);

    const result = await onExecuteBulkBelegFestschreiben(
      selectedProductsForBulkBeleg,
      invoiceNumberForBulk,
      oldestProduct.date,
      newestProduct.date,
      attachExternalPdf 
    );
    setAppFeedbackMessage({ text: result.message, type: result.success ? 'success' : 'error' });
    if (result.success) {
        const remainingProducts = products.filter(p => !selectedBulkProductASINs.has(p.ASIN) && p.festgeschrieben !== 1 && !isStreuArtikel(p, euerSettings));
        const newOldestDate = getOldestUnfinalizedProductDate(remainingProducts);
        if (newOldestDate) {
            setBulkStartDate(convertGermanToISO(formatDateToGermanDDMMYYYY(newOldestDate)));
            setBulkEndDate(convertGermanToISO(formatDateToGermanDDMMYYYY(getEndOfQuarter(newOldestDate))));
        } else {
            const today = new Date();
            setBulkStartDate(convertGermanToISO(formatDateToGermanDDMMYYYY(today)));
            setBulkEndDate(convertGermanToISO(formatDateToGermanDDMMYYYY(getEndOfQuarter(today))));
        }
        setSelectedBulkProductASINs(new Set()); 
    }
    setIsBulkFestschreibenLoading(false);
  };
  
  const todoProducts = useMemo(() => {
    return products
      .filter(p => {
        if (p.festgeschrieben === 1 || p.usageStatus.includes(ProductUsage.STORNIERT)) return false;
        if (isStreuArtikel(p, euerSettings)) return false; 
        return true;
      })
      .sort((a,b) => (parseDMYtoDate(a.date)?.getTime() || 0) - (parseDMYtoDate(b.date)?.getTime() || 0));
  }, [products, euerSettings, isStreuArtikel]);

  const archiviertProducts = useMemo(() => {
    return products
      .filter(p => {
          if (p.festgeschrieben !== 1) return false;
          if (isStreuArtikel(p, euerSettings)) return false; 
          return true;
      })
      .sort((a,b) => {
        const rnA = a.rechnungsNummer || '';
        const rnB = b.rechnungsNummer || '';
        if (rnA && rnB) {
            const rnCompare = rnA.localeCompare(rnB);
            if (rnCompare !== 0) return rnB.localeCompare(rnA); 
        } else if (rnA) {
            return -1; 
        } else if (rnB) {
            return 1;
        }
        return (parseDMYtoDate(b.date)?.getTime() || 0) - (parseDMYtoDate(a.date)?.getTime() || 0);
      });
  }, [products, euerSettings, isStreuArtikel]);


  const renderProductList = (list: Product[], forBulkSelection = false) => {
    if (list.length === 0) {
      let message = "Keine Produkte in dieser Ansicht.";
      if (activeSubTab === 'todo' && !forBulkSelection) {
        message += " Alle Produkte sind entweder festgeschrieben, storniert oder als Streuartikel klassifiziert.";
      } else if (activeSubTab === 'archiviert' && !forBulkSelection) {
        message += " Keine festgeschriebenen Produkte vorhanden (die keine Streuartikel sind).";
      } else if (forBulkSelection) {
        message = "Keine geeigneten Produkte im gewählten Zeitraum oder alle bereits festgeschrieben/storniert/Streuartikel.";
      }
      return <p className="text-gray-400 italic p-3">{message}</p>;
    }
    return (
      <ul className="space-y-2 max-h-96 overflow-y-auto pr-2">
        {list.map(p => {
          const displayInvoiceNumber = p.festgeschrieben === 1 ? p.rechnungsNummer : proposedInvoiceNumbers.get(p.ASIN);
          
          return (
            <li 
              key={p.ASIN} 
              onClick={() => !forBulkSelection && handleProductSelect(p)}
              className={`p-3 rounded-md transition-all duration-150 ease-in-out flex items-center space-x-3
                          ${!forBulkSelection && selectedProductForBeleg?.ASIN === p.ASIN ? 'bg-sky-700 ring-2 ring-sky-500' : 'bg-slate-700'}
                          hover:bg-slate-600 cursor-pointer`}
              title={p.name}
            >
              {forBulkSelection && (
                <input 
                  type="checkbox" 
                  checked={selectedBulkProductASINs.has(p.ASIN)} 
                  onChange={() => handleBulkProductSelectionChange(p.ASIN)}
                  className="form-checkbox h-5 w-5 text-sky-600 bg-slate-600 border-slate-500 rounded focus:ring-sky-500 flex-shrink-0"
                  aria-label={`Produkt ${p.ASIN} für Sammelbeleg auswählen`}
                />
              )}
              <div className="flex-grow">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-gray-100 truncate pr-2">{p.name.substring(0, forBulkSelection ? 35: 50)}{p.name.length > (forBulkSelection ? 35:50) ? '...' : ''}</span>
                  <span className="text-xs text-sky-400">{p.ASIN}</span>
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  Bestellt: {p.date} 
                  {!forBulkSelection && <> | RN: <span className="font-semibold">{displayInvoiceNumber || (p.festgeschrieben === 1 ? 'N/A (Archiviert)' : 'Wird generiert...')}</span></>}
                  {forBulkSelection && (() => {
                    const displayValue = euerSettings.useTeilwertForIncome
                      ? p.myTeilwert ?? p.teilwert
                      : p.etv;
                    return (
                      <> | Wert: {displayValue != null ? `${displayValue.toFixed(2)}€` : 'Teilwert fehlt'}</>
                    );
                  })()}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  const renderExternalPdfInfo = () => {
    if (currentBelegDisplayInfo.type === 'none' || currentBelegDisplayInfo.generatedText.startsWith("Streuartikel:")) return null;

    let infoTextNode: React.ReactNode = null;

    if (attachExternalPdf) {
        if (currentBelegDisplayInfo.type === 'single') {
            const product = currentBelegDisplayInfo.productsInvolved[0];
            if (product?.pdf) {
                infoTextNode = (
                    <>Info: Die Teilwertschätzung-PDF von <a href={product.pdf} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline inline-flex items-center" title={`Link zur PDF: ${product.pdf}`}>diesem Link <FaExternalLinkAlt className="ml-1 h-3 w-3" /></a> wird angehängt.</>
                );
            } else {
                infoTextNode = "Info: Keine Teilwertschätzung-PDF für dieses Produkt hinterlegt. Beleg ohne Anhang.";
            }
        } else if (currentBelegDisplayInfo.type === 'bulk') {
            const anyPdfExists = currentBelegDisplayInfo.productsInvolved.some(p => p.pdf);
            if (anyPdfExists) {
                const pdfCount = currentBelegDisplayInfo.productsInvolved.filter(p => p.pdf).length;
                infoTextNode = `Info: ${pdfCount} Teilwertschätzung-PDF(s) der ausgewählten Produkte werden angehängt (falls Links vorhanden).`;
            } else {
                 infoTextNode = "Info: Für die Produkte in diesem Sammelbeleg sind keine Teilwertschätzung-PDFs hinterlegt. Beleg ohne Anhänge.";
            }
        }
    } else {
        infoTextNode = "Info: Anhängen der Teilwertschätzung-PDF ist deaktiviert. Beleg ohne Anhänge.";
    }
    
    if (!infoTextNode) return null;


    return (<div className="mt-1 mb-2 text-xs text-gray-400 p-2 bg-slate-800 rounded-md border border-slate-700">{infoTextNode}</div>);
  };


  return (
    <div className="space-y-8">
      <div className="p-6 bg-slate-800 rounded-lg shadow-xl border border-slate-700">
        <h2 className="text-2xl font-semibold text-gray-100 mb-4 flex items-center">
          <FaUserEdit className="mr-3 text-sky-400"/> Adressdaten für Belege
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3 p-4 bg-slate-750 rounded-md border border-slate-600">
            <h3 className="text-lg font-medium text-gray-200">Ihre Daten (Absender)</h3>
            <div>
              <label htmlFor="userNameOrCompany" className="block text-sm font-medium text-gray-300">Name/Firma <span className="text-red-400">*</span></label>
              <input type="text" id="userNameOrCompany" value={belegSettings.userData.nameOrCompany} onChange={e => handleSettingsChange('userData', 'nameOrCompany', e.target.value)} className="mt-1 input-style" />
            </div>
            <div>
              <label htmlFor="userAddress1" className="block text-sm font-medium text-gray-300">Anschrift Zeile 1 <span className="text-red-400">*</span></label>
              <input type="text" id="userAddress1" value={belegSettings.userData.addressLine1} onChange={e => handleSettingsChange('userData', 'addressLine1', e.target.value)} className="mt-1 input-style" placeholder="Straße Hausnummer / Postfach" />
            </div>
            <div>
              <label htmlFor="userAddress2" className="block text-sm font-medium text-gray-300">Anschrift Zeile 2 <span className="text-red-400">*</span></label>
              <input type="text" id="userAddress2" value={belegSettings.userData.addressLine2} onChange={e => handleSettingsChange('userData', 'addressLine2', e.target.value)} className="mt-1 input-style" placeholder="PLZ Ort" />
            </div>
            <div>
              <label htmlFor="userVatId" className="block text-sm font-medium text-gray-300">Ihre USt-IdNr. <span className="text-red-400">*</span></label>
              <input type="text" id="userVatId" value={belegSettings.userData.vatId} onChange={e => handleSettingsChange('userData', 'vatId', e.target.value)} className="mt-1 input-style" />
            </div>
            <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
              <input type="checkbox" checked={belegSettings.userData.isKleinunternehmer} onChange={e => handleSettingsChange('userData', 'isKleinunternehmer', e.target.checked)} className="form-checkbox h-4 w-4 text-sky-600 bg-slate-600 border-slate-500 rounded focus:ring-sky-500" />
              <span>Ich bin Kleinunternehmer gemäß § 19 UStG</span>
            </label>
          </div>
          <div className="space-y-3 p-4 bg-slate-750 rounded-md border border-slate-600">
            <h3 className="text-lg font-medium text-gray-200">Empfängerdaten (Amazon)</h3>
            <div>
              <label htmlFor="recipientCompanyName" className="block text-sm font-medium text-gray-300">Firmenname</label>
              <input type="text" id="recipientCompanyName" value={belegSettings.recipientData.companyName} onChange={e => handleSettingsChange('recipientData', 'companyName', e.target.value)} className="mt-1 input-style" />
            </div>
             <div>
              <label htmlFor="recipientAddress1" className="block text-sm font-medium text-gray-300">Anschrift Zeile 1</label>
              <input type="text" id="recipientAddress1" value={belegSettings.recipientData.addressLine1} onChange={e => handleSettingsChange('recipientData', 'addressLine1', e.target.value)} className="mt-1 input-style" />
            </div>
            <div>
              <label htmlFor="recipientAddress2" className="block text-sm font-medium text-gray-300">Anschrift Zeile 2</label>
              <input type="text" id="recipientAddress2" value={belegSettings.recipientData.addressLine2} onChange={e => handleSettingsChange('recipientData', 'addressLine2', e.target.value)} className="mt-1 input-style" />
            </div>
            <div>
              <label htmlFor="recipientVatId" className="block text-sm font-medium text-gray-300">USt-IdNr. Empfänger</label>
              <input type="text" id="recipientVatId" value={belegSettings.recipientData.vatId} onChange={e => handleSettingsChange('recipientData', 'vatId', e.target.value)} className="mt-1 input-style" />
            </div>
          </div>
        </div>
        <p className="mt-4 text-xs text-gray-400 flex items-center"><FaInfoCircle className="mr-1.5"/> Adressdaten werden lokal gespeichert. <span className="text-red-400 ml-1">* Erforderlich für Festschreibung.</span></p>
      </div>

      {/* EINZELBELEG */}
      <div className="p-6 bg-slate-800 rounded-lg shadow-xl border border-slate-700">
        <h2 className="text-2xl font-semibold text-gray-100 mb-4 flex items-center"><FaFilePdf className="mr-3 text-sky-400"/>Einzelbeleg erstellen</h2>
        <div className="mb-4">
            <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
                <input type="checkbox" checked={attachExternalPdf} onChange={(e) => setAttachExternalPdf(e.target.checked)} className="form-checkbox h-4 w-4 text-sky-600 bg-slate-600 border-slate-500 rounded focus:ring-sky-500"/>
                <span>Teilwertschätzung-PDF an Beleg anhängen (falls Link vorhanden)</span>
            </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="flex border-b border-slate-700 mb-3">
              <button onClick={() => {setActiveSubTab('todo'); setSelectedProductForBeleg(null);}} className={`py-2 px-4 font-medium text-sm ${activeSubTab === 'todo' ? 'text-sky-400 border-b-2 border-sky-400' : 'text-gray-400 hover:text-gray-200'}`}><FaListAlt className="inline mr-1.5 mb-0.5"/>Todo ({todoProducts.length})</button>
              <button onClick={() => {setActiveSubTab('archiviert'); setSelectedProductForBeleg(null);}} className={`py-2 px-4 font-medium text-sm ${activeSubTab === 'archiviert' ? 'text-sky-400 border-b-2 border-sky-400' : 'text-gray-400 hover:text-gray-200'}`}><FaArchive className="inline mr-1.5 mb-0.5"/>Archiviert ({archiviertProducts.length})</button>
            </div>
            {activeSubTab === 'todo' && renderProductList(todoProducts)}
            {activeSubTab === 'archiviert' && renderProductList(archiviertProducts)}
          </div>

          <div className="p-4 bg-slate-750 rounded-md border border-slate-600 min-h-[300px] flex flex-col">
            {currentBelegDisplayInfo.type !== 'none' && !currentBelegDisplayInfo.generatedText.startsWith("Streuartikel:") ? (
              <>
                <h3 className="text-lg font-medium text-gray-200 mb-2">{currentBelegDisplayInfo.previewTitle}</h3>
                <textarea readOnly value={currentBelegDisplayInfo.generatedText} className="w-full flex-grow p-2 bg-slate-800 border border-slate-600 rounded-md text-xs text-gray-200 font-mono focus:outline-none focus:ring-1 focus:ring-sky-500" rows={15} aria-label="Beleg Vorschau"></textarea>
                {renderExternalPdfInfo()}
                <div className="mt-auto pt-2 space-y-2">
                    {activeSubTab === 'todo' && currentBelegDisplayInfo.type === 'single' && 
                     selectedProductForBeleg && selectedProductForBeleg.festgeschrieben !== 1 &&
                    (<>
                        <Button onClick={handleMarkFestgeschrieben} className="w-full" leftIcon={isFestschreibenLoading ? <FaSpinner className="animate-spin"/> : <FaCheckCircle />} isLoading={isFestschreibenLoading} disabled={isFestschreibenLoading}>
                            {isFestschreibenLoading ? 'Verarbeitet...' : 'Beleg festschreiben & PDF'}
                        </Button>
                        <Button variant="secondary" onClick={handleEditProductFromBelege} className="w-full" leftIcon={<FaEdit />} disabled={isFestschreibenLoading}>
                            Produkt vor Festschr. bearbeiten
                        </Button>
                    </>)}
                    {activeSubTab === 'archiviert' && (currentBelegDisplayInfo.type === 'single' || currentBelegDisplayInfo.type === 'bulk') && (
                        <Button variant="secondary" 
                            onClick={async () => { 
                                const text = currentBelegDisplayInfo.generatedText;
                                const filename = `${currentBelegDisplayInfo.invoiceNumber || `Beleg_${currentBelegDisplayInfo.productsInvolved[0]?.ASIN || 'Unbekannt'}`}.pdf`;
                                let pdfUrlsToAppend: string[] = [];
                                let isBulkLayoutForPdf = false;

                                if (currentBelegDisplayInfo.type === 'single') {
                                    const singleProduct = currentBelegDisplayInfo.productsInvolved[0];
                                    if (attachExternalPdf && singleProduct?.pdf) pdfUrlsToAppend.push(singleProduct.pdf);
                                } else if (currentBelegDisplayInfo.type === 'bulk') {
                                    if (attachExternalPdf) {
                                        pdfUrlsToAppend = currentBelegDisplayInfo.productsInvolved
                                            .map(p => p.pdf).filter((pdfUrl): pdfUrl is string => !!pdfUrl);
                                    }
                                    isBulkLayoutForPdf = true;
                                }
                                
                                if (!text.startsWith("Fehler:") && !text.startsWith("Streuartikel:")) {
                                    try {
                                      setIsFestschreibenLoading(true); 
                                      await generatePdfWithAppendedDocs(text, filename, pdfUrlsToAppend, isBulkLayoutForPdf);
                                      setAppFeedbackMessage({text: "PDF erneut heruntergeladen.", type: "success"});
                                    } catch (e) { setAppFeedbackMessage({text: `Fehler PDF-Download: ${e instanceof Error ? e.message : String(e)}`, type: "error"});}
                                    finally { setIsFestschreibenLoading(false); }
                                } else { setAppFeedbackMessage({text: "Fehler: Belegtext für PDF fehlerhaft oder Streuartikel.", type: "error"});}
                            }} 
                            className="w-full" 
                            leftIcon={isFestschreibenLoading ? <FaSpinner className="animate-spin"/> : <FaFilePdf />} 
                            isLoading={isFestschreibenLoading} 
                            disabled={isFestschreibenLoading}
                        >
                           {isFestschreibenLoading ? 'PDF generiert...' : 'PDF erneut herunterladen'}
                        </Button>
                    )}
                    <Button variant="ghost" onClick={() => navigator.clipboard.writeText(currentBelegDisplayInfo.generatedText).then(() => setAppFeedbackMessage({text: "Belegtext kopiert.", type: "info"}))} className="w-full" leftIcon={<FaPrint />} disabled={currentBelegDisplayInfo.generatedText.startsWith("Streuartikel:") || currentBelegDisplayInfo.generatedText.startsWith("Fehler:") || isFestschreibenLoading}>Belegtext kopieren</Button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-500"><FaListAlt size={40} className="mb-3"/><p>{currentBelegDisplayInfo.generatedText.startsWith("Streuartikel:") ? currentBelegDisplayInfo.generatedText : "Produkt aus Liste wählen für Vorschau/Aktion."}</p></div>
            )}
          </div>
        </div>
      </div>

      {/* SAMMELBELEG */}
      <div className="mt-8 p-6 bg-slate-800 rounded-lg shadow-xl border border-slate-700">
        <h2 className="text-2xl font-semibold text-gray-100 mb-4 flex items-center"><FaBoxes className="mr-3 text-sky-400"/>Sammelbeleg erstellen</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
                <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                        <label htmlFor="bulkStartDate" className="block text-sm font-medium text-gray-300">Startdatum</label>
                        <input type="date" id="bulkStartDate" value={bulkStartDate} onChange={e => setBulkStartDate(e.target.value)} className="mt-1 input-style" style={{ colorScheme: 'dark' }}/>
                    </div>
                    <div>
                        <label htmlFor="bulkEndDate" className="block text-sm font-medium text-gray-300">Enddatum</label>
                        <input type="date" id="bulkEndDate" value={bulkEndDate} onChange={e => setBulkEndDate(e.target.value)} className="mt-1 input-style" style={{ colorScheme: 'dark' }}/>
                    </div>
                </div>
                 <div className="mb-2 flex justify-between items-center">
                    <p className="text-sm text-gray-300">Produkte auswählen ({selectedProductsForBulkBeleg.length} / {productsForBulkSelection.length}):</p>
                    <Button size="sm" variant="ghost" onClick={() => handleBulkSelectAll(selectedBulkProductASINs.size !== productsForBulkSelection.length)}>
                        {selectedBulkProductASINs.size !== productsForBulkSelection.length ? 'Alle auswählen' : 'Alle abwählen'}
                    </Button>
                </div>
                {renderProductList(productsForBulkSelection, true)}
            </div>

            <div className="p-4 bg-slate-750 rounded-md border border-slate-600 min-h-[300px] flex flex-col">
                {selectedProductsForBulkBeleg.length > 0 ? (
                    <>
                        <h3 className="text-lg font-medium text-gray-200 mb-2">Vorschau Sammelbeleg</h3>
                        <textarea readOnly value={bulkBelegPreviewText} className="w-full flex-grow p-2 bg-slate-800 border border-slate-600 rounded-md text-xs text-gray-200 font-mono focus:outline-none focus:ring-1 focus:ring-sky-500" rows={15} aria-label="Sammelbeleg Vorschau"></textarea>
                        <p className="mt-1 mb-2 text-xs text-gray-400 p-2 bg-slate-800 rounded-md border border-slate-700">
                            Info: Die Einstellung "Teilwertschätzung-PDF an Beleg anhängen" (oben) gilt auch für Sammelbelege. Alle PDFs der ausgewählten Produkte werden angehängt.
                        </p>
                        <div className="mt-auto pt-2 space-y-2">
                            <Button 
                                onClick={handleExecuteBulkFestschreiben} 
                                className="w-full" 
                                leftIcon={isBulkFestschreibenLoading ? <FaSpinner className="animate-spin"/> : <FaCheckCircle />} 
                                isLoading={isBulkFestschreibenLoading}
                                disabled={isBulkFestschreibenLoading || selectedProductsForBulkBeleg.length === 0}
                            >
                                {isBulkFestschreibenLoading ? 'Verarbeitet...' : `Sammelbeleg (${selectedProductsForBulkBeleg.length}) festschreiben & PDF`}
                            </Button>
                            <Button 
                                variant="ghost" 
                                onClick={() => navigator.clipboard.writeText(bulkBelegPreviewText).then(() => setAppFeedbackMessage({text: "Sammelbelegtext kopiert.", type: "info"}))} 
                                className="w-full" 
                                leftIcon={<FaPrint />} 
                                disabled={isBulkFestschreibenLoading || selectedProductsForBulkBeleg.length === 0}
                            >
                                Sammelbelegtext kopieren
                            </Button>
                        </div>
                    </>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500"><FaListAlt size={40} className="mb-3"/><p>Zeitraum wählen und Produkte für Sammelbeleg-Vorschau auswählen.</p></div>
                )}
            </div>
        </div>
      </div>


      {isEditingProductFromBelege && selectedProductForBeleg && (
        <EditProductModal
            product={selectedProductForBeleg}
            isOpen={isEditingProductFromBelege}
            onClose={() => {
                setIsEditingProductFromBelege(false);
                if (selectedProductForBeleg) { 
                    const potentiallyStaleProduct = products.find(p => p.ASIN === selectedProductForBeleg.ASIN && !isStreuArtikel(p, euerSettings));
                    if (potentiallyStaleProduct) {
                       handleProductSelect(potentiallyStaleProduct); 
                    } else {
                       setSelectedProductForBeleg(null); 
                    }
                }
            }}
            onSave={async (updatedProd) => { 
                await onUpdateProduct(updatedProd);
                setIsEditingProductFromBelege(false);
                setAppFeedbackMessage({text: `Produkt ${updatedProd.ASIN} aktualisiert.`, type: 'success'});
                const refreshedProduct = products.find(p => p.ASIN === updatedProd.ASIN && !isStreuArtikel(p, euerSettings)) || updatedProd;
                handleProductSelect(refreshedProduct);
            }}
            onSaveAndFinalize={async (updatedProd, attachPDF) => { 
                setIsEditingProductFromBelege(false); 
                const result = await onSaveAndFinalizeProduct(updatedProd, attachPDF); 
                if (result.success) {
                    setSelectedProductForBeleg(null); 
                } else {
                    const refreshedProduct = products.find(p => p.ASIN === updatedProd.ASIN && !isStreuArtikel(p, euerSettings)) || updatedProd;
                    handleProductSelect(refreshedProduct);
                }
                return result;
            }}
            euerSettings={euerSettings}
            belegSettings={belegSettings}
        />
      )}
    </div>
  );
};

const InputStyle = `.input-style { display: block; width: 100%; padding: 0.5rem 0.75rem; font-size: 0.875rem; line-height: 1.25rem; color: #e5e7eb; background-color: #334155; border: 1px solid #475569; border-radius: 0.375rem; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); } .input-style:focus { outline: 2px solid transparent; outline-offset: 2px; border-color: #0ea5e9; } .input-style::placeholder { color: #9ca3af; }`;
if (typeof document !== 'undefined') {
  let styleSheetEl = document.getElementById('belegePageStyleSheet');
  if (!styleSheetEl) {
    styleSheetEl = document.createElement("style");
    styleSheetEl.id = 'belegePageStyleSheet';
    (styleSheetEl as HTMLStyleElement).type = "text/css";
    document.head.appendChild(styleSheetEl);
  }
  (styleSheetEl as HTMLStyleElement).innerText = InputStyle;
}

export default BelegePage;
