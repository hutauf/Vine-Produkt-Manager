
import React, { useState, useMemo } from 'react';
import { Product, ProductUsage } from '../../types';
import EditProductModal from './EditProductModal';
// Fix: Replaced FaAnglesLeft with FaAngleDoubleLeft and FaAnglesRight with FaAngleDoubleRight
import { FaSort, FaSortUp, FaSortDown, FaEdit, FaAngleLeft, FaAngleRight, FaAngleDoubleLeft, FaAngleDoubleRight } from 'react-icons/fa';
import Button from '../Common/Button';
import { parseDMYtoDate } from '../../utils/dateUtils'; // Import the new utility

interface ProductTableProps {
  products: Product[];
  onUpdateProduct: (product: Product) => void;
}

type SortKey = keyof Product | 'calculatedTeilwert';
type SortOrder = 'asc' | 'desc';

const ITEMS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

const ProductTable: React.FC<ProductTableProps> = ({ products, onUpdateProduct }) => {
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(ITEMS_PER_PAGE_OPTIONS[1]); // Default to 25

  // Removed local parseDate, using parseDMYtoDate from dateUtils

  const getCalculatedTeilwert = (product: Product): number => {
    if (product.myTeilwert != null) return product.myTeilwert;
    if (product.teilwert != null) return product.teilwert;
    return 0;
  };

  const sortedProducts = useMemo(() => {
    return [...products].sort((a, b) => {
      let valA: any;
      let valB: any;

      if (sortKey === 'date') {
        valA = parseDMYtoDate(a.date)?.getTime() ?? 0;
        valB = parseDMYtoDate(b.date)?.getTime() ?? 0;
      } else if (sortKey === 'calculatedTeilwert') {
        valA = getCalculatedTeilwert(a);
        valB = getCalculatedTeilwert(b);
      } else if (sortKey === 'etv' || sortKey === 'keepa') {
        valA = a[sortKey] ?? -Infinity; 
        valB = b[sortKey] ?? -Infinity;
      } else {
        valA = a[sortKey as keyof Product];
        valB = b[sortKey as keyof Product];
      }
      
      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [products, sortKey, sortOrder]);

  const paginatedProducts = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedProducts.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedProducts, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(sortedProducts.length / itemsPerPage);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
    setCurrentPage(1); // Reset to first page on sort
  };

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) return <FaSort className="inline ml-1 text-gray-500" />;
    return sortOrder === 'asc' ? <FaSortUp className="inline ml-1" /> : <FaSortDown className="inline ml-1" />;
  };

  const formatDateDisplay = (dateString: string): string => {
    if (!dateString) return 'N/A';
    const dateObj = parseDMYtoDate(dateString);
    if (dateObj) {
      return dateObj.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    return dateString; // Fallback to original string if parsing failed (should not happen with normalization)
  };
  
  const handleItemsPerPageChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setItemsPerPage(Number(event.target.value));
    setCurrentPage(1); // Reset to first page
  };

  const renderPaginationControls = () => {
    if (totalPages <= 1) return null;

    const pageNumbers = [];
    const maxPagesToShow = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
    let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);

    if (endPage - startPage + 1 < maxPagesToShow) {
        startPage = Math.max(1, endPage - maxPagesToShow + 1);
    }
    
    for (let i = startPage; i <= endPage; i++) {
        pageNumbers.push(i);
    }

    return (
      <div className="mt-6 flex flex-col sm:flex-row items-center justify-between text-sm">
        <div className="mb-2 sm:mb-0">
          <label htmlFor="itemsPerPage" className="mr-2 text-gray-300">Zeilen pro Seite:</label>
          <select
            id="itemsPerPage"
            value={itemsPerPage}
            onChange={handleItemsPerPageChange}
            className="px-2 py-1 bg-slate-700 border border-slate-600 rounded-md text-gray-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            {ITEMS_PER_PAGE_OPTIONS.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
           <span className="ml-4 text-gray-400">
            Seite {currentPage} von {totalPages} ({products.length} Einträge)
          </span>
        </div>
        <div className="flex items-center space-x-1">
            <Button variant="ghost" size="sm" onClick={() => setCurrentPage(1)} disabled={currentPage === 1} aria-label="Erste Seite">
                <FaAngleDoubleLeft />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1} aria-label="Vorherige Seite">
                <FaAngleLeft />
            </Button>
            {startPage > 1 && <span className="px-2 py-1 text-gray-400">...</span>}
            {pageNumbers.map(number => (
            <Button
                key={number}
                variant={currentPage === number ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setCurrentPage(number)}
                className="w-8 h-8 p-0"
                aria-label={`Seite ${number}`}
                aria-current={currentPage === number ? 'page' : undefined}
            >
                {number}
            </Button>
            ))}
            {endPage < totalPages && <span className="px-2 py-1 text-gray-400">...</span>}
             <Button variant="ghost" size="sm" onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages} aria-label="Nächste Seite">
                <FaAngleRight />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} aria-label="Letzte Seite">
                <FaAngleDoubleRight />
            </Button>
        </div>
      </div>
    );
  };


  return (
    <>
      <div className="overflow-x-auto bg-slate-800 shadow-xl rounded-lg">
        <table className="min-w-full divide-y divide-slate-700">
          <thead className="bg-slate-750">
            <tr>
              {['ASIN', 'Datum', 'Name', 'ETV', 'Keepa', 'Teilwert', 'Status', 'PDF', 'Produkt', 'Review', 'Aktion'].map((header) => {
                const keyMap: Record<string, SortKey> = {
                  'ASIN': 'ASIN', 'Datum': 'date', 'Name': 'name', 'ETV': 'etv', 'Keepa': 'keepa', 'Teilwert': 'calculatedTeilwert'
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
            {paginatedProducts.map((item) => (
              <tr key={item.ASIN} className="hover:bg-slate-750 transition-colors">
                <td className="px-4 py-3 whitespace-nowrap text-sm text-sky-400">{item.ASIN}</td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300" data-order={parseDMYtoDate(item.date)?.getTime() ?? 0}>
                  {formatDateDisplay(item.date)}
                </td>
                <td className="px-4 py-3 text-sm text-gray-200 max-w-xs truncate" title={item.name}>{item.name || 'N/A'}</td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300 text-right">{item.etv.toFixed(2)} €</td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300 text-right">
                  {item.keepa != null ? (
                    <a href={`https://keepa.com/#!product/3-${item.ASIN}`} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300">
                      {item.keepa.toFixed(2)} €
                    </a>
                  ) : (
                    'N/A'
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300 text-right" data-order={getCalculatedTeilwert(item)}>
                    {item.myTeilwert != null ? (
                      <>
                        {item.myTeilwert.toFixed(2)} €<sup>m</sup>
                      </>
                    ) : (item.teilwert != null ? `${item.teilwert.toFixed(2)} €` : 'N/A')}
                </td>
                <td className="px-4 py-3 text-sm text-gray-300">
                  {item.usageStatus.length > 0 ? item.usageStatus.join(', ') : '-'}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm">
                  {item.pdf ? (
                    <a href={item.pdf} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300">
                      PDF Link
                    </a>
                  ) : (
                    'N/A'
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm">
                  <a href={`https://www.amazon.de/dp/${item.ASIN}`} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300">
                    Produkt
                  </a>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm">
                  <a href={`https://www.amazon.de/review/create-review?encoding=UTF&asin=${item.ASIN}`} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300">
                    Review
                  </a>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm">
                  <Button size="sm" variant="ghost" onClick={() => setEditingProduct(item)} title="Produkt bearbeiten">
                     <FaEdit />
                  </Button>
                </td>
              </tr>
            ))}
             {paginatedProducts.length === 0 && (
                <tr>
                    <td colSpan={11} className="text-center py-10 text-gray-400">
                        Keine Produkte gefunden.
                    </td>
                </tr>
            )}
          </tbody>
        </table>
      </div>
      {renderPaginationControls()}
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

export default ProductTable;
