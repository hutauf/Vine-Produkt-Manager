
import React, { useMemo, useState } from 'react';
import { Product, ProductUsage } from '../../types';
import { FaArchive, FaSort, FaSortUp, FaSortDown } from 'react-icons/fa';
import { parseDMYtoDate } from '../../utils/dateUtils'; // Import the new utility

interface InventoryPageProps {
  products: Product[];
}

type SortKey = 'ASIN' | 'name' | 'date' | 'etv' | 'teilwert' | 'dueDate';

const InventoryPage: React.FC<InventoryPageProps> = ({ products }) => {
  const [sortKey, setSortKey] = useState<SortKey>('dueDate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Removed local parseDate

  const addMonths = (date: Date, months: number): Date => {
    const newDate = new Date(date);
    newDate.setMonth(newDate.getMonth() + months);
    return newDate;
  };

  const inventoryProducts = useMemo(() => {
    return products
      .filter(p => p.usageStatus.includes(ProductUsage.LAGER))
      .map(p => {
        const orderDate = parseDMYtoDate(p.date);
        if (!orderDate) {
          // Handle cases where date might be invalid, though normalization should prevent this
          console.warn(`Invalid order date for inventory product ${p.ASIN}: ${p.date}`);
          // Return a product structure that won't break, or filter it out
          return { ...p, orderDate: new Date(0), dueDate: new Date(0), isValid: false };
        }
        return {
          ...p,
          orderDate: orderDate,
          dueDate: addMonths(orderDate, 6),
          isValid: true,
        };
      })
      .filter(p => p.isValid) // Keep only products with valid dates
      .sort((a, b) => {
        let valA: any;
        let valB: any;

        if (sortKey === 'date') { // Sorts by original order date
            valA = a.orderDate.getTime();
            valB = b.orderDate.getTime();
        } else if (sortKey === 'dueDate') {
            valA = a.dueDate.getTime();
            valB = b.dueDate.getTime();
        } else if (sortKey === 'etv' || sortKey === 'teilwert') {
            valA = sortKey === 'teilwert' ? (a.myTeilwert ?? a.teilwert) : a.etv;
            valB = sortKey === 'teilwert' ? (b.myTeilwert ?? b.teilwert) : b.etv;
        } else { // ASIN or name
            valA = a[sortKey as Exclude<SortKey, 'date' | 'dueDate' | 'etv' | 'teilwert'>];
            valB = b[sortKey as Exclude<SortKey, 'date' | 'dueDate' | 'etv' | 'teilwert'>];
        }

        if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
  }, [products, sortKey, sortOrder]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
  };

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) return <FaSort className="inline ml-1 text-gray-500" />;
    return sortOrder === 'asc' ? <FaSortUp className="inline ml-1" /> : <FaSortDown className="inline ml-1" />;
  };
  
  const formatDate = (date: Date | null): string => {
    if (!date || isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('de-DE');
  };
  
  const formatCurrency = (value?: number | null) => {
    if (value == null) return 'N/A';
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
  };

  return (
    <div className="p-6 bg-slate-800 rounded-lg shadow-xl border border-slate-700">
      <h2 className="text-2xl font-semibold text-gray-100 mb-6 flex items-center">
        <FaArchive className="mr-3 text-sky-400"/> Lagerbestand ({inventoryProducts.length})
      </h2>
      {inventoryProducts.length === 0 ? (
        <p className="text-gray-400 text-center py-8">Keine Produkte als "Lager" markiert oder gültige Bestelldaten vorhanden.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-700">
            <thead className="bg-slate-750">
              <tr>
                {['ASIN', 'Name', 'Bestelldatum', 'Fällig (6 Monate)', 'ETV', 'Teilwert'].map(header => {
                   const keyMap: Record<string, SortKey> = {
                    'ASIN': 'ASIN', 'Name': 'name', 'Bestelldatum': 'date', 'Fällig (6 Monate)': 'dueDate', 'ETV': 'etv', 'Teilwert': 'teilwert'
                   };
                   const currentKey = keyMap[header];
                   return (
                    <th 
                        key={header}
                        onClick={() => handleSort(currentKey)}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-slate-700">
                        {header} {renderSortIcon(currentKey)}
                    </th>
                   );
                })}
              </tr>
            </thead>
            <tbody className="bg-slate-800 divide-y divide-slate-700">
              {inventoryProducts.map(p => (
                <tr key={p.ASIN} className="hover:bg-slate-750 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-sky-400">{p.ASIN}</td>
                  <td className="px-4 py-3 text-sm text-gray-200 max-w-xs truncate" title={p.name}>{p.name}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300">{formatDate(p.orderDate)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300">{formatDate(p.dueDate)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300 text-right">{formatCurrency(p.etv)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300 text-right">{formatCurrency(p.myTeilwert ?? p.teilwert)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default InventoryPage;
