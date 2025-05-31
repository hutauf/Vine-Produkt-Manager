
import React, { useMemo, useState, useEffect } from 'react';
import { Product, ProductUsage, EuerSettings, BelegSettings, SalesPageProps } from '../../types';
import EditProductModal from '../Products/EditProductModal';
import SalesPlots from '../Sales/SalesPlots'; // Import the new SalesPlots component
import { FaDollarSign, FaEdit, FaSort, FaSortUp, FaSortDown, FaTimesCircle, FaFilter } from 'react-icons/fa';
import Button from '../Common/Button';
import { parseDMYtoDate, parseGermanDate } from '../../utils/dateUtils';

type SortKey = 'ASIN' | 'name' | 'orderDate' | 'saleDate' | 'salePrice' | 'etv' | 'calculatedTeilwert';
type SortOrder = 'asc' | 'desc';

const SalesPage: React.FC<SalesPageProps> = ({ products, onUpdateProduct, euerSettings, belegSettings }) => {
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('saleDate');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [selectedPlotYear, setSelectedPlotYear] = useState<string>(new Date().getFullYear().toString());

  const getCalculatedTeilwert = (product: Product): number => {
    if (product.myTeilwert != null) return product.myTeilwert;
    if (product.teilwert != null) return product.teilwert;
    return product.etv; // Fallback to ETV if no teilwert
  };

  const allSoldProducts = useMemo(() => {
    return products.filter(p => p.usageStatus.includes(ProductUsage.VERKAUFT) && p.saleDate && p.salePrice != null);
  }, [products]);

  const availablePlotYears = useMemo(() => {
    const years = new Set<string>();
    allSoldProducts.forEach(p => {
      if (p.saleDate) {
        const saleDateObj = parseGermanDate(p.saleDate);
        if (saleDateObj) years.add(saleDateObj.getFullYear().toString());
      }
    });
    const currentYear = new Date().getFullYear().toString();
    if (!years.has(currentYear) && allSoldProducts.length > 0) years.add(currentYear); // Add current year if not present but sales exist
    else if (allSoldProducts.length === 0 && !years.has(currentYear)) years.add(currentYear); // Add current year if no sales at all


    const sortedYears = Array.from(years).sort((a, b) => parseInt(b) - parseInt(a));
    return ['all', ...sortedYears];
  }, [allSoldProducts]);

  // Ensure selectedPlotYear is valid, fallback if not
  useEffect(() => {
    if (!availablePlotYears.includes(selectedPlotYear)) {
      setSelectedPlotYear(availablePlotYears.length > 1 ? availablePlotYears[1] : // Default to most recent actual year or 'all'
                         (availablePlotYears.includes(new Date().getFullYear().toString()) ? new Date().getFullYear().toString() : 'all'));
    }
  }, [availablePlotYears, selectedPlotYear]);


  const filteredSoldProductsForTableAndPlots = useMemo(() => {
    let filtered = allSoldProducts;
    if (selectedPlotYear !== 'all') {
      filtered = allSoldProducts.filter(p => {
        if (!p.saleDate) return false;
        const saleDateObj = parseGermanDate(p.saleDate);
        return saleDateObj && saleDateObj.getFullYear().toString() === selectedPlotYear;
      });
    }
    
    return filtered
      .map(p => ({
        ...p,
        orderDateObj: parseDMYtoDate(p.date),
        saleDateObj: p.saleDate ? parseGermanDate(p.saleDate) : null,
      }))
      .sort((a, b) => {
        let valA: any;
        let valB: any;
        switch (sortKey) {
          case 'orderDate': valA = a.orderDateObj?.getTime() ?? 0; valB = b.orderDateObj?.getTime() ?? 0; break;
          case 'saleDate': valA = a.saleDateObj?.getTime() ?? 0; valB = b.saleDateObj?.getTime() ?? 0; break;
          case 'salePrice': valA = a.salePrice ?? -Infinity; valB = b.salePrice ?? -Infinity; break;
          case 'etv': valA = a.etv; valB = b.etv; break;
          case 'calculatedTeilwert': valA = getCalculatedTeilwert(a); valB = getCalculatedTeilwert(b); break;
          case 'ASIN': case 'name': valA = a[sortKey]; valB = b[sortKey]; break;
          default: return 0;
        }
        if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
  }, [allSoldProducts, selectedPlotYear, sortKey, sortOrder]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortOrder('asc'); }
  };

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) return <FaSort className="inline ml-1 text-gray-500" />;
    return sortOrder === 'asc' ? <FaSortUp className="inline ml-1" /> : <FaSortDown className="inline ml-1" />;
  };
  
  const formatDate = (date: Date | null): string => {
    if (!date || isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };
  
  const formatCurrency = (value?: number | null) => {
    if (value == null) return 'N/A';
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
  };

  const handleEditProduct = (product: Product) => setEditingProduct(product);

  const handleSaveEditedProduct = async (updatedProduct: Product) => {
    await onUpdateProduct(updatedProduct);
    setEditingProduct(null);
  };

  return (
    <div className="space-y-8">
      <div className="p-6 bg-slate-800 rounded-lg shadow-xl border border-slate-700">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-6 gap-4">
            <h2 className="text-2xl font-semibold text-gray-100 flex items-center">
              <FaDollarSign className="mr-3 text-sky-400"/> Verkaufsübersicht & Analyse
            </h2>
            <div>
                <label htmlFor="plotYearFilter" className="block text-sm font-medium text-gray-300 sr-only">Jahr für Analyse</label>
                <select
                    id="plotYearFilter"
                    value={selectedPlotYear}
                    onChange={(e) => setSelectedPlotYear(e.target.value)}
                    className="mt-1 block w-full sm:w-auto pl-3 pr-10 py-2 text-base bg-slate-700 border-slate-600 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm rounded-md text-gray-100"
                >
                    {availablePlotYears.map(year => <option key={year} value={year}>{year === 'all' ? 'Alle Jahre' : year}</option>)}
                </select>
            </div>
        </div>
        <SalesPlots soldProducts={allSoldProducts} selectedYear={selectedPlotYear} />
      </div>
    
      <div className="p-6 bg-slate-800 rounded-lg shadow-xl border border-slate-700">
        <h3 className="text-xl font-semibold text-gray-100 mb-4">
          Verkaufte Produkte ({selectedPlotYear === 'all' ? 'Alle Jahre' : selectedPlotYear}): {filteredSoldProductsForTableAndPlots.length}
        </h3>
        {filteredSoldProductsForTableAndPlots.length === 0 ? (
          <div className="text-center py-10">
              <FaTimesCircle size={48} className="mx-auto text-gray-500" />
              <p className="mt-4 text-lg text-gray-400">Keine Produkte als "verkauft" im Zeitraum "{selectedPlotYear === 'all' ? 'Alle Jahre' : selectedPlotYear}" markiert.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-700">
              <thead className="bg-slate-750">
                <tr>
                  {[
                    { label: 'ASIN', key: 'ASIN' }, { label: 'Name', key: 'name' },
                    { label: 'Bestelldatum', key: 'orderDate' }, { label: 'ETV', key: 'etv' },
                    { label: 'Teilwert', key: 'calculatedTeilwert' }, { label: 'Verkaufsdatum', key: 'saleDate' },
                    { label: 'Verkaufspreis', key: 'salePrice' }, { label: 'Käufer', key: 'buyerAddress' },
                    { label: 'Aktion', key: null }
                  ].map(header => (
                    <th 
                          key={header.label}
                          onClick={() => header.key && handleSort(header.key as SortKey)}
                          className={`px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider ${header.key ? 'cursor-pointer hover:bg-slate-700' : ''}`}
                          scope="col"
                      >
                          {header.label} {header.key && renderSortIcon(header.key as SortKey)}
                      </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-slate-800 divide-y divide-slate-700">
                {filteredSoldProductsForTableAndPlots.map(p => (
                  <tr key={p.ASIN} className="hover:bg-slate-750 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-sky-400">{p.ASIN}</td>
                    <td className="px-4 py-3 text-sm text-gray-200 max-w-xs truncate" title={p.name}>{p.name}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300">{formatDate(p.orderDateObj)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300 text-right">{formatCurrency(p.etv)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300 text-right">{formatCurrency(getCalculatedTeilwert(p))}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300">{p.saleDate ? formatDate(p.saleDateObj) : 'N/A'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300 text-right">{formatCurrency(p.salePrice)}</td>
                    <td className="px-4 py-3 text-sm text-gray-300 max-w-xs truncate" title={p.buyerAddress}>{p.buyerAddress || 'N/A'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      <Button size="sm" variant="ghost" onClick={() => handleEditProduct(p)} title="Verkaufsdetails bearbeiten">
                         <FaEdit />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
       {editingProduct && (
        <EditProductModal
          product={editingProduct}
          isOpen={!!editingProduct}
          onClose={() => setEditingProduct(null)}
          onSave={handleSaveEditedProduct}
          euerSettings={euerSettings}
          belegSettings={belegSettings}
        />
      )}
    </div>
  );
};

export default SalesPage;