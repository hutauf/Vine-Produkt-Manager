
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Product, EuerSettings, ProductUsage, BelegSettings, UserAddressData, RecipientAddressData, AdditionalExpense } from './types';
import { DEFAULT_EUER_SETTINGS, TAB_OPTIONS, DEFAULT_BELEG_SETTINGS, BELEG_SETTINGS_STORAGE_KEY, DEFAULT_API_BASE_URL, API_BASE_URL_STORAGE_KEY, ADDITIONAL_EXPENSES_STORAGE_KEY } from './constants';
import Navbar from './components/Layout/Navbar';
import DashboardPage from './components/Pages/DashboardPage';
import EuerPage from './components/Pages/EuerPage';
import VermoegenPage from './components/Pages/VermoegenPage'; // Changed from InventoryPage
import SalesPage from './components/Pages/SalesPage';
import SettingsPage from './components/Pages/SettingsPage';
import BelegePage from './components/Pages/BelegePage';
import { parseProductsFromFile } from './utils/fileParser';
import { exportToJson, exportToXlsx } from './utils/dataExporter';
import { apiGetAllProducts, apiUpdateSingleProduct, apiUpdateProducts, apiDeleteAllData } from './utils/apiService';
import { FaKey } from 'react-icons/fa';
import { parseDMYtoDate, getEffectivePrivatentnahmeDate } from './utils/dateUtils';
import { generateBelegTextForPdf, generateBulkBelegTextForPdf } from './utils/belegUtils';
import { generatePdfWithAppendedDocs } from './utils/pdfGenerator';


const API_TOKEN_STORAGE_KEY = 'vineApp_apiToken';
const EUER_SETTINGS_STORAGE_KEY = 'vineApp_euerSettings';
const PRODUCTS_STORAGE_KEY = 'vineApp_products';

const App: React.FC = () => {
  const [apiToken, setApiToken] = useState<string | null>(() => localStorage.getItem(API_TOKEN_STORAGE_KEY));
  const [apiBaseUrl, setApiBaseUrlState] = useState<string>(() => localStorage.getItem(API_BASE_URL_STORAGE_KEY) || DEFAULT_API_BASE_URL);
  
  const initialEuerSettings = (() => {
    const storedSettingsString = localStorage.getItem(EUER_SETTINGS_STORAGE_KEY);
    let loadedSettings = {};
    if (storedSettingsString) {
        try {
            const parsed = JSON.parse(storedSettingsString);
            if (typeof parsed === 'object' && parsed !== null) {
                loadedSettings = parsed;
            } else {
                 console.error("Stored EuerSettings is not an object:", parsed);
            }
        } catch (error) {
            console.error("Failed to parse EuerSettings from localStorage:", error);
        }
    }
    // Merge with defaults to ensure all properties are present,
    // especially new ones not in older stored settings.
    return { ...DEFAULT_EUER_SETTINGS, ...loadedSettings };
  })();

  const [euerSettings, setEuerSettingsState] = useState<EuerSettings>(initialEuerSettings);

  const [products, setProducts] = useState<Product[]>(() => {
    const storedProducts = localStorage.getItem(PRODUCTS_STORAGE_KEY);
    let loadedProducts: Product[] = [];
    try {
      loadedProducts = storedProducts ? JSON.parse(storedProducts) : [];
    } catch (error) {
      console.error("Failed to parse products from localStorage:", error);
      loadedProducts = [];
    }
    // Apply filter based on the potentially updated initialEuerSettings
    if (initialEuerSettings.ignoreETVZeroProducts) {
      return loadedProducts.filter(p => p.etv !== 0);
    }
    return loadedProducts;
  });

  const [belegSettings, setBelegSettingsState] = useState<BelegSettings>(() => {
    const stored = localStorage.getItem(BELEG_SETTINGS_STORAGE_KEY);
    try {
      return stored ? JSON.parse(stored) : DEFAULT_BELEG_SETTINGS;
    } catch (error) {
      console.error("Failed to parse BelegSettings from localStorage:", error);
      return DEFAULT_BELEG_SETTINGS;
    }
  });

  const [additionalExpenses, setAdditionalExpenses] = useState<AdditionalExpense[]>(() => {
    const storedExpenses = localStorage.getItem(ADDITIONAL_EXPENSES_STORAGE_KEY);
    try {
      return storedExpenses ? JSON.parse(storedExpenses) : [];
    } catch (error) {
      console.error("Failed to parse AdditionalExpenses from localStorage:", error);
      return [];
    }
  });


  const [activeTab, setActiveTab] = useState<string>(TAB_OPTIONS.DASHBOARD);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ text: string, type: 'success' | 'error' | 'info' } | null>(null);

  useEffect(() => {
    if (apiToken) {
      localStorage.setItem(API_TOKEN_STORAGE_KEY, apiToken);
    } else {
      localStorage.removeItem(API_TOKEN_STORAGE_KEY);
    }
  }, [apiToken]);

  useEffect(() => {
    localStorage.setItem(API_BASE_URL_STORAGE_KEY, apiBaseUrl);
  }, [apiBaseUrl]);

  const setApiBaseUrl = (newUrl: string) => {
    setApiBaseUrlState(newUrl);
    setFeedbackMessage({ text: `API URL aktualisiert auf: ${newUrl}. Änderungen werden bei der nächsten Server-Interaktion wirksam.`, type: 'info' });
  };

  useEffect(() => {
    try {
      const productsToSave = euerSettings.ignoreETVZeroProducts 
                             ? products.filter(p => p.etv !== 0) 
                             : products;
      localStorage.setItem(PRODUCTS_STORAGE_KEY, JSON.stringify(productsToSave));
    } catch (error) {
      console.error("Failed to save products to localStorage:", error);
      setFeedbackMessage({ text: "Fehler beim Speichern der Produkte im lokalen Speicher. Möglicherweise ist der Speicher voll.", type: 'error' });
    }
  }, [products, euerSettings.ignoreETVZeroProducts]);

  useEffect(() => {
    localStorage.setItem(BELEG_SETTINGS_STORAGE_KEY, JSON.stringify(belegSettings));
  }, [belegSettings]);

  useEffect(() => {
    localStorage.setItem(ADDITIONAL_EXPENSES_STORAGE_KEY, JSON.stringify(additionalExpenses));
  }, [additionalExpenses]);

  const handleAddExpense = (newExpenseData: Omit<AdditionalExpense, 'id'>) => {
    const newExpense: AdditionalExpense = {
      ...newExpenseData,
      id: crypto.randomUUID(),
    };
    setAdditionalExpenses(prev => [...prev, newExpense].sort((a, b) => (parseDMYtoDate(a.date)?.getTime() || 0) - (parseDMYtoDate(b.date)?.getTime() || 0)));
    setFeedbackMessage({text: "Ausgabe hinzugefügt.", type: 'success'});
  };

  const handleDeleteExpense = (id: string) => {
    setAdditionalExpenses(prev => prev.filter(exp => exp.id !== id));
    setFeedbackMessage({text: "Ausgabe gelöscht.", type: 'success'});
  };


  const setBelegSettings = (newSettings: BelegSettings | ((prevState: BelegSettings) => BelegSettings)) => {
    setBelegSettingsState(prev => {
        const updated = typeof newSettings === 'function' ? newSettings(prev) : newSettings;
        return updated;
    });
  };


  const loadProductData = useCallback(async (forceApplyEtvFilter = false) => {
    if (!apiToken) {
      if (forceApplyEtvFilter && euerSettings.ignoreETVZeroProducts) {
          setProducts(prev => prev.filter(p => p.etv !== 0));
      }
      return;
    }

    setIsLoading(true);
    setFeedbackMessage(null);
    const serverResponse = await apiGetAllProducts(apiBaseUrl, apiToken);
    
    if (serverResponse.status === 'success' && serverResponse.data) {
      let serverProducts = serverResponse.data;
      if (euerSettings.ignoreETVZeroProducts) {
        serverProducts = serverProducts.filter(p => p.etv !== 0);
      }

      const localProductsMap = new Map(products.map(p => [p.ASIN, p]));
      
      serverProducts.forEach(serverP => {
        const localP = localProductsMap.get(serverP.ASIN);
        if (!localP || (serverP.last_update_time || 0) >= (localP.last_update_time || 0)) {
          localProductsMap.set(serverP.ASIN, serverP);
        }
      });

      const mergedProductsArray = Array.from(localProductsMap.values());
      const finalProducts = euerSettings.ignoreETVZeroProducts 
        ? mergedProductsArray.filter(p => p.etv !== 0)
        : mergedProductsArray;

      const sortedFinalProducts = finalProducts.sort((a, b) => (parseDMYtoDate(a.date)?.getTime() || 0) - (parseDMYtoDate(b.date)?.getTime() || 0));
      
      setProducts(sortedFinalProducts);
      setFeedbackMessage({ text: `Produktdaten erfolgreich vom Server geladen und synchronisiert (${sortedFinalProducts.length} Produkte). ETV=0 Filter ${euerSettings.ignoreETVZeroProducts ? 'aktiv' : 'inaktiv'}.`, type: 'success' });

    } else {
      const fullErrorMessage = `Fehler beim Laden der Produkte vom Server: ${serverResponse.message || 'Unbekannter Fehler.'} Lokale Daten werden beibehalten.`;
      setFeedbackMessage({ text: fullErrorMessage, type: 'error' });
      
      if (serverResponse.message && serverResponse.message.toLowerCase().includes('failed to fetch')) {
        console.error(
            "Detailed 'Failed to fetch' error received. This is often an environment, CORS, or network issue. See the full error message displayed in the UI and investigate logs from apiService.ts. The original response object from apiService was:", 
            serverResponse
        );
      }
      if (serverResponse.message?.toLowerCase().includes("invalid token")) {
        setApiToken(null); 
        setFeedbackMessage({ text: "Ungültiger API Token. Serverdaten konnten nicht geladen werden. Lokale Daten bleiben.", type: 'error' });
      }
      if (forceApplyEtvFilter && euerSettings.ignoreETVZeroProducts) {
          setProducts(prev => prev.filter(p => p.etv !== 0));
      }
    }
    setIsLoading(false);
  }, [apiToken, products, euerSettings.ignoreETVZeroProducts, apiBaseUrl]);

  const setEuerSettings = (newSettings: EuerSettings | ((prevState: EuerSettings) => EuerSettings)) => {
    const oldSettings = euerSettings;
    setEuerSettingsState(prevSettings => {
        const updatedSettings = typeof newSettings === 'function' ? newSettings(prevSettings) : newSettings;
        if (updatedSettings.ignoreETVZeroProducts && !oldSettings.ignoreETVZeroProducts) {
            setProducts(prevProducts => prevProducts.filter(p => p.etv !== 0));
            setFeedbackMessage({ text: "Produkte mit ETV=0 wurden lokal ausgeblendet.", type: 'info' });
        } else if (!updatedSettings.ignoreETVZeroProducts && oldSettings.ignoreETVZeroProducts) {
            if (apiToken) {
                setFeedbackMessage({ text: "Lade Daten vom Server, um ETV=0 Produkte wiederherzustellen...", type: 'info' });
                loadProductData(true);
            } else {
                setFeedbackMessage({ text: "ETV=0 Filter deaktiviert. Ohne API Token können Produkte nicht vom Server nachgeladen werden.", type: 'info' });
            }
        }
        return updatedSettings;
    });
  };

  useEffect(() => {
    if (apiToken) {
        loadProductData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps 
  }, [apiToken, apiBaseUrl]); 

  useEffect(() => {
    localStorage.setItem(EUER_SETTINGS_STORAGE_KEY, JSON.stringify(euerSettings));
  }, [euerSettings]);

  useEffect(() => {
    if (feedbackMessage) {
      const timer = setTimeout(() => setFeedbackMessage(null), 7000);
      return () => clearTimeout(timer);
    }
  }, [feedbackMessage]);

  const handleApiTokenChange = (newToken: string) => {
    const trimmedToken = newToken.trim();
    setApiToken(trimmedToken); 
    if (trimmedToken) {
      setFeedbackMessage({ text: "API Token gespeichert. Daten werden vom Server geladen...", type: 'success' });
    } else {
      setFeedbackMessage({ text: "API Token entfernt. Server-Synchronisation deaktiviert.", type: 'info' });
    }
  };

  const handleDeleteAllServerData = async () => {
    if (!apiToken) {
      setFeedbackMessage({ text: "Kein API Token gesetzt.", type: 'error' });
      return;
    }
    setIsLoading(true);
    const response = await apiDeleteAllData(apiBaseUrl, apiToken);
    if (response.status === 'success') {
      setFeedbackMessage({ text: response.message || "Alle Produktdaten auf dem Server gelöscht.", type: 'success' });
    } else {
      setFeedbackMessage({ text: `Fehler beim Löschen der Serverdaten: ${response.message || 'Unbekannter Fehler.'}`, type: 'error' });
    }
    setIsLoading(false);
  };

  const handleClearLocalDataAndToken = () => {
    setApiToken(null); 
    setProducts([]);
    setAdditionalExpenses([]); // Clear additional expenses as well
    setFeedbackMessage({ text: "Lokale Produktdaten, Ausgaben und API Token entfernt.", type: 'success' });
  };

  const handleFileUpload = async (file: File) => {
    setIsLoading(true);
    setFeedbackMessage(null);
    try {
      let parsedProductsFromFile = await parseProductsFromFile(file);
      
      if (euerSettings.ignoreETVZeroProducts) {
          parsedProductsFromFile = parsedProductsFromFile.filter(p => p.etv !== 0);
      }

      if (parsedProductsFromFile.length === 0) {
        setFeedbackMessage({ text: `Keine Produkte in Datei gefunden oder alle hatten ETV=0 (Filter aktiv: ${euerSettings.ignoreETVZeroProducts}).`, type: 'info' });
        setIsLoading(false);
        return;
      }
      
      const productsToActuallyProcess: Product[] = [];
      const currentProductsMap = new Map(products.map(p => [p.ASIN, p]));
      let skippedCount = 0;

      for (const pFromFile of parsedProductsFromFile) {
        const existingProduct = currentProductsMap.get(pFromFile.ASIN);
        const fileTimestamp = pFromFile.last_update_time || 0; 
        const existingTimestamp = existingProduct?.last_update_time || 0;

        if (!existingProduct || fileTimestamp >= existingTimestamp) {
          productsToActuallyProcess.push({
            ...pFromFile,
            last_update_time: Math.floor(Date.now() / 1000) 
          });
        } else {
          skippedCount++;
        }
      }
      
      if (productsToActuallyProcess.length === 0) {
        setFeedbackMessage({ text: `Keine neuen/aktuelleren Produkte in Datei. ${skippedCount} übersprungen (älter).`, type: 'info' });
        setIsLoading(false);
        return;
      }

      if (!apiToken) {
        setProducts(prevProducts => {
          const productsMap = new Map(prevProducts.map(p => [p.ASIN, p]));
          productsToActuallyProcess.forEach(p => productsMap.set(p.ASIN, p));
          const newProductArray = Array.from(productsMap.values());
          const finalProducts = euerSettings.ignoreETVZeroProducts 
                                ? newProductArray.filter(p => p.etv !== 0) 
                                : newProductArray;
          return finalProducts.sort((a,b) => (parseDMYtoDate(a.date)?.getTime() || 0) - (parseDMYtoDate(b.date)?.getTime() || 0));
        });
        setFeedbackMessage({ text: `Lokal importiert/aktualisiert (${productsToActuallyProcess.length} verarbeitet, ${skippedCount} ältere übersprungen).`, type: 'info' });
      } else {
        const response = await apiUpdateProducts(apiBaseUrl, apiToken, productsToActuallyProcess);
        if (response.status === 'success') {
          const { inserted = 0, updated = 0, skipped: apiSkipped = 0 } = response;
          setFeedbackMessage({
            text: `Upload: ${inserted} neu, ${updated} aktualisiert, ${apiSkipped} serverseitig / ${skippedCount} clientseitig übersprungen. Sync...`,
            type: 'success'
          });
          await loadProductData(); 
        } else {
          setFeedbackMessage({ text: `Fehler beim Server-Upload: ${response.message || 'Unbekannter Fehler.'}`, type: 'error' });
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Fehler bei Dateiverarbeitung.";
      setFeedbackMessage({ text: errorMessage, type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleSaveProductDetails = async (updatedProduct: Product): Promise<void> => {
    const productWithTimestamp = {
        ...updatedProduct,
        last_update_time: Math.floor(Date.now() / 1000) 
    };

    if (euerSettings.ignoreETVZeroProducts && productWithTimestamp.etv === 0) {
      setProducts(prevProducts => prevProducts.filter(p => p.ASIN !== productWithTimestamp.ASIN));
      setFeedbackMessage({text: `Produkt ${productWithTimestamp.ASIN} hat ETV=0, lokal ausgeblendet (Filter aktiv). Änderung wird gespeichert.`, type: 'info'});
    } else {
        setProducts(prevProducts => 
        prevProducts.map(p => 
            p.ASIN === productWithTimestamp.ASIN 
            ? productWithTimestamp
            : p
        ).sort((a,b) => (parseDMYtoDate(a.date)?.getTime() || 0) - (parseDMYtoDate(b.date)?.getTime() || 0))
        );
    }

    if (!apiToken) {
      if (!(euerSettings.ignoreETVZeroProducts && productWithTimestamp.etv === 0)) {
         setFeedbackMessage({text: `Produkt ${productWithTimestamp.ASIN} lokal aktualisiert.`, type: 'info'});
      }
      return; 
    }

    setIsLoading(true);
    const response = await apiUpdateSingleProduct(apiBaseUrl, apiToken, productWithTimestamp);
    if (response.status === 'success') {
      setFeedbackMessage({text: `Produkt ${productWithTimestamp.ASIN} auf Server aktualisiert.`, type: 'success'});
    } else {
      setFeedbackMessage({ text: `Server-Aktualisierungsfehler für ${productWithTimestamp.ASIN}: ${response.message || 'Unbekannt.'} Lokale Änderung bleibt.`, type: 'error' });
    }
    setIsLoading(false);
    if (euerSettings.ignoreETVZeroProducts && productWithTimestamp.etv === 0) {
        setProducts(prev => prev.filter(p => p.etv !== 0));
    }
  };

  const proposedInvoiceNumbers = useMemo(() => {
    const newProposedNumbers = new Map<string, string>();
    const productsByYear: { [year: string]: Product[] } = {};

    products.forEach(p => {
      const orderDate = parseDMYtoDate(p.date);
      if (orderDate) {
        const year = orderDate.getFullYear().toString();
        if (!productsByYear[year]) productsByYear[year] = [];
        productsByYear[year].push(p);
      }
    });

    for (const year in productsByYear) {
      const yearProducts = productsByYear[year];
      const festgeschriebenInYear = yearProducts.filter(p => p.festgeschrieben === 1 && p.rechnungsNummer);
      const usedNumbersInYear = new Set(festgeschriebenInYear.map(p => p.rechnungsNummer).filter(rn => rn !== undefined) as string[]);
      
      const sortedTodoInYear = yearProducts
        .filter(p => {
            if (p.festgeschrieben === 1 || p.usageStatus.includes(ProductUsage.STORNIERT)) return false;
            if (euerSettings.streuArtikelLimitActive && p.etv < euerSettings.streuArtikelLimitValue) {
                return false; 
            }
            return true;
        })
        .sort((a, b) => {
          const dateA = parseDMYtoDate(a.date)?.getTime() ?? 0;
          const dateB = parseDMYtoDate(b.date)?.getTime() ?? 0;
          if (dateA !== dateB) return dateA - dateB;
          return a.ASIN.localeCompare(b.ASIN);
        });

      let counter = 1;
      sortedTodoInYear.forEach(p => {
        let currentInvoiceNumber;
        do {
          currentInvoiceNumber = `VINE-${year}-${String(counter).padStart(4, '0')}`;
          counter++;
        } while (usedNumbersInYear.has(currentInvoiceNumber));
        newProposedNumbers.set(p.ASIN, currentInvoiceNumber);
        usedNumbersInYear.add(currentInvoiceNumber); 
      });
    }
    return newProposedNumbers;
  }, [products, euerSettings.streuArtikelLimitActive, euerSettings.streuArtikelLimitValue]);


  const executeFestschreiben = async (
    productToFinalize: Product,
    attachExtPdf: boolean
  ): Promise<{ success: boolean; message: string; invoiceNumber?: string }> => {
    
    const { userData } = belegSettings;
    if (!userData.nameOrCompany.trim() || !userData.addressLine1.trim() || !userData.addressLine2.trim() || !userData.vatId.trim()) {
      return { success: false, message: "Fehler: Wichtige Absenderdaten (Name, Adresse, USt-IdNr.) fehlen in den Beleg-Einstellungen." };
    }

    if (euerSettings.streuArtikelLimitActive && productToFinalize.etv < euerSettings.streuArtikelLimitValue) {
      return { success: false, message: "Fehler: Streuartikel können nicht festgeschrieben werden." };
    }

    const invoiceNumberToAssign = productToFinalize.rechnungsNummer 
        ? productToFinalize.rechnungsNummer 
        : proposedInvoiceNumbers.get(productToFinalize.ASIN);

    if (!invoiceNumberToAssign || invoiceNumberToAssign === "(Nummer wird ermittelt)") { 
      return { success: false, message: "Fehler: Rechnungsnummer für Festschreibung nicht gefunden oder noch nicht ermittelt." };
    }
    
    const finalizedProductData: Product = {
      ...productToFinalize,
      festgeschrieben: 1,
      rechnungsNummer: invoiceNumberToAssign,
      last_update_time: Math.floor(Date.now() / 1000)
    };

    setIsLoading(true); 
    try {
        const belegTextForPdf = generateBelegTextForPdf(finalizedProductData, belegSettings, euerSettings, invoiceNumberToAssign);
        if (belegTextForPdf.startsWith("Fehler:") || belegTextForPdf.startsWith("Streuartikel:")) {
            throw new Error(belegTextForPdf);
        }

        await generatePdfWithAppendedDocs(
            belegTextForPdf, 
            `${invoiceNumberToAssign}.pdf`,
            attachExtPdf && finalizedProductData.pdf ? [finalizedProductData.pdf] : [],
            false 
        );
        
        setProducts(prev => 
            prev.map(p => p.ASIN === finalizedProductData.ASIN ? finalizedProductData : p)
                .sort((a,b) => (parseDMYtoDate(a.date)?.getTime() || 0) - (parseDMYtoDate(b.date)?.getTime() || 0))
        );

        if (apiToken) {
            const response = await apiUpdateSingleProduct(apiBaseUrl, apiToken, finalizedProductData);
            if (response.status !== 'success') {
                throw new Error(`Server-Update fehlgeschlagen: ${response.message || 'Unbekannt'}`);
            }
        }
        setIsLoading(false);
        return { success: true, message: `Beleg ${invoiceNumberToAssign} festgeschrieben, archiviert und PDF heruntergeladen.`, invoiceNumber: invoiceNumberToAssign };

    } catch (error) {
        setIsLoading(false);
        console.error("Fehler in executeFestschreiben: ", error);
        return { success: false, message: `Fehler beim Festschreiben: ${error instanceof Error ? error.message : String(error)}` };
    }
  };


  const handleSaveAndFinalizeProduct = async (
    productToSaveAndFinalize: Product,
    attachExtPdf: boolean
  ): Promise<{success: boolean; message: string}> => {
    await handleSaveProductDetails(productToSaveAndFinalize); 
    const potentiallyUpdatedProduct = products.find(p => p.ASIN === productToSaveAndFinalize.ASIN) || productToSaveAndFinalize;
    const festschreibenResult = await executeFestschreiben(potentiallyUpdatedProduct, attachExtPdf);
    setFeedbackMessage({ text: festschreibenResult.message, type: festschreibenResult.success ? 'success' : 'error'});
    return festschreibenResult;
  };

  const handleFullSync = async () => {
    if (!apiToken) {
      setFeedbackMessage({ text: "Kein API Token. Full Sync nicht möglich.", type: 'error' });
      return;
    }
    setIsLoading(true);
    setFeedbackMessage({ text: "Starte vollständige Synchronisation...", type: 'info' });

    const freshServerResponse = await apiGetAllProducts(apiBaseUrl, apiToken); 
     if (freshServerResponse.status === 'error' || !freshServerResponse.data) {
      setFeedbackMessage({ text: `Fehler beim Abrufen der Serverdaten: ${freshServerResponse.message || 'Unbekannter Fehler.'}`, type: 'error' });
      setIsLoading(false);
      return;
    }
    let serverProducts = freshServerResponse.data;

    setFeedbackMessage({ text: `Serverdaten (${serverProducts.length}) erfolgreich abgerufen. Mische mit lokalen Daten...`, type: 'info' });

    const currentLocalProducts = products; 
    const productMap = new Map<string, Product>();

    serverProducts.forEach(serverP => {
      productMap.set(serverP.ASIN, serverP);
    });

    currentLocalProducts.forEach(localP => {
      const versionInMap = productMap.get(localP.ASIN);
      if (!versionInMap || (localP.last_update_time || 0) > (versionInMap.last_update_time || 0)) {
        productMap.set(localP.ASIN, { ...localP, last_update_time: localP.last_update_time || Math.floor(Date.now() / 1000) });
      }
    });
    
    let mergedProductsForUpload = Array.from(productMap.values()) 
      .map(p => ({...p, last_update_time: p.last_update_time || Math.floor(Date.now() / 1000) }));

    let mergedProductsForState = [...mergedProductsForUpload]; 
    if (euerSettings.ignoreETVZeroProducts) {
        mergedProductsForState = mergedProductsForState.filter(p => p.etv !== 0);
    }
    const sortedMergedProductsForState = mergedProductsForState.sort((a,b) => (parseDMYtoDate(a.date)?.getTime() || 0) - (parseDMYtoDate(b.date)?.getTime() || 0));

    setProducts(sortedMergedProductsForState);
    setFeedbackMessage({ text: `Daten gemischt (${sortedMergedProductsForState.length} lokal angezeigt). Lade ${mergedProductsForUpload.length} auf Server hoch...`, type: 'info' });

    if (mergedProductsForUpload.length > 0) {
        const uploadResponse = await apiUpdateProducts(apiBaseUrl, apiToken, mergedProductsForUpload);
        if (uploadResponse.status === 'success') {
            const { inserted = 0, updated = 0, skipped = 0 } = uploadResponse;
            setFeedbackMessage({ text: `Vollständige Synchronisation erfolgreich! Server: ${inserted} neu, ${updated} aktual., ${skipped} überspr.`, type: 'success' });
            await loadProductData();
        } else {
            setFeedbackMessage({ text: `Fehler beim Hochladen der gemischten Daten: ${uploadResponse.message || 'Unbekannter Fehler.'}`, type: 'error' });
        }
    } else {
         setFeedbackMessage({ text: `Vollständige Synchronisation abgeschlossen. Keine Produkte zum Hochladen.`, type: 'success' });
    }
    setIsLoading(false);
  };


  const handleBulkFestschreiben = async (dateStringYYYYMMDD: string) => {
    if (!dateStringYYYYMMDD) {
      setFeedbackMessage({ text: "Bitte gültiges Datum für Massen-Festschreibung eingeben.", type: 'error' });
      return;
    }
    const parts = dateStringYYYYMMDD.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; 
    const day = parseInt(parts[2], 10);
    const thresholdDate = new Date(Date.UTC(year, month, day));

    if (isNaN(thresholdDate.getTime())) {
        setFeedbackMessage({ text: "Ungültiges Datum.", type: 'error' });
        return;
    }

    setIsLoading(true);
    const productsToUpdate: Product[] = [];
    const updatedProductASINs = new Set<string>();

    products.forEach(p => {
      const orderDate = parseDMYtoDate(p.date);
      if (orderDate && orderDate < thresholdDate && p.festgeschrieben !== 1) {
        if (euerSettings.streuArtikelLimitActive && p.etv < euerSettings.streuArtikelLimitValue) {
            return; 
        }
        productsToUpdate.push({
          ...p,
          festgeschrieben: 1,
          rechnungsNummer: p.rechnungsNummer, 
          last_update_time: Math.floor(Date.now() / 1000)
        });
        updatedProductASINs.add(p.ASIN);
      }
    });

    if (productsToUpdate.length === 0) {
      setFeedbackMessage({ text: "Keine Produkte für Massen-Festschreibung gefunden (älter als Datum, nicht festgeschr., kein Streuartikel).", type: 'info' });
      setIsLoading(false);
      return;
    }

    setProducts(prevProducts =>
      prevProducts.map(p => {
        if (updatedProductASINs.has(p.ASIN)) {
          const updatedP: Product = { 
            ...p, 
            festgeschrieben: 1, 
            last_update_time: Math.floor(Date.now() / 1000) 
          };
          return updatedP;
        }
        return p;
      }).sort((a,b) => (parseDMYtoDate(a.date)?.getTime() || 0) - (parseDMYtoDate(b.date)?.getTime() || 0))
    );

    if (apiToken) {
      const response = await apiUpdateProducts(apiBaseUrl, apiToken, productsToUpdate);
      if (response.status === 'success') {
        setFeedbackMessage({ text: `${productsToUpdate.length} Produkte serverseitig festgeschrieben.`, type: 'success' });
      } else {
        setFeedbackMessage({ text: `Serverfehler bei Massen-Festschreibung: ${response.message || 'Unbekannt.'}`, type: 'error' });
      }
    } else {
      setFeedbackMessage({ text: `${productsToUpdate.length} Produkte lokal festgeschrieben.`, type: 'info' });
    }
    setIsLoading(false);
  };

  const executeBulkBelegFestschreiben = async (
    selectedProductsForBulk: Product[],
    invoiceNumberForBulk: string,
    performancePeriodStart: string, 
    performancePeriodEnd: string,   
    attachExtPdfs: boolean
  ): Promise<{ success: boolean; message: string;}> => {
    const { userData } = belegSettings;
    if (!userData.nameOrCompany.trim() || !userData.addressLine1.trim() || !userData.addressLine2.trim() || !userData.vatId.trim()) {
      return { success: false, message: "Fehler: Wichtige Absenderdaten (Name, Adresse, USt-IdNr.) fehlen in den Beleg-Einstellungen." };
    }
    if (selectedProductsForBulk.length === 0) {
      return { success: false, message: "Keine Produkte für den Sammelbeleg ausgewählt." };
    }

    setIsLoading(true);
    try {
      const bulkBelegText = generateBulkBelegTextForPdf(
        selectedProductsForBulk,
        belegSettings,
        euerSettings,
        invoiceNumberForBulk,
        performancePeriodStart,
        performancePeriodEnd
      );

      const externalPdfUrlsToAppend = attachExtPdfs 
        ? selectedProductsForBulk.map(p => p.pdf).filter((pdfUrl): pdfUrl is string => !!pdfUrl) 
        : [];

      await generatePdfWithAppendedDocs(
        bulkBelegText,
        `${invoiceNumberForBulk}.pdf`,
        externalPdfUrlsToAppend,
        true 
      );

      const nowTimestamp = Math.floor(Date.now() / 1000);
      const updatedProductsInBulk: Product[] = selectedProductsForBulk.map(p => ({
        ...p,
        festgeschrieben: 1,
        rechnungsNummer: invoiceNumberForBulk, 
        last_update_time: nowTimestamp,
      }));

      const updatedProductASINs = new Set(updatedProductsInBulk.map(p => p.ASIN));
      setProducts(prev =>
        prev.map(p => updatedProductASINs.has(p.ASIN)
            ? updatedProductsInBulk.find(up => up.ASIN === p.ASIN)! 
            : p
        ).sort((a,b) => (parseDMYtoDate(a.date)?.getTime() || 0) - (parseDMYtoDate(b.date)?.getTime() || 0))
      );

      if (apiToken) {
        const response = await apiUpdateProducts(apiBaseUrl, apiToken, updatedProductsInBulk);
        if (response.status !== 'success') {
          throw new Error(`Server-Update für Sammelbeleg fehlgeschlagen: ${response.message || 'Unbekannt'}`);
        }
      }
      setIsLoading(false);
      return { success: true, message: `Sammelbeleg ${invoiceNumberForBulk} für ${updatedProductsInBulk.length} Produkte festgeschrieben und PDF heruntergeladen.` };

    } catch (error) {
      setIsLoading(false);
      console.error("Fehler in executeBulkBelegFestschreiben: ", error);
      return { success: false, message: `Fehler beim Festschreiben des Sammelbelegs: ${error instanceof Error ? error.message : String(error)}` };
    }
  };


  const handleExportJson = () => {
    exportToJson(products, `vine_products_export_${new Date().toISOString().split('T')[0]}.json`);
    setFeedbackMessage({text: "Produktdaten als JSON exportiert.", type: 'success'});
  };

  const handleExportXlsx = () => {
    exportToXlsx(products, `vine_products_export_${new Date().toISOString().split('T')[0]}.xlsx`);
    setFeedbackMessage({text: "Produktdaten als XLSX exportiert.", type: 'success'});
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-900 to-slate-700 text-gray-100">
      <Navbar
        activeTab={activeTab}
        onSelectTab={(tab) => { setActiveTab(tab); setFeedbackMessage(null);}}
        onExportJson={handleExportJson}
        onExportXlsx={handleExportXlsx}
        onFullSync={handleFullSync}
      />
      {feedbackMessage && (
        <div className={`fixed top-20 left-1/2 transform -translate-x-1/2 p-3 rounded-md shadow-lg z-[100] text-sm w-11/12 max-w-2xl
                        ${feedbackMessage.type === 'success' ? 'bg-green-600 border border-green-700' : feedbackMessage.type === 'info' ? 'bg-sky-600 border border-sky-700' : 'bg-red-600 border border-red-700'} text-white`}>
          {feedbackMessage.text}
        </div>
      )}
      <main className="flex-grow container mx-auto p-4 sm:p-6 lg:p-8">
        {isLoading && <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[90]"><div className="text-white text-xl">Laden...</div></div>}
        
        {activeTab === TAB_OPTIONS.DASHBOARD && (
          <>
            {!apiToken && products.length === 0 && !isLoading && (
                 <div className="p-6 bg-slate-800 rounded-lg shadow-md border border-slate-700 text-center mb-6">
                    <FaKey size={32} className="mx-auto text-yellow-400 mb-3" />
                    <h3 className="text-lg font-semibold text-gray-100 mb-1">API Token für Server-Synchronisation</h3>
                    <p className="text-sm text-gray-400">
                        Optional: Konfiguriere deinen API Token unter
                        <button 
                            onClick={() => setActiveTab(TAB_OPTIONS.SETTINGS)} 
                            className="text-sky-400 hover:underline font-medium px-1"
                            aria-label="Gehe zu Einstellungen"
                        >
                            Einstellungen
                        </button>
                        um Produktdaten mit dem Server zu synchronisieren.
                    </p>
                </div>
            )}
            <DashboardPage 
                products={products} 
                onUpdateProduct={handleSaveProductDetails} 
                onSaveAndFinalizeProduct={handleSaveAndFinalizeProduct} 
                onFileUpload={handleFileUpload} 
                euerSettings={euerSettings}
                belegSettings={belegSettings} 
            />
          </>
        )}
        {activeTab === TAB_OPTIONS.EUER && (
          <EuerPage 
            products={products} 
            settings={euerSettings} 
            onSettingsChange={setEuerSettings} 
            additionalExpenses={additionalExpenses}
          />
        )}
        {activeTab === TAB_OPTIONS.VERMOEGEN && (
          <VermoegenPage 
            products={products} 
            additionalExpenses={additionalExpenses}
            onAddExpense={handleAddExpense}
            onDeleteExpense={handleDeleteExpense}
          />
        )}
        {activeTab === TAB_OPTIONS.VERKAUFE && (
          <SalesPage 
            products={products} 
            onUpdateProduct={handleSaveProductDetails}
            euerSettings={euerSettings}
            belegSettings={belegSettings}
          />
        )}
        {activeTab === TAB_OPTIONS.BELEGE && (
          <BelegePage 
            products={products}
            euerSettings={euerSettings}
            belegSettings={belegSettings} 
            onBelegSettingsChange={setBelegSettings} 
            onUpdateProduct={handleSaveProductDetails} 
            onExecuteFestschreiben={executeFestschreiben} 
            proposedInvoiceNumbers={proposedInvoiceNumbers} 
            onSaveAndFinalizeProduct={handleSaveAndFinalizeProduct} 
            setAppFeedbackMessage={setFeedbackMessage}
            onExecuteBulkBelegFestschreiben={executeBulkBelegFestschreiben} 
          />
        )}
        {activeTab === TAB_OPTIONS.SETTINGS && (
            <SettingsPage 
                apiToken={apiToken}
                onApiTokenChange={handleApiTokenChange}
                apiBaseUrl={apiBaseUrl}
                onApiBaseUrlChange={setApiBaseUrl}
                euerSettings={euerSettings}
                onEuerSettingsChange={setEuerSettings}
                onDeleteAllServerData={handleDeleteAllServerData}
                onClearLocalDataAndToken={handleClearLocalDataAndToken}
                onBulkFestschreiben={handleBulkFestschreiben}
            />
        )}
      </main>
    </div>
  );
};

export default App;
