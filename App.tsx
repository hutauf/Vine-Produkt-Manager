
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Product, EuerSettings, ProductUsage, BelegSettings, AdditionalExpense } from './types';
import { DEFAULT_EUER_SETTINGS, TAB_OPTIONS, DEFAULT_BELEG_SETTINGS, BELEG_SETTINGS_STORAGE_KEY, DEFAULT_API_BASE_URL, API_BASE_URL_STORAGE_KEY, ADDITIONAL_EXPENSES_STORAGE_KEY } from './constants';
import Navbar from './components/Layout/Navbar';
import DashboardPage from './components/Pages/DashboardPage';
import EuerPage from './components/Pages/EuerPage';
import VermoegenPage from './components/Pages/VermoegenPage'; // Changed from InventoryPage
import SalesPage from './components/Pages/SalesPage';
import SettingsPage from './components/Pages/SettingsPage';
import BelegePage from './components/Pages/BelegePage';
import { mergeParsedProduct, parseProductsFromFile } from './utils/fileParser';
import { exportToJson, exportToXlsx } from './utils/dataExporter';
import { apiGetAllProducts, apiUpdateSingleProduct, apiUpdateProducts, apiDeleteAllData } from './utils/apiService';
import { FaKey } from 'react-icons/fa';
import { parseDMYtoDate, getTodayGermanFormat } from './utils/dateUtils';
import { generateBelegTextForPdf, generateBulkBelegTextForPdf } from './utils/belegUtils';
import { generatePdfWithAppendedDocs } from './utils/pdfGenerator';
import { isProductIgnoredByStreuartikel } from './utils/euerUtils';
import { getNextProductWriteTimestamp } from './utils/productWriteUtils';
import {
  clearAllSyncData,
  cloneProfileProductsIfEmpty,
  migrateLegacyLocalStorage,
  openProductRepository,
  ProductSyncRepository,
} from './utils/syncDatabase';
import { detectSyncProtocol, runV2Sync, runWithProfileSyncLock } from './utils/syncEngine';
import { ConflictRecord } from './utils/syncTypes';


const API_TOKEN_STORAGE_KEY = 'vineApp_apiToken';
const EUER_SETTINGS_STORAGE_KEY = 'vineApp_euerSettings';
const PRODUCTS_STORAGE_KEY = 'vineApp_products';

export const normalizeApiTokenSetting = (token: string | null): string =>
  (token ?? '').trim();

export const normalizeApiBaseUrlSetting = (baseUrl: string): string =>
  baseUrl.trim();

const getApiBaseUrlProfileIdentity = (baseUrl: string): string => {
  const trimmedUrl = normalizeApiBaseUrlSetting(baseUrl);
  try {
    const parsed = new URL(trimmedUrl);
    parsed.hash = '';
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    if (
      (parsed.protocol === 'https:' && parsed.port === '443')
      || (parsed.protocol === 'http:' && parsed.port === '80')
    ) parsed.port = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.toString();
  } catch {
    return trimmedUrl.replace(/\/+$/, '');
  }
};

export const apiTokenSettingsAreEquivalent = (
  currentToken: string | null,
  nextToken: string | null,
): boolean => normalizeApiTokenSetting(currentToken) === normalizeApiTokenSetting(nextToken);

export const apiBaseUrlSettingsAreEquivalent = (
  currentBaseUrl: string,
  nextBaseUrl: string,
): boolean => getApiBaseUrlProfileIdentity(currentBaseUrl) === getApiBaseUrlProfileIdentity(nextBaseUrl);

const sortProductsByOrderDate = (products: Product[]): Product[] =>
  [...products].sort(
    (a, b) => (parseDMYtoDate(a.date)?.getTime() || 0) - (parseDMYtoDate(b.date)?.getTime() || 0),
  );

const canonicalizeLocalProductAsins = (products: Product[]): Product[] => {
  const grouped = new Map<string, Product[]>();
  products.forEach(product => {
    const canonicalAsin = typeof product.ASIN === 'string'
      ? product.ASIN.trim().toUpperCase()
      : '';
    if (!/^[A-Z0-9]{10}$/.test(canonicalAsin)) return;
    const variants = grouped.get(canonicalAsin) || [];
    variants.push(product);
    grouped.set(canonicalAsin, variants);
  });

  return Array.from(grouped, ([canonicalAsin, variants]) => {
    const orderedVariants = [...variants].sort((left, right) => {
      const timestampDifference = (left.last_update_time || 0) - (right.last_update_time || 0);
      if (timestampDifference !== 0) return timestampDifference;
      const canonicalDifference = Number(left.ASIN === canonicalAsin)
        - Number(right.ASIN === canonicalAsin);
      if (canonicalDifference !== 0) return canonicalDifference;
      return left.ASIN.localeCompare(right.ASIN);
    });
    return orderedVariants.reduce<Product>(
      (merged, variant) => ({ ...merged, ...variant, ASIN: canonicalAsin }),
      { ...orderedVariants[0], ASIN: canonicalAsin },
    );
  });
};

type ProductLoadResult = {
  products: Product[];
  success: boolean;
  message?: string;
  invalidToken?: boolean;
};

type ProductSaveResult = {
  success: boolean;
  message?: string;
};

const App: React.FC = () => {
  const [apiToken, setApiToken] = useState<string | null>(() => {
    const normalizedToken = normalizeApiTokenSetting(localStorage.getItem(API_TOKEN_STORAGE_KEY));
    return normalizedToken || null;
  });
  const [apiBaseUrl, setApiBaseUrlState] = useState<string>(() =>
    normalizeApiBaseUrlSetting(localStorage.getItem(API_BASE_URL_STORAGE_KEY) || DEFAULT_API_BASE_URL));
  
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
    return canonicalizeLocalProductAsins(loadedProducts);
  });
  const productsRef = useRef<Product[]>(products);
  const productRepositoryRef = useRef<ProductSyncRepository | null>(null);
  const activeProfileIdRef = useRef<string | null>(null);
  const profileEpochRef = useRef(0);
  const serverOperationTailRef = useRef<Promise<void>>(Promise.resolve());
  const [isProductStorageReady, setIsProductStorageReady] = useState(false);
  const [productStorageReloadRevision, setProductStorageReloadRevision] = useState(0);
  const [syncConflicts, setSyncConflicts] = useState<ConflictRecord[]>([]);
  const [resolvingSyncConflictId, setResolvingSyncConflictId] = useState<number | null>(null);

  const beginProductProfileTransition = useCallback(() => {
    profileEpochRef.current += 1;
    setIsProductStorageReady(false);
  }, []);

  const setCanonicalProducts = useCallback((update: React.SetStateAction<Product[]>) => {
    const candidateProducts = typeof update === 'function'
      ? update(productsRef.current)
      : update;
    const nextProducts = canonicalizeLocalProductAsins(candidateProducts);
    productsRef.current = nextProducts;
    setProducts(nextProducts);
  }, []);

  const runServerOperation = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const execute = async (): Promise<T> => {
      try {
        return await operation();
      } finally {
        try {
          const repository = productRepositoryRef.current;
          setSyncConflicts(repository ? await repository.listConflicts() : []);
        } catch (error) {
          console.error('Failed to refresh the local sync conflict list:', error);
        }
      }
    };
    const result = serverOperationTailRef.current.then(execute, execute);
    serverOperationTailRef.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }, []);

  const filteredProducts = useMemo(
    () => euerSettings.ignoreETVZeroProducts
      ? products.filter(product => product.etv !== 0)
      : products,
    [products, euerSettings.ignoreETVZeroProducts],
  );

  const visibleProducts = useMemo(() => {
    return filteredProducts.map(product => {
      if (euerSettings.useTeilwertV2) {
        return {
          ...product,
          teilwert: product.teilwert_v2 ?? product.teilwert,
          pdf: `https://hutauf.org/oracle2/files/Teilwert_v2_${product.ASIN}.pdf`,
        };
      }

      return {
        ...product,
        pdf: `https://hutauf.org/oracle2/files/PTWMETWS_${product.ASIN}.pdf`,
      };
    });
  }, [filteredProducts, euerSettings.useTeilwertV2]);

  const restoreCanonicalValuationFields = useCallback((product: Product): Product => {
    const canonicalProduct = productsRef.current.find(candidate => candidate.ASIN === product.ASIN);
    if (!canonicalProduct) return product;

    return {
      ...product,
      teilwert: canonicalProduct.teilwert,
      pdf: canonicalProduct.pdf,
    };
  }, []);

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
  const [belegeFocus, setBelegeFocus] = useState<{ invoiceNumber?: string; entnahmeBelegNummer?: string; asin?: string } | null>(null);
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
    const normalizedUrl = normalizeApiBaseUrlSetting(newUrl);
    if (apiBaseUrlSettingsAreEquivalent(apiBaseUrl, normalizedUrl)) {
      setFeedbackMessage({ text: 'API URL ist bereits unverändert gespeichert.', type: 'info' });
      return;
    }
    beginProductProfileTransition();
    setApiBaseUrlState(normalizedUrl);
    setFeedbackMessage({ text: `API URL aktualisiert auf: ${normalizedUrl}. Änderungen werden bei der nächsten Server-Interaktion wirksam.`, type: 'info' });
  };

  useEffect(() => {
    let cancelled = false;
    const initializationEpoch = profileEpochRef.current;
    const isSuperseded = () => (
      cancelled || profileEpochRef.current !== initializationEpoch
    );
    setIsProductStorageReady(false);
    setSyncConflicts([]);
    void (async () => {
      try {
        const previousProfileId = activeProfileIdRef.current;
        const localRepository = await openProductRepository(apiBaseUrl, null);
        if (isSuperseded()) return;
        await migrateLegacyLocalStorage(localRepository.profile);
        if (isSuperseded()) return;
        const repository = apiToken
          ? await openProductRepository(apiBaseUrl, apiToken)
          : localRepository;
        if (isSuperseded()) return;
        if (
          repository.profile.id !== 'local'
          && (previousProfileId == null || previousProfileId === 'local')
        ) {
          await cloneProfileProductsIfEmpty('local', repository.profile.id);
        }
        if (isSuperseded()) return;
        const storedProducts = canonicalizeLocalProductAsins(await repository.getProducts());
        const storedConflicts = await repository.listConflicts();
        if (isSuperseded()) return;
        productRepositoryRef.current = repository;
        activeProfileIdRef.current = repository.profile.id;
        setCanonicalProducts(storedProducts);
        setSyncConflicts(storedConflicts);
        setIsProductStorageReady(true);
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to initialize IndexedDB product storage:', error);
        setFeedbackMessage({
          text: `Lokale Produktdatenbank konnte nicht geöffnet werden: ${error instanceof Error ? error.message : String(error)}`,
          type: 'error',
        });
      }
    })();
    return () => { cancelled = true; };
  }, [apiBaseUrl, apiToken, productStorageReloadRevision, setCanonicalProducts]);

  useEffect(() => {
    const repository = productRepositoryRef.current;
    if (!isProductStorageReady || !repository || !repository.profile.localOnly) return;
    void repository.putProducts(products).catch(error => {
      console.error('Failed to persist products in IndexedDB:', error);
      setFeedbackMessage({
        text: 'Fehler beim Speichern der Produkte in IndexedDB. Die aktuelle Ansicht bleibt erhalten.',
        type: 'error',
      });
    });
  }, [isProductStorageReady, products]);

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


  const fetchMergedProductData = useCallback(async (localProducts: Product[]): Promise<ProductLoadResult> => {
    if (!apiToken) {
      return { products: localProducts, success: false, message: 'Kein API Token konfiguriert.' };
    }

    const serverResponse = await apiGetAllProducts(apiBaseUrl, apiToken);
    if (serverResponse.status !== 'success' || !serverResponse.data) {
      const message = serverResponse.message || 'Unbekannter Fehler.';
      return {
        products: localProducts,
        success: false,
        message,
        invalidToken: message.toLowerCase().includes('invalid token'),
      };
    }

    // Both protocol adapters already apply the durable local outbox/conflict
    // overlay. Merging the previous React state again would revive records that
    // were deleted remotely and create changes which are not represented in the outbox.
    return {
      products: sortProductsByOrderDate(serverResponse.data),
      success: true,
      message: serverResponse.message,
    };
  }, [apiBaseUrl, apiToken]);

  const loadProductData = useCallback(async (): Promise<Product[]> => {
    if (!apiToken || !isProductStorageReady) return productsRef.current;
    const operationEpoch = profileEpochRef.current;

    return runServerOperation(async () => {
      setIsLoading(true);
      setFeedbackMessage(null);
      try {
        const result = await fetchMergedProductData(productsRef.current);
        if (operationEpoch !== profileEpochRef.current) return productsRef.current;
        if (result.success) {
          setCanonicalProducts(result.products);
          setFeedbackMessage({
            text: `Produktdaten erfolgreich vom Server geladen und synchronisiert (${result.products.length} Produkte).${result.message ? ` ${result.message}` : ''}`,
            type: result.message ? 'info' : 'success',
          });
        } else if (result.invalidToken) {
          beginProductProfileTransition();
          setApiToken(null);
          setFeedbackMessage({
            text: 'Ungültiger API Token. Serverdaten konnten nicht geladen werden. Lokale Daten bleiben.',
            type: 'error',
          });
        } else {
          setFeedbackMessage({
            text: `Fehler beim Laden der Produkte vom Server: ${result.message} Lokale Daten werden beibehalten.`,
            type: 'error',
          });
        }
        return result.products;
      } finally {
        setIsLoading(false);
      }
    });
  }, [apiToken, beginProductProfileTransition, fetchMergedProductData, isProductStorageReady, runServerOperation, setCanonicalProducts]);


  const setEuerSettings = (newSettings: EuerSettings | ((prevState: EuerSettings) => EuerSettings)) => {
    setEuerSettingsState(prevSettings => {
        const updatedSettings = typeof newSettings === 'function' ? newSettings(prevSettings) : newSettings;
        
        if (updatedSettings.ignoreETVZeroProducts !== prevSettings.ignoreETVZeroProducts) {
            if (updatedSettings.ignoreETVZeroProducts) {
                setFeedbackMessage({ text: "Produkte mit ETV=0 werden lokal ausgeblendet.", type: 'info' });
            } else {
                 setFeedbackMessage({ text: "Filter für ETV=0 Produkte deaktiviert.", type: 'info' });
            }
        }
        if (updatedSettings.useTeilwertV2 !== prevSettings.useTeilwertV2) {
            setFeedbackMessage({ text: `Teilwert V2 Daten ${updatedSettings.useTeilwertV2 ? 'aktiviert' : 'deaktiviert'}.`, type: 'info' });
        }
        return updatedSettings;
    });
  };

  useEffect(() => {
    if (apiToken && isProductStorageReady) {
        loadProductData();
    }
  }, [apiToken, apiBaseUrl, isProductStorageReady, loadProductData]);

  useEffect(() => {
    localStorage.setItem(EUER_SETTINGS_STORAGE_KEY, JSON.stringify(euerSettings));
  }, [euerSettings]);

  useEffect(() => {
    if (feedbackMessage) {
      const timer = setTimeout(() => setFeedbackMessage(null), 7000);
      return () => clearTimeout(timer);
    }
  }, [feedbackMessage]);

  const handleOpenBelegeTab = (options: { invoiceNumber?: string; entnahmeBelegNummer?: string; asin?: string }) => {
    setBelegeFocus(options);
    setActiveTab(TAB_OPTIONS.BELEGE);
  };

  const handleApiTokenChange = (newToken: string) => {
    const trimmedToken = normalizeApiTokenSetting(newToken);
    if (apiTokenSettingsAreEquivalent(apiToken, trimmedToken)) {
      setFeedbackMessage({ text: 'API Token ist bereits unverändert gespeichert.', type: 'info' });
      return;
    }
    beginProductProfileTransition();
    setApiToken(trimmedToken || null);
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
    try {
      const response = await runServerOperation(async () => {
        return apiDeleteAllData(apiBaseUrl, apiToken);
      });
      if (response.status === 'success') {
        setSyncConflicts([]);
        setFeedbackMessage({ text: response.message || "Alle Produktdaten auf dem Server gelöscht.", type: 'success' });
      } else {
        setFeedbackMessage({ text: `Fehler beim Löschen der Serverdaten: ${response.message || 'Unbekannter Fehler.'}`, type: 'error' });
      }
    } catch (error) {
      setFeedbackMessage({
        text: `Fehler beim Löschen der Serverdaten: ${error instanceof Error ? error.message : String(error)}`,
        type: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearLocalDataAndToken = async () => {
    beginProductProfileTransition();
    try {
      await runServerOperation(() => clearAllSyncData());
      productRepositoryRef.current = null;
      activeProfileIdRef.current = null;
      localStorage.removeItem(PRODUCTS_STORAGE_KEY);
      setApiToken(null);
      setCanonicalProducts([]);
      setSyncConflicts([]);
      setAdditionalExpenses([]);
      setFeedbackMessage({ text: "Lokale Produktdaten, Ausgaben und API Token entfernt.", type: 'success' });
    } catch (error) {
      setFeedbackMessage({
        text: `Lokale Daten konnten nicht gelöscht werden: ${error instanceof Error ? error.message : String(error)}`,
        type: 'error',
      });
    } finally {
      setProductStorageReloadRevision(revision => revision + 1);
    }
  };

  const handleFileUpload = async (file: File) => {
    setIsLoading(true);
    setFeedbackMessage(null);
    try {
      const parsedProductsFromFile = await parseProductsFromFile(file);
      // ETV=0 filter is applied in loadProductData after potential merge
      // Teilwert V2 is also applied in loadProductData

      if (parsedProductsFromFile.length === 0) {
        setFeedbackMessage({ text: `Keine Produkte in Datei gefunden.`, type: 'info' });
        setIsLoading(false);
        return;
      }
      
      const productsToActuallyProcess: Product[] = [];
      const baseProductsForImport: Array<Product | undefined> = [];
      const currentProductsMap = new Map(productsRef.current.map(p => [p.ASIN, p]));
      let skippedCount = 0;
      const importTimestamp = Math.floor(Date.now() / 1000);

      for (const parsedProduct of parsedProductsFromFile) {
        const pFromFile = parsedProduct.product;
        const existingProduct = currentProductsMap.get(pFromFile.ASIN);
        const hasFileTimestamp = typeof pFromFile.last_update_time === 'number'
          && Number.isFinite(pFromFile.last_update_time);
        const fileTimestamp = hasFileTimestamp ? pFromFile.last_update_time! : 0;
        const existingTimestamp = existingProduct?.last_update_time ?? 0;

        if (!existingProduct || !hasFileTimestamp || fileTimestamp >= existingTimestamp) {
          const productToImport: Product = {
            ...mergeParsedProduct(existingProduct, parsedProduct),
            last_update_time: getNextProductWriteTimestamp(
              Math.max(existingTimestamp, fileTimestamp),
              importTimestamp,
            ),
          };
          productsToActuallyProcess.push(productToImport);
          baseProductsForImport.push(existingProduct);
          currentProductsMap.set(productToImport.ASIN, productToImport);
        } else {
          skippedCount++;
        }
      }
      
      if (productsToActuallyProcess.length === 0) {
        setFeedbackMessage({ text: `Keine neuen/aktuelleren Produkte in Datei. ${skippedCount} übersprungen (älter).`, type: 'info' });
        setIsLoading(false);
        return;
      }

      const mergedLocalProducts = sortProductsByOrderDate(Array.from(currentProductsMap.values()));
      setCanonicalProducts(mergedLocalProducts);

      if (!apiToken) {
        setFeedbackMessage({
          text: `Lokal importiert/aktualisiert (${productsToActuallyProcess.length} verarbeitet, ${skippedCount} ältere übersprungen). ETV=0 Filter ${euerSettings.ignoreETVZeroProducts ? 'aktiv' : 'inaktiv'}. Teilwert V2 ${euerSettings.useTeilwertV2 ? 'aktiv' : 'inaktiv'}.`,
          type: 'info',
        });
      } else {
        await runServerOperation(async () => {
          setIsLoading(true);
          const response = await apiUpdateProducts(
            apiBaseUrl,
            apiToken,
            productsToActuallyProcess,
            baseProductsForImport,
          );
          if (response.status !== 'success') {
            setFeedbackMessage({
              text: `Fehler beim Server-Upload: ${response.message || 'Unbekannter Fehler.'} Der Import bleibt lokal gespeichert.`,
              type: 'error',
            });
            return;
          }

          const { inserted = 0, updated = 0, skipped: apiSkipped = 0 } = response;
          const refreshed = await fetchMergedProductData(productsRef.current);
          if (refreshed.success) {
            setCanonicalProducts(refreshed.products);
          }
          setFeedbackMessage({
            text: `Upload: ${inserted} neu, ${updated} aktualisiert, ${apiSkipped} serverseitig / ${skippedCount} clientseitig übersprungen.`,
            type: refreshed.success ? 'success' : 'info',
          });
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Fehler bei Dateiverarbeitung.";
      setFeedbackMessage({ text: errorMessage, type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResolveSyncConflict = async (
    conflictId: number,
    resolution: 'server' | 'local',
  ): Promise<void> => {
    const repository = productRepositoryRef.current;
    if (!repository) {
      setFeedbackMessage({ text: 'Die lokale Produktdatenbank ist noch nicht bereit.', type: 'error' });
      return;
    }
    const operationEpoch = profileEpochRef.current;
    setResolvingSyncConflictId(conflictId);
    setIsLoading(true);
    try {
      await runServerOperation(async () => {
        const selectedConflict = (await repository.listConflicts())
          .find(conflict => conflict.id === conflictId);
        await runWithProfileSyncLock(
          repository.profile.id,
          () => repository.resolveConflict(conflictId, resolution),
        );
        if (operationEpoch !== profileEpochRef.current) return;
        if (resolution === 'local' && apiToken) {
          const localProduct = (await repository.getProducts())
            .find(product => product.ASIN === selectedConflict?.entityId);
          const capabilities = await detectSyncProtocol(repository, apiBaseUrl, apiToken);
          if (capabilities) {
            const syncResult = await runV2Sync(
              repository,
              apiBaseUrl,
              apiToken,
              capabilities,
            );
            if (operationEpoch !== profileEpochRef.current) return;
            setCanonicalProducts(syncResult.products);
          } else if (localProduct) {
            const upload = await apiUpdateSingleProduct(apiBaseUrl, apiToken, localProduct);
            if (upload.status !== 'success' || (upload.skipped ?? 0) > 0) {
              throw new Error(
                upload.message || 'Die lokale Konfliktlösung konnte nicht per V1 synchronisiert werden.',
              );
            }
            if (operationEpoch !== profileEpochRef.current) return;
            const refreshed = await apiGetAllProducts(apiBaseUrl, apiToken);
            if (refreshed.status !== 'success' || !refreshed.data) {
              throw new Error(refreshed.message || 'Der bestätigte Serverstand konnte nicht geladen werden.');
            }
            if (operationEpoch !== profileEpochRef.current) return;
            setCanonicalProducts(refreshed.data);
          } else {
            setCanonicalProducts(await repository.getProducts());
            throw new Error(
              'Der alte V1-Server kann eine einzelne lokale Löschung nicht sicher synchronisieren. '
              + 'Die Löschung bleibt lokal vorgemerkt, bis der Server V2 unterstützt.',
            );
          }
          const sameEntityStillConflicts = selectedConflict
            && (await repository.listConflicts()).some(conflict => (
              conflict.entityType === selectedConflict.entityType
              && conflict.entityId === selectedConflict.entityId
            ));
          if (sameEntityStillConflicts) {
            throw new Error('Die Änderung kollidiert weiterhin mit einem neueren Serverstand.');
          }
        } else {
          setCanonicalProducts(await repository.getProducts());
        }
      });
      if (operationEpoch !== profileEpochRef.current) return;
      setFeedbackMessage({
        text: resolution === 'local'
          ? 'Lokale Änderung wurde auf den aktuellen Serverstand übertragen.'
          : 'Serverstand wurde für den Konflikt übernommen.',
        type: 'success',
      });
    } catch (error) {
      if (operationEpoch === profileEpochRef.current) {
        setFeedbackMessage({
          text: `Konflikt konnte nicht aufgelöst werden: ${error instanceof Error ? error.message : String(error)}`,
          type: 'error',
        });
      }
    } finally {
      setResolvingSyncConflictId(null);
      setIsLoading(false);
    }
  };
  
  const saveProductDetails = async (updatedProduct: Product): Promise<ProductSaveResult> => {
    const previousProduct = productsRef.current.find(product => product.ASIN === updatedProduct.ASIN);
    const productWithTimestamp: Product = {
        ...restoreCanonicalValuationFields(updatedProduct),
        last_update_time: getNextProductWriteTimestamp(
          previousProduct?.last_update_time ?? updatedProduct.last_update_time,
        ),
    };

    setCanonicalProducts(prevProducts =>
        sortProductsByOrderDate(prevProducts.map(p =>
            p.ASIN === productWithTimestamp.ASIN 
            ? productWithTimestamp
            : p
        )),
    );

    if (!apiToken) {
      const hiddenByFilter = euerSettings.ignoreETVZeroProducts && productWithTimestamp.etv === 0;
      setFeedbackMessage({
        text: hiddenByFilter
          ? `Produkt ${productWithTimestamp.ASIN} lokal aktualisiert und durch den aktiven ETV=0 Filter ausgeblendet.`
          : `Produkt ${productWithTimestamp.ASIN} lokal aktualisiert.`,
        type: 'info',
      });
      return { success: true };
    }

    setIsLoading(true);
    try {
      return await runServerOperation(async (): Promise<ProductSaveResult> => {
        setIsLoading(true);
        const response = await apiUpdateSingleProduct(
          apiBaseUrl,
          apiToken,
          productWithTimestamp,
          previousProduct,
        );
        if (response.status !== 'success') {
          const message = `Server-Aktualisierungsfehler für ${productWithTimestamp.ASIN}: ${response.message || 'Unbekannt.'} Lokale Änderung bleibt.`;
          setFeedbackMessage({ text: message, type: 'error' });
          return { success: false, message };
        }
        if ((response.skipped ?? 0) > 0) {
          const refreshed = await fetchMergedProductData(productsRef.current);
          if (refreshed.success) {
            setCanonicalProducts(refreshed.products);
          }
          const message = `Server hat die Aktualisierung für ${productWithTimestamp.ASIN} als veraltet übersprungen.`;
          setFeedbackMessage({ text: message, type: 'error' });
          return { success: false, message };
        }

        const refreshed = await fetchMergedProductData(productsRef.current);
        if (refreshed.success) {
          setCanonicalProducts(refreshed.products);
        }
        setFeedbackMessage({
          text: refreshed.success
            ? `Produkt ${productWithTimestamp.ASIN} auf Server aktualisiert.`
            : `Produkt ${productWithTimestamp.ASIN} auf Server aktualisiert; anschließendes Neuladen fehlgeschlagen.`,
          type: refreshed.success ? 'success' : 'info',
        });
        return { success: true };
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveProductDetails = async (updatedProduct: Product): Promise<void> => {
    await saveProductDetails(updatedProduct);
  };

  const proposedInvoiceNumbers = useMemo(() => {
    const newProposedNumbers = new Map<string, string>();
    const productsByYear: { [year: string]: Product[] } = {};

    visibleProducts.forEach(p => {
      const orderDate = parseDMYtoDate(p.date);
      if (orderDate) {
        const year = orderDate.getUTCFullYear().toString();
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
            if (isProductIgnoredByStreuartikel(p, euerSettings)) {
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
  }, [visibleProducts, euerSettings.streuArtikelLimitActive, euerSettings.streuArtikelLimitValue]);


  const executeFestschreiben = async (
    productToFinalize: Product,
    attachExtPdf: boolean
  ): Promise<{ success: boolean; message: string; invoiceNumber?: string }> => {
    
    const { userData } = belegSettings;
    if (!userData.nameOrCompany.trim() || !userData.addressLine1.trim() || !userData.addressLine2.trim() || !userData.vatId.trim()) {
      return { success: false, message: "Fehler: Wichtige Absenderdaten (Name, Adresse, USt-IdNr.) fehlen in den Beleg-Einstellungen." };
    }

    if (isProductIgnoredByStreuartikel(productToFinalize, euerSettings)) {
      return { success: false, message: "Fehler: Streuartikel können nicht festgeschrieben werden." };
    }

    const invoiceNumberToAssign = productToFinalize.rechnungsNummer 
        ? productToFinalize.rechnungsNummer 
        : proposedInvoiceNumbers.get(productToFinalize.ASIN);

    if (!invoiceNumberToAssign || invoiceNumberToAssign === "(Nummer wird ermittelt)") { 
      return { success: false, message: "Fehler: Rechnungsnummer für Festschreibung nicht gefunden oder noch nicht ermittelt." };
    }
    
    const previousProduct = productsRef.current.find(product => product.ASIN === productToFinalize.ASIN);
    const finalizedTimestamp = getNextProductWriteTimestamp(
      previousProduct?.last_update_time ?? productToFinalize.last_update_time,
    );
    const finalizedProductForDocument: Product = {
      ...productToFinalize,
      festgeschrieben: 1,
      rechnungsNummer: invoiceNumberToAssign,
      last_update_time: finalizedTimestamp,
    };
    const finalizedProductData: Product = {
      ...restoreCanonicalValuationFields(productToFinalize),
      festgeschrieben: 1,
      rechnungsNummer: invoiceNumberToAssign,
      last_update_time: finalizedProductForDocument.last_update_time,
    };

    setIsLoading(true); 
    try {
        const belegTextForPdf = generateBelegTextForPdf(finalizedProductForDocument, belegSettings, euerSettings, invoiceNumberToAssign);
        if (belegTextForPdf.startsWith("Fehler:") || belegTextForPdf.startsWith("Streuartikel:")) {
            throw new Error(belegTextForPdf);
        }

        await generatePdfWithAppendedDocs(
            belegTextForPdf, 
            `${invoiceNumberToAssign}.pdf`,
            attachExtPdf && finalizedProductForDocument.pdf ? [finalizedProductForDocument.pdf] : [],
            false 
        );
        
        setCanonicalProducts(prev =>
            sortProductsByOrderDate(
              prev.map(p => p.ASIN === finalizedProductData.ASIN ? finalizedProductData : p),
            )
        );

        if (apiToken) {
            const response = await runServerOperation(
              () => apiUpdateSingleProduct(
                apiBaseUrl,
                apiToken,
                finalizedProductData,
                productToFinalize,
              ),
            );
            if (response.status !== 'success') {
                throw new Error(`Server-Update fehlgeschlagen: ${response.message || 'Unbekannt'}`);
            }
            if ((response.skipped ?? 0) > 0) {
                throw new Error(`Server hat die Festschreibung für ${finalizedProductData.ASIN} als veraltet übersprungen.`);
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
    const saveResult = await saveProductDetails(productToSaveAndFinalize);
    if (!saveResult.success) {
      const message = `${saveResult.message || 'Produkt konnte nicht gespeichert werden.'} Festschreibung wurde nicht gestartet.`;
      setFeedbackMessage({ text: message, type: 'error' });
      return { success: false, message };
    }
    const canonicalProduct = productsRef.current.find(
      p => p.ASIN === productToSaveAndFinalize.ASIN,
    ) || restoreCanonicalValuationFields(productToSaveAndFinalize);
    const potentiallyUpdatedProduct = euerSettings.useTeilwertV2
      ? {
          ...canonicalProduct,
          teilwert: canonicalProduct.teilwert_v2 ?? canonicalProduct.teilwert,
          pdf: `https://hutauf.org/oracle2/files/Teilwert_v2_${canonicalProduct.ASIN}.pdf`,
        }
      : {
          ...canonicalProduct,
          pdf: `https://hutauf.org/oracle2/files/PTWMETWS_${canonicalProduct.ASIN}.pdf`,
        };
    
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

    try {
      await runServerOperation(async () => {
        setIsLoading(true);
        const pulled = await fetchMergedProductData(productsRef.current);
        if (!pulled.success) {
          if (pulled.invalidToken) {
            beginProductProfileTransition();
            setApiToken(null);
          }
          setFeedbackMessage({
            text: `Vollständige Synchronisation abgebrochen: Serverdaten konnten nicht geladen werden (${pulled.message || 'unbekannter Fehler'}). Es wurde nichts hochgeladen.`,
            type: 'error',
          });
          return;
        }

        setCanonicalProducts(pulled.products);
        if (pulled.products.length === 0) {
          setFeedbackMessage({
            text: 'Vollständige Synchronisation abgeschlossen. Keine Produkte vorhanden.',
            type: 'success',
          });
          return;
        }

        const now = Math.floor(Date.now() / 1000);
        const productsWithTimestamps = pulled.products.map(product => ({
          ...product,
          last_update_time: product.last_update_time || now,
        }));

        setFeedbackMessage({
          text: `Lokale und Serverdaten gemischt (${productsWithTimestamps.length}). Lade auf Server hoch...`,
          type: 'info',
        });
        const uploadResponse = await apiUpdateProducts(
          apiBaseUrl,
          apiToken,
          productsWithTimestamps,
          pulled.products,
        );
        if (uploadResponse.status !== 'success') {
          setFeedbackMessage({
            text: `Fehler beim Hochladen der gemischten Daten: ${uploadResponse.message || 'Unbekannter Fehler.'}`,
            type: 'error',
          });
          return;
        }

        const verified = await fetchMergedProductData(productsWithTimestamps);
        if (verified.success) {
          setCanonicalProducts(verified.products);
        }

        const { inserted = 0, updated = 0, skipped = 0 } = uploadResponse;
        setFeedbackMessage({
          text: verified.success
            ? `Vollständige Synchronisation erfolgreich! Server: ${inserted} neu, ${updated} aktual., ${skipped} überspr.`
            : `Upload erfolgreich (Server: ${inserted} neu, ${updated} aktual., ${skipped} überspr.), abschließende Prüfung fehlgeschlagen.`,
          type: verified.success ? 'success' : 'info',
        });
      });
    } finally {
      setIsLoading(false);
    }
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
    const writeTimestamp = Math.floor(Date.now() / 1000);

    visibleProducts.forEach(p => {
      const orderDate = parseDMYtoDate(p.date);
      if (orderDate && orderDate < thresholdDate && p.festgeschrieben !== 1) {
        if (isProductIgnoredByStreuartikel(p, euerSettings)) {
            return; 
        }
        const previousProduct = productsRef.current.find(product => product.ASIN === p.ASIN);
        productsToUpdate.push({
          ...restoreCanonicalValuationFields(p),
          festgeschrieben: 1,
          rechnungsNummer: p.rechnungsNummer, 
          last_update_time: getNextProductWriteTimestamp(
            previousProduct?.last_update_time ?? p.last_update_time,
            writeTimestamp,
          ),
        });
      }
    });

    if (productsToUpdate.length === 0) {
      setFeedbackMessage({ text: "Keine Produkte für Massen-Festschreibung gefunden (älter als Datum, nicht festgeschr., kein Streuartikel).", type: 'info' });
      setIsLoading(false);
      return;
    }

    const updatesByAsin = new Map(productsToUpdate.map(product => [product.ASIN, product]));
    const baseProducts = productsToUpdate
      .map(product => productsRef.current.find(current => current.ASIN === product.ASIN));
    setCanonicalProducts(prevProducts =>
      sortProductsByOrderDate(
        prevProducts.map(product => updatesByAsin.get(product.ASIN) ?? product),
      )
    );

    if (apiToken) {
      const response = await runServerOperation(
        () => apiUpdateProducts(apiBaseUrl, apiToken, productsToUpdate, baseProducts),
      );
      if (response.status === 'success' && (response.skipped ?? 0) === 0) {
        setFeedbackMessage({ text: `${productsToUpdate.length} Produkte serverseitig festgeschrieben.`, type: 'success' });
      } else if (response.status === 'success') {
        setFeedbackMessage({
          text: `Massen-Festschreibung nur teilweise synchronisiert: ${response.skipped} Server-Updates wurden als veraltet übersprungen.`,
          type: 'error',
        });
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
      const updatedProductsInBulk: Product[] = selectedProductsForBulk.map(p => {
        const previousProduct = productsRef.current.find(product => product.ASIN === p.ASIN);
        return {
          ...restoreCanonicalValuationFields(p),
          festgeschrieben: 1,
          rechnungsNummer: invoiceNumberForBulk,
          last_update_time: getNextProductWriteTimestamp(
            previousProduct?.last_update_time ?? p.last_update_time,
            nowTimestamp,
          ),
        };
      });

      const updatedProductASINs = new Set(updatedProductsInBulk.map(p => p.ASIN));
      const baseProducts = updatedProductsInBulk
        .map(product => productsRef.current.find(current => current.ASIN === product.ASIN));
      setCanonicalProducts(prev =>
        sortProductsByOrderDate(
          prev.map(p => updatedProductASINs.has(p.ASIN)
              ? updatedProductsInBulk.find(up => up.ASIN === p.ASIN)!
              : p
          ),
        )
      );

      if (apiToken) {
        const response = await runServerOperation(
          () => apiUpdateProducts(apiBaseUrl, apiToken, updatedProductsInBulk, baseProducts),
        );
        if (response.status !== 'success') {
          throw new Error(`Server-Update für Sammelbeleg fehlgeschlagen: ${response.message || 'Unbekannt'}`);
        }
        if ((response.skipped ?? 0) > 0) {
          throw new Error(`${response.skipped} Server-Updates für den Sammelbeleg wurden als veraltet übersprungen.`);
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
    exportToJson(visibleProducts, `vine_products_export_${getTodayGermanFormat().replace(/\./g, '-')}.json`);
    setFeedbackMessage({text: "Produktdaten als JSON exportiert.", type: 'success'});
  };

  const handleExportXlsx = () => {
    exportToXlsx(visibleProducts, `vine_products_export_${getTodayGermanFormat().replace(/\./g, '-')}.xlsx`);
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
        {(!isProductStorageReady || isLoading) && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[90]"
            role="status"
            aria-live="polite"
          >
            <div className="text-white text-xl">
              {isProductStorageReady ? 'Laden...' : 'Lokale Produktdatenbank wird vorbereitet...'}
            </div>
          </div>
        )}
        
        {activeTab === TAB_OPTIONS.DASHBOARD && (
          <>
            {!apiToken && visibleProducts.length === 0 && !isLoading && (
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
                products={visibleProducts}
                onUpdateProduct={handleSaveProductDetails} 
                onSaveAndFinalizeProduct={handleSaveAndFinalizeProduct} 
                onFileUpload={handleFileUpload} 
                euerSettings={euerSettings}
                belegSettings={belegSettings}
                apiToken={apiToken}
                apiBaseUrl={apiBaseUrl}
            />
          </>
        )}
        {activeTab === TAB_OPTIONS.EUER && (
          <EuerPage 
            products={visibleProducts}
            settings={euerSettings} 
            onSettingsChange={setEuerSettings} 
            additionalExpenses={additionalExpenses}
            apiToken={apiToken}
            apiBaseUrl={apiBaseUrl}
            belegSettings={belegSettings}
            onBelegSettingsChange={setBelegSettings}
          />
        )}
        {activeTab === TAB_OPTIONS.VERMOEGEN && (
          <VermoegenPage
            products={visibleProducts}
            additionalExpenses={additionalExpenses}
            onAddExpense={handleAddExpense}
            onDeleteExpense={handleDeleteExpense}
            onUpdateProduct={handleSaveProductDetails}
            euerSettings={euerSettings}
            belegSettings={belegSettings}
            apiToken={apiToken}
            apiBaseUrl={apiBaseUrl}
            onOpenBelegeTab={handleOpenBelegeTab}
          />
        )}
        {activeTab === TAB_OPTIONS.VERKAUFE && (
          <SalesPage
            products={visibleProducts}
            onUpdateProduct={handleSaveProductDetails}
            euerSettings={euerSettings}
            belegSettings={belegSettings}
            apiToken={apiToken}
            apiBaseUrl={apiBaseUrl}
            onOpenBelegeTab={handleOpenBelegeTab}
          />
        )}
        {activeTab === TAB_OPTIONS.BELEGE && (
          <BelegePage 
            products={visibleProducts}
            euerSettings={euerSettings}
            belegSettings={belegSettings} 
            onBelegSettingsChange={setBelegSettings} 
            onUpdateProduct={handleSaveProductDetails} 
            onExecuteFestschreiben={executeFestschreiben} 
            proposedInvoiceNumbers={proposedInvoiceNumbers} 
            onSaveAndFinalizeProduct={handleSaveAndFinalizeProduct} 
            setAppFeedbackMessage={setFeedbackMessage}
            onExecuteBulkBelegFestschreiben={executeBulkBelegFestschreiben} 
            focusOptions={belegeFocus}
            onFocusConsumed={() => setBelegeFocus(null)}
            apiToken={apiToken}
            apiBaseUrl={apiBaseUrl}
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
                syncConflicts={syncConflicts}
                resolvingSyncConflictId={resolvingSyncConflictId}
                onResolveSyncConflict={handleResolveSyncConflict}
            />
        )}
      </main>
    </div>
  );
};

export default App;
