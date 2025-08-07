
import React, { useMemo, useState } from 'react';
import { Product, ProductUsage, AdditionalExpense, VermoegenPageProps } from '../../types';
import { FaArchive, FaSort, FaSortUp, FaSortDown, FaBuilding, FaPlusCircle, FaTrashAlt, FaDollarSign, FaEdit } from 'react-icons/fa';
import { parseDMYtoDate, parseGermanDate, normalizeGermanDateInput, convertGermanToISO, convertISOToGerman, getTodayGermanFormat } from '../../utils/dateUtils';
import Button from '../Common/Button';
import CreateShopModal from '../Shop/CreateShopModal';
import PublishedUrlModal from '../Shop/PublishedUrlModal';
import { generateShopHtml } from '../../utils/shopGenerator';
import EditProductModal from '../Products/EditProductModal';

type ProductSortKey = 'ASIN' | 'name' | 'date' | 'etv' | 'calculatedTeilwert';
type ExpenseSortKey = 'date' | 'name' | 'amount';

const VermoegenPage: React.FC<VermoegenPageProps> = ({ products, additionalExpenses, onAddExpense, onDeleteExpense, onUpdateProduct, euerSettings, belegSettings }) => {
  const [productSortKey, setProductSortKey] = useState<ProductSortKey>('date');
  const [productSortOrder, setProductSortOrder] = useState<'asc' | 'desc'>('desc');
  
  const [expenseSortKey, setExpenseSortKey] = useState<ExpenseSortKey>('date');
  const [expenseSortOrder, setExpenseSortOrder] = useState<'asc' | 'desc'>('desc');

  const [newExpense, setNewExpense] = useState({ date: getTodayGermanFormat(), name: '', amount: '' });
  const [expenseDateError, setExpenseDateError] = useState<string | null>(null);
  const [selectedAsins, setSelectedAsins] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const getCalculatedTeilwert = (product: Product): number => product.myTeilwert ?? product.teilwert ?? 0; // <--- MODIFIED HERE

  const umlaufvermoegen = useMemo(() => {
    return products
      .filter(p => p.usageStatus.includes(ProductUsage.LAGER))
      .map(p => ({ ...p, orderDateObj: parseDMYtoDate(p.date) }))
      .sort((a, b) => {
        let valA: any;
        let valB: any;
        if (productSortKey === 'date') { valA = a.orderDateObj?.getTime() ?? 0; valB = b.orderDateObj?.getTime() ?? 0; }
        else if (productSortKey === 'etv') { valA = a.etv; valB = b.etv; }
        else if (productSortKey === 'calculatedTeilwert') { valA = getCalculatedTeilwert(a); valB = getCalculatedTeilwert(b); }
        else { valA = a[productSortKey as 'ASIN' | 'name']; valB = b[productSortKey as 'ASIN' | 'name'];}
        
        if (valA < valB) return productSortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return productSortOrder === 'asc' ? 1 : -1;
        return 0;
      });
  }, [products, productSortKey, productSortOrder]);

  const anlagenverzeichnis = useMemo(() => {
    return products
      .filter(p => p.usageStatus.includes(ProductUsage.BETRIEBLICHE_NUTZUNG))
      .map(p => ({ ...p, orderDateObj: parseDMYtoDate(p.date) }))
      .sort((a, b) => { // Same sorting logic as umlaufvermoegen for now
        let valA: any;
        let valB: any;
        if (productSortKey === 'date') { valA = a.orderDateObj?.getTime() ?? 0; valB = b.orderDateObj?.getTime() ?? 0; }
        else if (productSortKey === 'etv') { valA = a.etv; valB = b.etv; }
        else if (productSortKey === 'calculatedTeilwert') { valA = getCalculatedTeilwert(a); valB = getCalculatedTeilwert(b); }
        else { valA = a[productSortKey as 'ASIN' | 'name']; valB = b[productSortKey as 'ASIN' | 'name'];}
        
        if (valA < valB) return productSortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return productSortOrder === 'asc' ? 1 : -1;
        return 0;
      });
  }, [products, productSortKey, productSortOrder]);

  const sumETVUmlauf = useMemo(() => umlaufvermoegen.reduce((sum, p) => sum + p.etv, 0), [umlaufvermoegen]);
  const sumTeilwertUmlauf = useMemo(() => umlaufvermoegen.reduce((sum, p) => sum + getCalculatedTeilwert(p), 0), [umlaufvermoegen]);

  const sumETVAnlage = useMemo(() => anlagenverzeichnis.reduce((sum, p) => sum + p.etv, 0), [anlagenverzeichnis]);
  const sumTeilwertAnlage = useMemo(() => anlagenverzeichnis.reduce((sum, p) => sum + getCalculatedTeilwert(p), 0), [anlagenverzeichnis]);


  const sortedAdditionalExpenses = useMemo(() => {
    return [...additionalExpenses].sort((a, b) => {
      let valA: any;
      let valB: any;
      if (expenseSortKey === 'date') {
        valA = parseGermanDate(a.date)?.getTime() ?? 0;
        valB = parseGermanDate(b.date)?.getTime() ?? 0;
      } else if (expenseSortKey === 'amount') {
        valA = a.amount;
        valB = b.amount;
      } else { // name
        valA = a.name.toLowerCase();
        valB = b.name.toLowerCase();
      }
      if (valA < valB) return expenseSortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return expenseSortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [additionalExpenses, expenseSortKey, expenseSortOrder]);

  const handleProductSort = (key: ProductSortKey) => {
    if (productSortKey === key) setProductSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    else { setProductSortKey(key); setProductSortOrder('asc'); }
  };

  const handleExpenseSort = (key: ExpenseSortKey) => {
    if (expenseSortKey === key) setExpenseSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    else { setExpenseSortKey(key); setExpenseSortOrder('asc'); }
  };

  const renderProductSortIcon = (key: ProductSortKey) => {
    if (productSortKey !== key) return <FaSort className="inline ml-1 text-gray-500" />;
    return productSortOrder === 'asc' ? <FaSortUp className="inline ml-1" /> : <FaSortDown className="inline ml-1" />;
  };
  
  const renderExpenseSortIcon = (key: ExpenseSortKey) => {
    if (expenseSortKey !== key) return <FaSort className="inline ml-1 text-gray-500" />;
    return expenseSortOrder === 'asc' ? <FaSortUp className="inline ml-1" /> : <FaSortDown className="inline ml-1" />;
  };

  const formatDate = (dateObj: Date | null | undefined): string => {
    if (!dateObj || isNaN(dateObj.getTime())) return 'N/A';
    return dateObj.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric'});
  };
  
  const formatCurrency = (value?: number | null) => {
    if (value == null) return 'N/A';
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
  };

  const handleNewExpenseChange = (field: keyof typeof newExpense, value: string) => {
    if (field === 'date') {
        const normalizedDate = normalizeGermanDateInput(value);
        setNewExpense(prev => ({ ...prev, date: normalizedDate }));
        if (value && !parseGermanDate(normalizedDate)) {
            setExpenseDateError("Ungültiges Datum. Bitte TT.MM.JJJJ verwenden.");
        } else {
            setExpenseDateError(null);
        }
    } else {
        setNewExpense(prev => ({ ...prev, [field]: value }));
    }
  };
  
  const handleNativeDateInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const isoDate = e.target.value; // YYYY-MM-DD
    const germanDate = convertISOToGerman(isoDate);
    setNewExpense(prev => ({ ...prev, date: germanDate || '' }));
     if (isoDate && !germanDate) { // If conversion fails for a non-empty ISO date
        setExpenseDateError("Ungültiges Datum.");
    } else {
        setExpenseDateError(null);
    }
  };


  const handleAddExpenseSubmit = () => {
    const finalDate = newExpense.date;
    if (!finalDate || !parseGermanDate(finalDate)) {
      setExpenseDateError("Datum ist ungültig oder fehlt. Bitte TT.MM.JJJJ verwenden.");
      return;
    }
    if (!newExpense.name.trim()) {
      alert("Name der Ausgabe darf nicht leer sein.");
      return;
    }
    const amount = parseFloat(newExpense.amount);
    if (isNaN(amount) || amount <= 0) {
      alert("Betrag muss eine positive Zahl sein.");
      return;
    }
    onAddExpense({ date: finalDate, name: newExpense.name.trim(), amount });
    setNewExpense({ date: getTodayGermanFormat(), name: '', amount: '' });
    setExpenseDateError(null);
  };
  
  const productTableHeaders: {label: string, key: ProductSortKey}[] = [
    { label: 'ASIN', key: 'ASIN' },
    { label: 'Name', key: 'name' },
    { label: 'Bestelldatum', key: 'date' },
    { label: 'ETV', key: 'etv' },
    { label: 'Teilwert', key: 'calculatedTeilwert' },
  ];

  const renderProductTable = (
    data: (Product & { orderDateObj?: Date | null })[], 
    title: string, 
    icon: React.ReactNode, 
    showSummary: boolean = false, 
    summaryETV?: number, 
    summaryTeilwert?: number,
    summaryType?: 'Umlaufvermögen' | 'Anlagenverzeichnis'
  ) => (
    <div className="p-6 bg-slate-800 rounded-lg shadow-xl border border-slate-700">
      <h2 className="text-2xl font-semibold text-gray-100 mb-6 flex items-center">
        {icon} {title} ({data.length})
      </h2>
      {data.length === 0 ? (
        <p className="text-gray-400 text-center py-8">Keine Produkte in dieser Kategorie.</p>
      ) : (
        <>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-700">
            <thead className="bg-slate-750">
              <tr>
                <th className="px-4 py-3">
                  <input type="checkbox" checked={data.every(p => selectedAsins.has(p.ASIN))} onChange={e => {
                    const set = new Set(selectedAsins);
                    if (e.target.checked) data.forEach(p => set.add(p.ASIN));
                    else data.forEach(p => set.delete(p.ASIN));
                    setSelectedAsins(set);
                  }} />
                </th>
                {productTableHeaders.map(header => (
                   <th
                        key={header.key}
                        onClick={() => handleProductSort(header.key)}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-slate-700">
                        {header.label} {renderProductSortIcon(header.key)}
                    </th>
                ))}
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Aktion</th>
              </tr>
            </thead>
            <tbody className="bg-slate-800 divide-y divide-slate-700">
              {data.map(p => (
                <tr key={p.ASIN} className="hover:bg-slate-750 transition-colors">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selectedAsins.has(p.ASIN)} onChange={() => {
                      const set = new Set(selectedAsins);
                      if (set.has(p.ASIN)) set.delete(p.ASIN); else set.add(p.ASIN);
                      setSelectedAsins(set);
                    }} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-sky-400">{p.ASIN}</td>
                  <td className="px-4 py-3 text-sm text-gray-200 max-w-xs truncate" title={p.name}>{p.name}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300">{formatDate(p.orderDateObj)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300 text-right">{formatCurrency(p.etv)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300 text-right">{formatCurrency(getCalculatedTeilwert(p))}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm">
                    <Button size="sm" variant="ghost" onClick={() => setEditingProduct(p)} title="Produkt bearbeiten">
                      <FaEdit />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {showSummary && summaryETV !== undefined && summaryTeilwert !== undefined && summaryType && (
            <div className="mt-4 pt-3 border-t border-slate-700 text-right">
                <p className="text-sm text-gray-300 font-semibold">
                    Summe {summaryType} ETV: <span className="text-sky-400">{formatCurrency(summaryETV)}</span>
                </p>
                <p className="text-sm text-gray-300 font-semibold">
                    Summe {summaryType} Teilwert: <span className="text-green-400">{formatCurrency(summaryTeilwert)}</span>
                </p>
            </div>
        )}
        </>
      )}
    </div>
  );
  
  const expenseTableHeaders: {label: string, key: ExpenseSortKey}[] = [
      { label: 'Datum', key: 'date'},
      { label: 'Name/Beschreibung', key: 'name'},
      { label: 'Betrag', key: 'amount'},
  ];

  return (
    <div className="space-y-8">
      {renderProductTable(umlaufvermoegen, "Umlaufvermögen", <FaArchive className="mr-3 text-sky-400"/>, true, sumETVUmlauf, sumTeilwertUmlauf, "Umlaufvermögen")}
      {renderProductTable(anlagenverzeichnis, "Anlagenverzeichnis", <FaBuilding className="mr-3 text-sky-400"/>, true, sumETVAnlage, sumTeilwertAnlage, "Anlagenverzeichnis")}
      
      <div className="p-6 bg-slate-800 rounded-lg shadow-xl border border-slate-700">
        <h2 className="text-2xl font-semibold text-gray-100 mb-6 flex items-center">
            <FaDollarSign className="mr-3 text-sky-400"/> Weitere Ausgaben (Lokal) ({additionalExpenses.length})
        </h2>
        {additionalExpenses.length === 0 && !newExpense.name && !newExpense.amount ? (
            <p className="text-gray-400 text-center py-8">Keine zusätzlichen Ausgaben erfasst.</p>
        ) : (
        <div className="overflow-x-auto mb-6">
          <table className="min-w-full divide-y divide-slate-700">
            <thead className="bg-slate-750">
              <tr>
                {expenseTableHeaders.map(header => (
                   <th 
                        key={header.key}
                        onClick={() => handleExpenseSort(header.key)}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-slate-700">
                        {header.label} {renderExpenseSortIcon(header.key)}
                    </th>
                ))}
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Aktion</th>
              </tr>
            </thead>
            <tbody className="bg-slate-800 divide-y divide-slate-700">
              {sortedAdditionalExpenses.map(exp => (
                <tr key={exp.id} className="hover:bg-slate-750 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300">{exp.date}</td>
                  <td className="px-4 py-3 text-sm text-gray-200">{exp.name}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300 text-right">{formatCurrency(exp.amount)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm">
                    <Button variant="danger" size="sm" onClick={() => onDeleteExpense(exp.id)} aria-label={`Ausgabe ${exp.name} löschen`}>
                        <FaTrashAlt />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
        <div className="mt-6 pt-4 border-t border-slate-700">
            <h3 className="text-lg font-semibold text-gray-100 mb-3">Neue Ausgabe hinzufügen</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                 <div>
                    <label htmlFor="expenseDate" className="block text-sm font-medium text-gray-300">Datum (TT.MM.JJJJ)</label>
                    <input 
                        type="date" 
                        id="expenseDateNative"
                        value={convertGermanToISO(newExpense.date)}
                        onChange={handleNativeDateInputChange}
                        className={`mt-1 block w-full px-3 py-2 bg-slate-700 border rounded-md shadow-sm text-gray-100 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm ${expenseDateError ? 'border-red-500' : 'border-slate-600'}`}
                        style={{ colorScheme: 'dark' }}
                     />
                    {expenseDateError && <p className="mt-1 text-xs text-red-400">{expenseDateError}</p>}
                </div>
                <div className="md:col-span-2">
                    <label htmlFor="expenseName" className="block text-sm font-medium text-gray-300">Name/Beschreibung</label>
                    <input type="text" id="expenseName" value={newExpense.name} onChange={e => handleNewExpenseChange('name', e.target.value)} className="mt-1 block w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm text-gray-100 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm" placeholder="z.B. Büromaterial"/>
                </div>
                <div>
                    <label htmlFor="expenseAmount" className="block text-sm font-medium text-gray-300">Betrag (€)</label>
                    <input type="number" id="expenseAmount" value={newExpense.amount} onChange={e => handleNewExpenseChange('amount', e.target.value)}  className="mt-1 block w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm text-gray-100 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm" placeholder="z.B. 25.99" step="0.01"/>
                </div>
            </div>
            <Button onClick={handleAddExpenseSubmit} leftIcon={<FaPlusCircle />} className="mt-4" disabled={!!expenseDateError || !newExpense.name.trim() || !newExpense.amount}>
                Ausgabe hinzufügen
            </Button>
        </div>
      </div>
      <div className="text-right mt-6">
        <Button onClick={() => setShowCreateModal(true)} disabled={selectedAsins.size === 0}>Shop erstellen</Button>
      </div>
    <CreateShopModal
      isOpen={showCreateModal}
      onClose={() => setShowCreateModal(false)}
      onSubmit={async opts => {
        const selected = products.filter(p => selectedAsins.has(p.ASIN));
        const html = await generateShopHtml(selected, {
          email: opts.email,
          percent: opts.percent,
          reference: opts.reference,
          showDiscount: opts.showDiscount
        });
        if (opts.publish) {
          try {
            const resp = await fetch('https://hutauf.org/upload_shop', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(opts.name ? { html, name: opts.name } : { html })
            });
            const data = await resp.json();
            setPublishedUrl(data.url);
          } catch (e) {
            alert('Fehler beim Hochladen');
          }
        } else {
          document.open();
          document.write(html);
          document.close();
        }
      }}
    />
    <PublishedUrlModal url={publishedUrl || ''} isOpen={!!publishedUrl} onClose={() => setPublishedUrl(null)} />
    {editingProduct && (
      <EditProductModal
        product={editingProduct}
        isOpen={!!editingProduct}
        onClose={() => setEditingProduct(null)}
        onSave={async updated => {
          await onUpdateProduct(updated);
          setEditingProduct(null);
        }}
        euerSettings={euerSettings}
        belegSettings={belegSettings}
      />
    )}
    </div>
  );
};

export default VermoegenPage;