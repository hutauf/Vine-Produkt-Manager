
import React, { useState, useEffect, useCallback } from 'react';
import { Product, EuerSettings } from './types';
import { DEFAULT_EUER_SETTINGS, TAB_OPTIONS } from './constants';
import Navbar from './components/Layout/Navbar';
import DashboardPage from './components/Pages/DashboardPage';
import EuerPage from './components/Pages/EuerPage';
import InventoryPage from './components/Pages/InventoryPage';
import SalesPage from './components/Pages/SalesPage';
import SettingsPage from './components/Pages/SettingsPage';
import { parseProductsFromFile } from './utils/fileParser';
import { exportToJson, exportToXlsx } from './utils/dataExporter';
import { apiGetAllProducts, apiUpdateSingleProduct, apiUpdateProducts, apiDeleteAllData } from './utils/apiService';
import { FaKey } from 'react-icons/fa';

const API_TOKEN_STORAGE_KEY = 'vineApp_apiToken';
const EUER_SETTINGS_STORAGE_KEY = 'vineApp_euerSettings';

const App: React.FC = () => {
  const [apiToken, setApiToken] = useState<string | null>(() => localStorage.getItem(API_TOKEN_STORAGE_KEY));
  const [products, setProducts] = useState<Product[]>([]);
  const [euerSettings, setEuerSettings] = useState<EuerSettings>(() => {
    const storedSettings = localStorage.getItem(EUER_SETTINGS_STORAGE_KEY);
    return storedSettings ? JSON.parse(storedSettings) : DEFAULT_EUER_SETTINGS;
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

  const loadProductData = useCallback(async () => {
    if (!apiToken) {
      return;
    }

    setIsLoading(true);
    setFeedbackMessage(null);
    const response = await apiGetAllProducts(apiToken);
    if (response.status === 'success' && response.data) {
      setProducts(response.data);
    } else {
      setProducts([]); 
      const fullErrorMessage = `Fehler beim Laden der Produkte vom Server: ${response.message || 'Unbekannter Fehler.'}`;
      setFeedbackMessage({ text: fullErrorMessage, type: 'error' });
      
      if (response.message && response.message.toLowerCase().includes('failed to fetch')) {
        console.error(
            "Detailed 'Failed to fetch' error received. This is often an environment, CORS, or network issue. See the full error message displayed in the UI and investigate logs from apiService.ts. The original response object from apiService was:", 
            response
        );
      }
      if (response.message?.toLowerCase().includes("invalid token")) {
        setApiToken(null); 
        setFeedbackMessage({ text: "Ungültiger API Token. Bitte in den Einstellungen korrigieren. Serverdaten konnten nicht geladen werden.", type: 'error' });
      }
    }
    setIsLoading(false);
  }, [apiToken]);

  useEffect(() => {
    if (apiToken) {
        loadProductData();
    }
  }, [apiToken, loadProductData]);

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
      setFeedbackMessage({ text: "API Token entfernt. Server-Synchronisation deaktiviert. Bestehende lokale Daten bleiben erhalten.", type: 'info' });
    }
  };

  const handleDeleteAllServerData = async () => {
    if (!apiToken) {
      setFeedbackMessage({ text: "Kein API Token gesetzt. Aktion nicht möglich.", type: 'error' });
      return;
    }
    setIsLoading(true);
    const response = await apiDeleteAllData(apiToken);
    if (response.status === 'success') {
      setProducts([]); 
      setFeedbackMessage({ text: response.message || "Alle Produktdaten auf dem Server erfolgreich gelöscht.", type: 'success' });
    } else {
      setFeedbackMessage({ text: `Fehler beim Löschen der Serverdaten: ${response.message || 'Unbekannter Fehler.'}`, type: 'error' });
    }
    setIsLoading(false);
  };

  const handleClearLocalDataAndToken = () => {
    setApiToken(null); // This will trigger localStorage.removeItem via useEffect
    setProducts([]);
    setFeedbackMessage({ text: "Alle lokalen Produktdaten und der API Token wurden entfernt.", type: 'success' });
  };

  const handleFileUpload = async (file: File) => {
    setIsLoading(true);
    setFeedbackMessage(null);
    try {
      const parsedProductsFromFile = await parseProductsFromFile(file);
      if (parsedProductsFromFile.length === 0) {
        setFeedbackMessage({ text: "Keine Produkte in der Datei gefunden oder Datei ist leer.", type: 'info' });
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
          productsToActuallyProcess.push(pFromFile);
        } else {
          skippedCount++;
        }
      }
      
      if (productsToActuallyProcess.length === 0) {
        setFeedbackMessage({ text: `Keine neuen oder aktuelleren Produkte in der Datei gefunden. ${skippedCount} Produkte wurden übersprungen, da sie älter waren.`, type: 'info' });
        setIsLoading(false);
        return;
      }

      if (!apiToken) {
        setProducts(prevProducts => {
          const productsMap = new Map(prevProducts.map(p => [p.ASIN, p]));
          productsToActuallyProcess.forEach(p => productsMap.set(p.ASIN, p));
          return Array.from(productsMap.values()).sort((a,b) => (a.last_update_time || 0) - (b.last_update_time || 0));
        });
        setFeedbackMessage({ text: `Produkte lokal importiert/aktualisiert (${productsToActuallyProcess.length} verarbeitet, ${skippedCount} ältere übersprungen). Keine Server-Synchronisation ohne API Token.`, type: 'info' });
      } else {
        const response = await apiUpdateProducts(apiToken, productsToActuallyProcess);
        if (response.status === 'success') {
          const { inserted = 0, updated = 0, skipped: apiSkipped = 0 } = response;
          setFeedbackMessage({
            text: `Upload erfolgreich: ${inserted} neu, ${updated} aktualisiert, ${apiSkipped} serverseitig übersprungen. ${skippedCount} clientseitig übersprungen (älter). Daten werden synchronisiert.`,
            type: 'success'
          });
          await loadProductData(); 
        } else {
          setFeedbackMessage({ text: `Fehler beim Speichern der Produkte auf dem Server: ${response.message || 'Unbekannter Fehler.'}`, type: 'error' });
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Fehler beim Verarbeiten der Datei.";
      setFeedbackMessage({ text: errorMessage, type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleUpdateProduct = async (updatedProduct: Product) => {
    const productWithTimestamp = {
        ...updatedProduct,
        last_update_time: Math.floor(Date.now() / 1000) 
    };

    if (!apiToken) {
      setProducts(prevProducts => 
        prevProducts.map(p => 
          p.ASIN === productWithTimestamp.ASIN 
            ? productWithTimestamp
            : p
        )
      );
      setFeedbackMessage({text: `Produkt ${productWithTimestamp.ASIN} lokal aktualisiert. Keine Server-Synchronisation ohne API Token.`, type: 'info'});
      return;
    }

    setIsLoading(true);
    const response = await apiUpdateSingleProduct(apiToken, productWithTimestamp);
    if (response.status === 'success') {
      // Optimistically update local state, server will confirm. Or reload all data.
       setProducts(prevProducts => 
        prevProducts.map(p => 
          p.ASIN === productWithTimestamp.ASIN 
            ? productWithTimestamp 
            : p
        )
      );
      // For critical consistency, could call loadProductData() here too,
      // but for a single update, optimistic update is usually fine.
      setFeedbackMessage({text: `Produkt ${productWithTimestamp.ASIN} auf Server aktualisiert.`, type: 'success'});
    } else {
      setFeedbackMessage({ text: `Fehler beim Aktualisieren von Produkt ${productWithTimestamp.ASIN} auf dem Server: ${response.message || 'Unbekannter Fehler.'}`, type: 'error' });
    }
    setIsLoading(false);
  };

  const handleFullSync = async () => {
    if (!apiToken) {
      setFeedbackMessage({ text: "Kein API Token. Full Sync nicht möglich.", type: 'error' });
      return;
    }
    setIsLoading(true);
    setFeedbackMessage({ text: "Starte vollständige Synchronisation...", type: 'info' });

    // 1. Fetch all data from server
    const serverResponse = await apiGetAllProducts(apiToken);
    if (serverResponse.status === 'error' || !serverResponse.data) {
      setFeedbackMessage({ text: `Fehler beim Abrufen der Serverdaten: ${serverResponse.message || 'Unbekannter Fehler.'}`, type: 'error' });
      setIsLoading(false);
      return;
    }
    const serverProducts = serverResponse.data;
    setFeedbackMessage({ text: `Serverdaten (${serverProducts.length}) erfolgreich abgerufen. Mische mit lokalen Daten...`, type: 'info' });

    // 2. Merge server data with local data
    const currentLocalProducts = products;
    const productMap = new Map<string, Product>();

    // Add all server products to map first (server is initial source of truth for this merge)
    serverProducts.forEach(serverP => {
      productMap.set(serverP.ASIN, serverP);
    });

    // Update map with local products if local is newer, or add if it's local-only
    currentLocalProducts.forEach(localP => {
      const serverVersionInMap = productMap.get(localP.ASIN);
      if (!serverVersionInMap || (localP.last_update_time || 0) > (serverVersionInMap.last_update_time || 0)) {
        productMap.set(localP.ASIN, localP);
      }
    });
    const mergedProducts = Array.from(productMap.values());

    // 3. Update local state
    setProducts(mergedProducts);
    setFeedbackMessage({ text: `Daten gemischt (${mergedProducts.length} Produkte). Lade auf Server hoch...`, type: 'info' });

    // 4. Upload merged data to server
    if (mergedProducts.length > 0) {
        const uploadResponse = await apiUpdateProducts(apiToken, mergedProducts);
        if (uploadResponse.status === 'success') {
            const { inserted = 0, updated = 0, skipped = 0 } = uploadResponse;
            setFeedbackMessage({ text: `Vollständige Synchronisation erfolgreich! Server: ${inserted} neu, ${updated} aktual., ${skipped} überspr. Client aktuell.`, type: 'success' });
            // Optionally, reload data from server again to be absolutely sure, though server is now source of truth.
            // await loadProductData(); 
        } else {
            setFeedbackMessage({ text: `Fehler beim Hochladen der gemischten Daten: ${uploadResponse.message || 'Unbekannter Fehler.'}`, type: 'error' });
        }
    } else {
         setFeedbackMessage({ text: `Vollständige Synchronisation abgeschlossen. Keine Produkte zum Hochladen nach dem Mischen.`, type: 'success' });
    }
    setIsLoading(false);
  };


  const handleExportJson = () => {
    exportToJson(products, `vine_products_export_${new Date().toISOString().split('T')[0]}.json`);
    setFeedbackMessage({text: "Aktuelle Produktdaten als JSON exportiert.", type: 'success'});
  };

  const handleExportXlsx = () => {
    exportToXlsx(products, `vine_products_export_${new Date().toISOString().split('T')[0]}.xlsx`);
    setFeedbackMessage({text: "Aktuelle Produktdaten als XLSX exportiert.", type: 'success'});
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-900 to-slate-700 text-gray-100">
      <Navbar
        activeTab={activeTab}
        onSelectTab={(tab) => { setActiveTab(tab); setFeedbackMessage(null);}}
        onExportJson={handleExportJson}
        onExportXlsx={handleExportXlsx}
        onFullSync={handleFullSync} // Pass handler
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
            {!apiToken && products.length === 0 && !isLoading && activeTab === TAB_OPTIONS.DASHBOARD && (
                 <div className="p-6 bg-slate-800 rounded-lg shadow-md border border-slate-700 text-center mb-6">
                    <FaKey size={32} className="mx-auto text-yellow-400 mb-3" />
                    <h3 className="text-lg font-semibold text-gray-100 mb-1">API Token für Server-Synchronisation</h3>
                    <p className="text-sm text-gray-400">
                        Optional: Konfiguriere deinen API Token auf der
                        <button 
                            onClick={() => setActiveTab(TAB_OPTIONS.SETTINGS)} 
                            className="text-sky-400 hover:underline font-medium px-1"
                            aria-label="Gehe zu Einstellungen"
                        >
                            Einstellungsseite
                        </button>
                        um Produktdaten mit dem Server zu synchronisieren. Du kannst auch ohne Token lokal arbeiten (z.B. per Datei-Upload).
                    </p>
                </div>
            )}
            <DashboardPage 
                products={products} 
                onUpdateProduct={handleUpdateProduct} 
                onFileUpload={handleFileUpload} 
            />
          </>
        )}
        {activeTab === TAB_OPTIONS.EUER && (
          <EuerPage 
            products={products} 
            settings={euerSettings} 
            onSettingsChange={setEuerSettings} 
          />
        )}
        {activeTab === TAB_OPTIONS.LAGER && <InventoryPage products={products} />}
        {activeTab === TAB_OPTIONS.VERKAUFE && (
          <SalesPage 
            products={products} 
            onUpdateProduct={handleUpdateProduct} 
          />
        )}
        {activeTab === TAB_OPTIONS.SETTINGS && (
            <SettingsPage 
                apiToken={apiToken}
                onApiTokenChange={handleApiTokenChange}
                onDeleteAllServerData={handleDeleteAllServerData}
                onClearLocalDataAndToken={handleClearLocalDataAndToken} // Pass new handler
            />
        )}
      </main>
      <footer className="bg-slate-800 text-center p-4 text-sm text-gray-400">
        Vine Produkt Manager &copy; 2024
      </footer>
    </div>
  );
};

export default App;
