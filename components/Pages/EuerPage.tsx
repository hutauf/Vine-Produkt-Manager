
import React, { useMemo, useState } from 'react';
import { Product, EuerSettings, ProductUsage } from '../../types';
import { FaCalculator, FaCog, FaInfoCircle } from 'react-icons/fa';
import { parseDMYtoDate } from '../../utils/dateUtils'; 

interface EuerPageProps {
  products: Product[];
  settings: EuerSettings;
  onSettingsChange: (settings: EuerSettings) => void;
}

const EuerPage: React.FC<EuerPageProps> = ({ products, settings, onSettingsChange }) => {
  const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    products.forEach(p => {
      const orderDate = parseDMYtoDate(p.date);
      if (orderDate) years.add(orderDate.getFullYear().toString());
      
      if (p.saleDate) { 
        const saleDateParts = p.saleDate.split('.');
        if (saleDateParts.length === 3) years.add(saleDateParts[2]);
      }
    });
    const currentYear = new Date().getFullYear().toString();
    if (!years.has(currentYear)) {
        years.add(currentYear);
    }
    return Array.from(years).sort((a,b) => parseInt(b) - parseInt(a));
  }, [products]);

  const parseSaleDate = (dateStr?: string): Date | null => {
    if (!dateStr) return null;
    const parts = dateStr.split('.');
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; 
      const year = parseInt(parts[2], 10);
      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        const d = new Date(year, month, day);
        if (d.getFullYear() === year && d.getMonth() === month && d.getDate() === day) {
            return d;
        }
      }
    }
    return null;
  };

  const euerData = useMemo(() => {
    let vineProductsIncomeLegacy = 0; // For old methods
    let goodsRelatedExpensesLegacy = 0; // For old methods
    
    let einnahmenGrundETV = 0; // For new method
    let ausgabenGrundETV = 0;  // For new method
    let einnahmenZusatzEntnahmeTeilwert = 0; // For new method
    
    let externalSalesIncome = 0;

    products.forEach(p => {
      const orderDate = parseDMYtoDate(p.date);
      if (!orderDate) return; 

      const orderYear = orderDate.getFullYear().toString();
      
      // Skip storniert and Streuartikel for all income/expense calculations relating to product value
      if (p.usageStatus.includes(ProductUsage.STORNIERT)) {
        return;
      }
      if (settings.streuArtikelLimitActive && p.etv < settings.streuArtikelLimitValue) {
        return;
      }

      const productValueForLegacy = settings.useTeilwertForIncome 
        ? (p.myTeilwert ?? p.teilwert) 
        : p.etv;

      // Calculations for the NEW EÜR Method (ETV In/Out + Teilwert Entnahme)
      if (settings.euerMethodETVInOutTeilwertEntnahme) {
        if (orderYear === selectedYear) {
          einnahmenGrundETV += p.etv;
          ausgabenGrundETV += p.etv;

          if (p.usageStatus.includes(ProductUsage.PRIVATENTNAHME) || 
              (p.usageStatus.length === 0 && !p.usageStatus.includes(ProductUsage.DEFEKT) && !p.usageStatus.includes(ProductUsage.ENTSORGT))) {
            einnahmenZusatzEntnahmeTeilwert += (p.myTeilwert ?? p.teilwert);
          }
        }
      } 
      // Calculations for the OLD EÜR Methods
      else {
        if (orderYear === selectedYear) {
          if (
            p.usageStatus.includes(ProductUsage.LAGER) ||
            p.usageStatus.includes(ProductUsage.BETRIEBLICHE_NUTZUNG) ||
            p.usageStatus.includes(ProductUsage.VERKAUFT)
          ) {
            goodsRelatedExpensesLegacy += productValueForLegacy;
          } else if (p.usageStatus.includes(ProductUsage.PRIVATENTNAHME) || p.usageStatus.length === 0 ) {
             if (!p.usageStatus.includes(ProductUsage.DEFEKT) && !p.usageStatus.includes(ProductUsage.ENTSORGT)) {
               vineProductsIncomeLegacy += productValueForLegacy;
             }
          }
        }
      }

      // External Sales Income - common for all methods
      if (p.usageStatus.includes(ProductUsage.VERKAUFT) && p.salePrice != null && p.saleDate) {
        const saleDateObj = parseSaleDate(p.saleDate);
        if (saleDateObj && saleDateObj.getFullYear().toString() === selectedYear) {
          externalSalesIncome += p.salePrice;
        }
      }
    });
    
    let totalIncome = 0;
    let totalOperationalExpenses = 0;

    if (settings.euerMethodETVInOutTeilwertEntnahme) {
      totalIncome = einnahmenGrundETV + einnahmenZusatzEntnahmeTeilwert + externalSalesIncome;
      totalOperationalExpenses = ausgabenGrundETV + settings.homeOfficePauschale;
    } else {
      totalIncome = vineProductsIncomeLegacy + externalSalesIncome;
      totalOperationalExpenses = settings.homeOfficePauschale + goodsRelatedExpensesLegacy;
    }
    
    const profit = totalIncome - totalOperationalExpenses;

    return {
      year: selectedYear,
      // For new method display
      einnahmenGrundETV,
      einnahmenZusatzEntnahmeTeilwert,
      ausgabenGrundETV,
      // For old methods display
      vineProductsIncomeLegacy,
      goodsRelatedExpensesLegacy,
      // Common
      externalSalesIncome,
      totalIncome,
      homeOfficePauschale: settings.homeOfficePauschale,
      totalOperationalExpenses,
      profit,
      // Settings flags for display logic
      streuArtikelActive: settings.streuArtikelLimitActive,
      streuArtikelLimit: settings.streuArtikelLimitValue,
      usingTeilwertForIncomeLegacy: settings.useTeilwertForIncome,
      usingEuerMethodETVInOut: settings.euerMethodETVInOutTeilwertEntnahme,
    };
  }, [products, selectedYear, settings]);


  const handleSettingsChange = <K extends keyof EuerSettings,>(key: K, value: EuerSettings[K]) => {
    const newSettings = { ...settings, [key]: value };
    // Mutual exclusivity logic
    if (key === 'useTeilwertForIncome' && value === true) {
      newSettings.euerMethodETVInOutTeilwertEntnahme = false;
    }
    if (key === 'euerMethodETVInOutTeilwertEntnahme' && value === true) {
      newSettings.useTeilwertForIncome = false;
    }
    onSettingsChange(newSettings);
  };
  
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
  };

  return (
    <div className="space-y-8">
      <div className="p-6 bg-slate-800 rounded-lg shadow-xl border border-slate-700">
        <h2 className="text-2xl font-semibold text-gray-100 mb-6 flex items-center">
            <FaCog className="mr-3 text-sky-400"/> EÜR Einstellungen
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div>
                <label htmlFor="euerYear" className="block text-sm font-medium text-gray-300">Jahr für EÜR</label>
                <select
                    id="euerYear"
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(e.target.value)}
                    className="mt-1 block w-full pl-3 pr-10 py-2 text-base bg-slate-700 border-slate-600 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm rounded-md text-gray-100"
                >
                    {availableYears.map(year => <option key={year} value={year}>{year}</option>)}
                </select>
            </div>
            <div>
                <label htmlFor="homeOfficePauschale" className="block text-sm font-medium text-gray-300">
                    Home-Office-Pauschale (€)
                </label>
                <input
                    type="number"
                    id="homeOfficePauschale"
                    value={settings.homeOfficePauschale}
                    onChange={(e) => handleSettingsChange('homeOfficePauschale', parseFloat(e.target.value) || 0)}
                    className="mt-1 block w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm text-gray-100 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm"
                />
            </div>

            <div className="md:col-span-2 border-t border-slate-700 pt-4 mt-2">
                <p className="text-sm font-medium text-gray-300 mb-2">Berechnungsmethode für Vine-Produktwerte:</p>
                <div className="space-y-3">
                    <label className={`flex items-center space-x-2 text-sm ${settings.euerMethodETVInOutTeilwertEntnahme ? 'text-gray-500 cursor-not-allowed' : 'text-gray-300 cursor-pointer'}`}>
                        <input
                            type="checkbox"
                            checked={settings.useTeilwertForIncome}
                            disabled={settings.euerMethodETVInOutTeilwertEntnahme}
                            onChange={(e) => handleSettingsChange('useTeilwertForIncome', e.target.checked)}
                            className="form-checkbox h-4 w-4 text-sky-600 bg-slate-600 border-slate-500 rounded focus:ring-sky-500 disabled:opacity-50"
                        />
                        <span>Standard: Teilwert als Basis für Produktwert verwenden (statt ETV)</span>
                    </label>
                    <label className={`flex items-center space-x-2 text-sm ${settings.useTeilwertForIncome ? 'text-gray-500 cursor-not-allowed' : 'text-gray-300 cursor-pointer'}`}>
                        <input
                            type="checkbox"
                            checked={settings.euerMethodETVInOutTeilwertEntnahme}
                            disabled={settings.useTeilwertForIncome}
                            onChange={(e) => handleSettingsChange('euerMethodETVInOutTeilwertEntnahme', e.target.checked)}
                            className="form-checkbox h-4 w-4 text-sky-600 bg-slate-600 border-slate-500 rounded focus:ring-sky-500 disabled:opacity-50"
                        />
                        <span>Alternative Methode: ETV als Einnahme/Ausgabe + Entnahme (Teilwert) als Einnahme</span>
                    </label>
                </div>
            </div>
            
            <div className="md:col-span-2 border-t border-slate-700 pt-4 mt-2">
                <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={settings.streuArtikelLimitActive}
                        onChange={(e) => handleSettingsChange('streuArtikelLimitActive', e.target.checked)}
                        className="form-checkbox h-4 w-4 text-sky-600 bg-slate-600 border-slate-500 rounded focus:ring-sky-500"
                    />
                    <span>Streuartikelregelung anwenden</span>
                </label>
                {settings.streuArtikelLimitActive && (
                    <div className="mt-2 pl-6">
                        <label htmlFor="streuArtikelLimitValue" className="block text-xs font-medium text-gray-400">
                            Grenzwert für Streuartikel (€)
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            id="streuArtikelLimitValue"
                            value={settings.streuArtikelLimitValue}
                            onChange={(e) => handleSettingsChange('streuArtikelLimitValue', parseFloat(e.target.value) || 0)}
                            className="mt-1 block w-full px-3 py-1.5 bg-slate-600 border-slate-500 rounded-md shadow-sm text-gray-100 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-xs"
                        />
                         <p className="text-xs text-gray-500 mt-1">Produkte mit ETV unter diesem Wert werden ignoriert.</p>
                    </div>
                )}
            </div>
        </div>
      </div>

      <div className="p-6 bg-slate-800 rounded-lg shadow-xl border border-slate-700">
        <h2 className="text-2xl font-semibold text-gray-100 mb-6 flex items-center">
            <FaCalculator className="mr-3 text-sky-400"/> Einnahmenüberschussrechnung für {euerData.year}
        </h2>
        <div className="space-y-4">
            <div className="p-3 bg-slate-700 rounded-md">
                <div className="flex justify-between items-center">
                    <span className="font-semibold text-gray-100">Einnahmen:</span>
                    <span className="font-bold text-green-400">{formatCurrency(euerData.totalIncome)}</span>
                </div>
                <div className="pl-6 space-y-1 mt-1">
                    {euerData.usingEuerMethodETVInOut ? (
                        <>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-300">Einnahmen (Basis ETV):</span>
                                <span className="text-green-400">{formatCurrency(euerData.einnahmenGrundETV)}</span>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-300">Zusätzliche Einnahmen (Entnahme Teilwert):</span>
                                <span className="text-green-400">{formatCurrency(euerData.einnahmenZusatzEntnahmeTeilwert)}</span>
                            </div>
                        </>
                    ) : (
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-gray-300">Einnahmen aus Vine-Produkten ({euerData.usingTeilwertForIncomeLegacy ? 'Teilwerte' : 'ETVs'}):</span>
                            <span className="text-green-400">{formatCurrency(euerData.vineProductsIncomeLegacy)}</span>
                        </div>
                    )}
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-300">Einnahmen aus Verkäufen:</span>
                        <span className="text-green-400">{formatCurrency(euerData.externalSalesIncome)}</span>
                    </div>
                </div>
            </div>
             {euerData.streuArtikelActive && (
                <div className="flex justify-start items-center p-2 bg-slate-750 rounded-md text-xs">
                    <span className="text-gray-400 flex items-center"><FaInfoCircle className="mr-1 h-3 w-3"/>Streuartikelregelung aktiv (Limit: {formatCurrency(euerData.streuArtikelLimit)})</span>
                </div>
            )}
            <div className="p-3 bg-slate-700 rounded-md">
                 <div className="flex justify-between items-center">
                    <span className="font-semibold text-gray-100">Betriebsausgaben:</span>
                    <span className="font-bold text-red-400">{formatCurrency(euerData.totalOperationalExpenses)}</span>
                </div>
                <div className="pl-6 space-y-1 mt-1">
                    {euerData.usingEuerMethodETVInOut ? (
                         <div className="flex justify-between items-center text-sm">
                            <span className="text-gray-400">Ausgaben (Basis ETV):</span>
                            <span className="text-red-400">{formatCurrency(euerData.ausgabenGrundETV)}</span>
                        </div>
                    ) : (
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-gray-400">Abzug für Produkte (Lager/Betrieb/Verkauft im Bestelljahr):</span>
                            <span className="text-red-400">{formatCurrency(euerData.goodsRelatedExpensesLegacy)}</span>
                        </div>
                    )}
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-400">Home-Office-Pauschale:</span>
                        <span className="text-red-400">{formatCurrency(euerData.homeOfficePauschale)}</span>
                    </div>
                </div>
            </div>
            <hr className="border-slate-600"/>
            <div className="flex justify-between items-center p-3 bg-slate-700 rounded-md text-lg">
                <span className="font-bold text-gray-100">Gewinn / Verlust:</span>
                <span className={`font-bold ${euerData.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatCurrency(euerData.profit)}
                </span>
            </div>
        </div>
         {euerData.usingEuerMethodETVInOut && (
            <p className="text-xs text-gray-400 mt-4 px-1">
                <FaInfoCircle className="inline mr-1 mb-0.5"/>
                Alternative EÜR-Methode aktiv: ETVs werden als Einnahme und sofort als Ausgabe gebucht. 
                Zusätzlich wird der Teilwert bei Privatentnahme als Einnahme erfasst.
            </p>
        )}
      </div>
    </div>
  );
};

export default EuerPage;
