
import React, { useState, useMemo } from 'react';
import { Product, ProductUsage, EuerSettings, BelegSettings } from '../../types';
import ProductTable from '../Products/ProductTable';
import FileUpload from '../Products/FileUpload';
import ProductPlots from '../Dashboard/ProductPlots';
import { FaFilter, FaTimes, FaSearch } from 'react-icons/fa';
import { parseDMYtoDate } from '../../utils/dateUtils';

interface DashboardPageProps {
  products: Product[];
  onUpdateProduct: (product: Product) => Promise<void>;
  onSaveAndFinalizeProduct: (product: Product, attachPdf: boolean) => Promise<{success: boolean; message: string}>; // New prop
  onFileUpload: (file: File) => Promise<void>;
  euerSettings: EuerSettings;
  belegSettings: BelegSettings; // New prop
}

const DashboardPage: React.FC<DashboardPageProps> = ({ 
    products, 
    onUpdateProduct, 
    onSaveAndFinalizeProduct,
    onFileUpload, 
    euerSettings,
    belegSettings 
}) => {
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [hideCancelled, setHideCancelled] = useState<boolean>(false);
  const [hideFinalized, setHideFinalized] = useState<boolean>(true); // New filter, default true
  const [globalSearchTerm, setGlobalSearchTerm] = useState<string>('');
  const [isLoadingUpload, setIsLoadingUpload] = useState<boolean>(false);

  const getCalculatedTeilwert = (product: Product): number => {
    if (product.myTeilwert != null) return product.myTeilwert;
    if (product.teilwert != null) return product.teilwert;
    return 0;
  };
  
  const formatDateForSearch = (dateString: string): string => {
    const dateObj = parseDMYtoDate(dateString);
    return dateObj ? dateObj.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : dateString;
  };

  const availableYears = useMemo(() => {
    const years = new Set(
      products.reduce((acc, p) => {
        if (p.date && typeof p.date === 'string') {
          const parts = p.date.split('/');
          if (parts.length === 3 && parts[2]) {
            acc.add(parts[2]);
          }
        }
        return acc;
      }, new Set<string>())
    );
    return ['all', ...Array.from(years).sort((a,b) => parseInt(b) - parseInt(a))];
  }, [products]);

  const filteredProducts = useMemo(() => {
    let tempProducts = products; 

    if (globalSearchTerm) {
      const lowerSearchTerm = globalSearchTerm.toLowerCase();
      tempProducts = tempProducts.filter(p => {
        const calculatedTeilwert = getCalculatedTeilwert(p);
        return (
          p.ASIN.toLowerCase().includes(lowerSearchTerm) ||
          p.name.toLowerCase().includes(lowerSearchTerm) ||
          p.ordernumber.toLowerCase().includes(lowerSearchTerm) ||
          formatDateForSearch(p.date).includes(lowerSearchTerm) || 
          p.etv.toString().includes(lowerSearchTerm) ||
          calculatedTeilwert.toString().includes(lowerSearchTerm) ||
          (p.myTeilwert?.toString() ?? '').includes(lowerSearchTerm) ||
          (p.teilwert.toString() ?? '').includes(lowerSearchTerm) ||
          p.usageStatus.join(', ').toLowerCase().includes(lowerSearchTerm)
        );
      });
    }

    return tempProducts.filter(p => {
      if (yearFilter !== 'all') {
        if (!p.date || typeof p.date !== 'string') {
          return false; 
        }
        const dateParts = p.date.split('/');
        if (dateParts.length !== 3 || dateParts[2] !== yearFilter) {
          return false;
        }
      }
      if (hideCancelled && p.usageStatus.includes(ProductUsage.STORNIERT)) return false;
      if (hideFinalized && p.festgeschrieben === 1) return false; // New filter condition
      return true;
    });
  }, [products, yearFilter, hideCancelled, hideFinalized, globalSearchTerm, euerSettings.ignoreETVZeroProducts]);
  
  const handleFileUploadInternal = async (file: File) => {
    setIsLoadingUpload(true);
    await onFileUpload(file);
    setIsLoadingUpload(false);
  };

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1">
           <FileUpload onFileUpload={handleFileUploadInternal} isLoading={isLoadingUpload} />
        </div>
        <div className="md:col-span-2 p-6 bg-slate-800 rounded-lg shadow-md border border-slate-700">
            <h3 className="text-lg font-semibold text-gray-100 mb-4 flex items-center">
                <FaFilter className="mr-2 text-sky-400" /> Filteroptionen
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4"> {/* Changed to sm:grid-cols-3 */}
                <div>
                    <label htmlFor="yearFilter" className="block text-sm font-medium text-gray-300">Jahr</label>
                    <select
                        id="yearFilter"
                        value={yearFilter}
                        onChange={(e) => setYearFilter(e.target.value)}
                        className="mt-1 block w-full pl-3 pr-10 py-2 text-base bg-slate-700 border-slate-600 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm rounded-md text-gray-100"
                    >
                        {availableYears.map(year => <option key={year} value={year}>{year === 'all' ? 'Alle Jahre' : year}</option>)}
                    </select>
                </div>
                <div className="flex items-end">
                     <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer p-2 bg-slate-700 rounded-md hover:bg-slate-600 w-full h-10">
                        <input
                            type="checkbox"
                            checked={hideCancelled}
                            onChange={(e) => setHideCancelled(e.target.checked)}
                            className="form-checkbox h-4 w-4 text-sky-600 bg-slate-600 border-slate-500 rounded focus:ring-sky-500"
                        />
                        <span>Stornierte ausbl.</span>
                    </label>
                </div>
                <div className="flex items-end"> {/* New filter for finalized */}
                     <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer p-2 bg-slate-700 rounded-md hover:bg-slate-600 w-full h-10">
                        <input
                            type="checkbox"
                            checked={hideFinalized}
                            onChange={(e) => setHideFinalized(e.target.checked)}
                            className="form-checkbox h-4 w-4 text-sky-600 bg-slate-600 border-slate-500 rounded focus:ring-sky-500"
                        />
                        <span>Festgeschr. ausbl.</span>
                    </label>
                </div>
            </div>
             <p className="text-xs text-gray-400 mt-3">
                Hinweis: Das Ausblenden von ETV=0 Produkten ist eine globale Einstellung ("Einstellungen").
            </p>
        </div>
      </div>
      
      <ProductPlots products={filteredProducts} yearFilter={yearFilter} />

      <div className="p-6 bg-slate-800 rounded-lg shadow-md border border-slate-700 mb-6">
        <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <FaSearch className="text-gray-400" />
            </div>
            <input
                type="search"
                name="globalSearch"
                id="globalSearch"
                value={globalSearchTerm}
                onChange={(e) => setGlobalSearchTerm(e.target.value)}
                placeholder="Produkte durchsuchen (ASIN, Name, Datum, ETV, Teilwert, Status...)"
                className="block w-full pl-10 pr-3 py-2.5 bg-slate-700 border border-slate-600 rounded-md text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm"
                aria-label="Produkte global durchsuchen"
            />
        </div>
      </div>

      <div>
        <h2 className="text-2xl font-semibold text-gray-100 mb-4">Produktliste ({filteredProducts.length})</h2>
        {filteredProducts.length > 0 ? (
            <ProductTable 
                products={filteredProducts} 
                onUpdateProduct={onUpdateProduct} 
                onSaveAndFinalizeProduct={onSaveAndFinalizeProduct} // Pass new handler
                euerSettings={euerSettings} // Pass EuerSettings
                belegSettings={belegSettings} // Pass BelegSettings
            />
        ): (
            <div className="text-center py-10 bg-slate-800 rounded-lg shadow-md border border-slate-700">
                <FaTimes size={48} className="mx-auto text-gray-500" />
                <p className="mt-4 text-lg text-gray-400">Keine Produkte für die aktuellen Filter und Suchbegriffe gefunden.</p>
                <p className="text-sm text-gray-500">Versuchen Sie, die Filter anzupassen oder Daten hochzuladen.</p>
                 {euerSettings.ignoreETVZeroProducts && <p className="text-sm text-yellow-400 mt-2">Hinweis: ETV=0 Produkte sind global ausgeblendet.</p>}
                 {hideFinalized && <p className="text-sm text-yellow-400 mt-2">Hinweis: Festgeschriebene Produkte sind ausgeblendet.</p>}
            </div>
        )}
      </div>
    </div>
  );
};

export default DashboardPage;
