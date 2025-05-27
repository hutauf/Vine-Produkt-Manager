import React, { useMemo, useState } from 'react';
import { Product, ProductUsage } from '../../types';
import EditProductModal from '../Products/EditProductModal'; // Re-use for sale price/date
import { FaDollarSign, FaEdit, FaSort, FaSortUp, FaSortDown } from 'react-icons/fa';
import Button from '../Common/Button';

interface SalesPageProps {
  products: Product[];
  onUpdateProduct: (product: Product) => void;
}

type SortKey = 'ASIN' | 'name' | 'saleDate' | 'etv' | 'teilwert' | 'salePrice';

// Helper function to validate and parse German date format (TT.MM.JJJJ)
const parseGermanDate = (dateString?: string): Date | null => {
  if (!dateString) return null;
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(dateString)) {
    return null; 
  }
  const parts = dateString.split('.');
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) -1; // Month is 0-indexed
  const year = parseInt(parts[2], 10);

  if (year < 1900 || year > 2100 || month < 0 || month > 11) {
    return null;
  }
  const date = new Date(year, month, day);
  // Check if date object is valid and matches input (e.g. 30.02.2023 is invalid)
  if (date.getFullYear() === year && date.getMonth() === month && date.getDate() === day) {
    return date;
  }
  return null;
};

const SalesPage: React.FC<SalesPageProps> = ({ products, onUpdateProduct }) => {
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('saleDate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  
  const soldProducts = useMemo(() => {
    return products
      .filter(p => p.usageStatus.includes(ProductUsage.VERKAUFT))
      .sort((a, b) => {
        let valA: any;
        let valB: any;

        if (sortKey === 'saleDate') {
            valA = a.saleDate ? parseGermanDate(a.saleDate)?.getTime() ?? 0 : 0;
            valB = b.saleDate ? parseGermanDate(b.saleDate)?.getTime() ?? 0 : 0;
        } else if (sortKey === 'etv' || sortKey === 'teilwert' || sortKey === 'salePrice') {
            valA = sortKey === 'teilwert' ? (a.myTeilwert ?? a.teilwert) : (a[sortKey as keyof Pick<Product, 'etv' | 'salePrice'>] ?? 0);
            valB = sortKey === 'teilwert' ? (b.myTeilwert ?? b.teilwert) : (b[sortKey as keyof Pick<Product, 'etv' | 'salePrice'>] ?? 0);
        } else { // ASIN or name
            valA = a[sortKey as keyof Product];
            valB = b[sortKey as keyof Product];
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

  const formatDateDisplay = (dateString?: string): string => {
    if (!dateString) return 'N/A';
    const date = parseGermanDate(dateString);
    // Use original string if parsing failed but it exists, or "Ungültig" if really bad
    return date ? date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : (dateString || 'N/A');
  };
  
  const formatCurrency = (value?: number | null) => {
    if (value == null) return 'N/A';
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
  };

  return (
    <>
      <div className="p-6 bg-slate-800 rounded-lg shadow-xl border border-slate-700">
        <h2 className="text-2xl font-semibold text-gray-100 mb-6 flex items-center">
            <FaDollarSign className="mr-3 text-sky-400"/> Verkäufe ({soldProducts.length})
        </h2>
        {soldProducts.length === 0 ? (
          <p className="text-gray-400 text-center py-8">Keine Produkte als "verkauft" markiert oder keine Verkaufsdetails erfasst.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-700">
              <thead className="bg-slate-750">
                <tr>
                  {['ASIN', 'Name', 'ETV', 'Teilwert', 'Verkaufspreis', 'Verkaufsdatum', 'Aktion'].map(header => {
                    const keyMap: Record<string, SortKey> = {
                        'ASIN': 'ASIN', 'Name': 'name', 'ETV': 'etv', 'Teilwert': 'teilwert', 
                        'Verkaufspreis': 'salePrice', 'Verkaufsdatum': 'saleDate'
                    };
                    const currentKey = keyMap[header];
                    return (
                        <th
                            key={header}
                            onClick={() => currentKey && handleSort(currentKey)}
                            className={`px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider ${currentKey ? 'cursor-pointer hover:bg-slate-700' : ''}`}
                            scope="col"
                        >
                            {header} {currentKey && renderSortIcon(currentKey)}
                        </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="bg-slate-800 divide-y divide-slate-700">
                {soldProducts.map(p => (
                  <tr key={p.ASIN} className="hover:bg-slate-750 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-sky-400">{p.ASIN}</td>
                    <td className="px-4 py-3 text-sm text-gray-200 max-w-xs truncate" title={p.name}>{p.name}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300 text-right">{formatCurrency(p.etv)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300 text-right">{formatCurrency(p.myTeilwert ?? p.teilwert)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300 text-right">{formatCurrency(p.salePrice)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300">{formatDateDisplay(p.saleDate)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      <Button size="sm" variant="ghost" onClick={() => setEditingProduct(p)} title="Verkaufsdetails bearbeiten">
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
          onSave={(updatedProd) => {
            onUpdateProduct(updatedProd);
            setEditingProduct(null);
          }}
        />
      )}
    </>
  );
};

export default SalesPage;