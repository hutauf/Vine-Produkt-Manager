import React, { useMemo, useState } from 'react';
import { ProductUsage, EuerPageProps, EuerSettings } from '../../types';
import { FaCalculator, FaCog, FaFileExcel, FaFilePdf, FaInfoCircle } from 'react-icons/fa';
import { parseGermanDate } from '../../utils/dateUtils';
import { DEFAULT_PRIVATENTNAHME_DELAY_OPTIONS } from '../../constants';
import { isProductIgnoredForBelegAndEuer } from '../../utils/euerUtils';
import { getProductBookingEntries } from '../../utils/bookingUtils';
import { buildEuerExportRows, exportEuerRowsToPdf, exportEuerRowsToXlsx } from '../../utils/euerExport';

const EuerPage: React.FC<EuerPageProps> = ({ products, settings, onSettingsChange, additionalExpenses }) => {
  const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());

  const availableYears = useMemo(() => {
    const years = new Set<string>();

    products.forEach(p => {
      if (isProductIgnoredForBelegAndEuer(p, settings)) return;

      const entries = getProductBookingEntries(p, settings);
      entries.forEach(entry => years.add(entry.date.getUTCFullYear().toString()));

      if (p.saleDate) {
        const saleDateObj = parseGermanDate(p.saleDate);
        if (saleDateObj) years.add(saleDateObj.getFullYear().toString());
      }
    });

    additionalExpenses.forEach(exp => {
      const expenseDate = parseGermanDate(exp.date);
      if (expenseDate) years.add(expenseDate.getFullYear().toString());
    });

    const currentYear = new Date().getFullYear().toString();
    if (!years.has(currentYear)) years.add(currentYear);

    return Array.from(years).sort((a, b) => parseInt(b) - parseInt(a));
  }, [products, settings, additionalExpenses]);

  const euerData = useMemo(() => {
    let einnahmenAusVerkauf = 0;
    let einnahmenProduktzugang = 0;
    let einnahmenPrivatentnahme = 0;

    let ausgabenAnlagevermoegen = 0;
    let ausgabenUmlaufvermoegen = 0;
    const ausgabenHomeOffice = settings.homeOfficePauschale;

    products.forEach(p => {
      if (isProductIgnoredForBelegAndEuer(p, settings)) return;

      const entries = getProductBookingEntries(p, settings);
      entries.forEach(entry => {
        const entryYear = entry.date.getUTCFullYear().toString();
        if (entryYear !== selectedYear) return;
        if (entry.amount == null) return;

        if (entry.type === 'Einnahme') {
          einnahmenProduktzugang += entry.amount;
        } else if (entry.type === 'Ausgabe') {
          if (p.usageStatus.includes(ProductUsage.BETRIEBLICHE_NUTZUNG)) {
            ausgabenAnlagevermoegen += entry.amount;
          } else if (
            p.usageStatus.includes(ProductUsage.LAGER) ||
            p.usageStatus.includes(ProductUsage.VERKAUFT) ||
            p.usageStatus.includes(ProductUsage.ENTSORGT)
          ) {
            ausgabenUmlaufvermoegen += entry.amount;
          } else {
            ausgabenAnlagevermoegen += entry.amount;
          }
        } else if (entry.type === 'Entnahme') {
          einnahmenPrivatentnahme += entry.amount;
        }
      });

      if (p.usageStatus.includes(ProductUsage.VERKAUFT) && p.salePrice != null && p.saleDate) {
        const saleDateObj = parseGermanDate(p.saleDate);
        if (saleDateObj && saleDateObj.getFullYear().toString() === selectedYear) {
          einnahmenAusVerkauf += p.salePrice;
        }
      }
    });

    const ausgabenSonstigeBetriebsausgaben = additionalExpenses
      .filter(exp => {
        const expenseDate = parseGermanDate(exp.date);
        return expenseDate && expenseDate.getFullYear().toString() === selectedYear;
      })
      .reduce((sum, exp) => sum + exp.amount, 0);

    const totalIncome = einnahmenAusVerkauf + einnahmenProduktzugang + einnahmenPrivatentnahme;
    const totalOperationalExpenses = ausgabenAnlagevermoegen + ausgabenUmlaufvermoegen + ausgabenHomeOffice + ausgabenSonstigeBetriebsausgaben;

    return {
      year: selectedYear,
      einnahmenAusVerkauf,
      einnahmenProduktzugang,
      einnahmenPrivatentnahme,
      totalIncome,
      ausgabenAnlagevermoegen,
      ausgabenUmlaufvermoegen,
      ausgabenHomeOffice,
      ausgabenSonstigeBetriebsausgaben,
      totalOperationalExpenses,
      profit: totalIncome - totalOperationalExpenses,
      streuArtikelActive: settings.streuArtikelLimitActive,
      streuArtikelLimit: settings.streuArtikelLimitValue,
      usingEuerMethodETVInOut: settings.euerMethodETVInOutTeilwertEntnahme,
    };
  }, [products, selectedYear, settings, additionalExpenses]);

  const handleSettingsChange = <K extends keyof EuerSettings,>(key: K, value: EuerSettings[K]) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
  };

  const handleExportXlsx = () => {
    const rows = buildEuerExportRows(products, settings, selectedYear);
    if (!rows.length) {
      alert(`Keine produktbezogenen EÜR-Daten für ${selectedYear} gefunden.`);
      return;
    }
    exportEuerRowsToXlsx(rows, selectedYear);
  };

  const handleExportPdf = () => {
    const rows = buildEuerExportRows(products, settings, selectedYear);
    if (!rows.length) {
      alert(`Keine produktbezogenen EÜR-Daten für ${selectedYear} gefunden.`);
      return;
    }
    exportEuerRowsToPdf(rows, selectedYear);
  };

  return (
    <div className="space-y-8">
      <div className="p-6 bg-slate-800 rounded-lg shadow-xl border border-slate-700">
        <h2 className="text-2xl font-semibold text-gray-100 mb-6 flex items-center">
          <FaCog className="mr-3 text-sky-400" /> EÜR Einstellungen
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

          <div>
            <label htmlFor="defaultPrivatentnahmeDelay" className="block text-sm font-medium text-gray-300">Standardzeitpunkt für Privatentnahme</label>
            <select
              id="defaultPrivatentnahmeDelay"
              value={settings.defaultPrivatentnahmeDelay}
              onChange={(e) => handleSettingsChange('defaultPrivatentnahmeDelay', e.target.value)}
              className="mt-1 block w-full pl-3 pr-10 py-2 text-base bg-slate-700 border-slate-600 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm rounded-md text-gray-100"
            >
              {DEFAULT_PRIVATENTNAHME_DELAY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>

          <div className="md:col-span-2 border-t border-slate-700 pt-4 mt-2 space-y-3">
            <p className="text-sm font-medium text-gray-300">Berechnungsmethode für Produktwerte:</p>
            <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.useTeilwertForIncome}
                onChange={(e) => handleSettingsChange('useTeilwertForIncome', e.target.checked)}
                className="form-checkbox h-4 w-4 text-sky-600 bg-slate-600 border-slate-500 rounded focus:ring-sky-500"
              />
              <span>Teilwert als Basis für Produktwert verwenden (statt ETV)</span>
            </label>

            <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.euerMethodETVInOutTeilwertEntnahme}
                onChange={(e) => handleSettingsChange('euerMethodETVInOutTeilwertEntnahme', e.target.checked)}
                className="form-checkbox h-4 w-4 text-sky-600 bg-slate-600 border-slate-500 rounded focus:ring-sky-500"
              />
              <span>Einnahme/Ausgabe im Bestelljahr + spätere Entnahme (Teilwert) im Entnahmejahr</span>
            </label>

            <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.privatentnahmeSameYearAsOnlyIncome}
                onChange={(e) => handleSettingsChange('privatentnahmeSameYearAsOnlyIncome', e.target.checked)}
                className="form-checkbox h-4 w-4 text-sky-600 bg-slate-600 border-slate-500 rounded focus:ring-sky-500"
              />
              <span>Bei Privatentnahme im selben Jahr ohne Ausgabe nur Einnahme</span>
            </label>
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
                <p className="text-xs text-gray-500 mt-1">Produkte mit ETV unter diesem Wert (inkl. ETV=0) werden ignoriert.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-6 bg-slate-800 rounded-lg shadow-xl border border-slate-700">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-6 gap-3">
          <h2 className="text-2xl font-semibold text-gray-100 flex items-center">
            <FaCalculator className="mr-3 text-sky-400" /> Einnahmenüberschussrechnung für {euerData.year}
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportXlsx}
              className="inline-flex items-center px-3 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
              title={`EÜR Details ${selectedYear} als XLSX exportieren`}
            >
              <FaFileExcel className="mr-2" />
              XLSX Export
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              className="inline-flex items-center px-3 py-2 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium transition-colors"
              title={`EÜR Details ${selectedYear} als PDF exportieren`}
            >
              <FaFilePdf className="mr-2" />
              PDF Export
            </button>
          </div>
        </div>
        <div className="space-y-4">
          <div className="p-3 bg-slate-700 rounded-md">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-gray-100">Einnahmen:</span>
              <span className="font-bold text-green-400">{formatCurrency(euerData.totalIncome)}</span>
            </div>
            <div className="pl-6 space-y-1 mt-1 text-sm">
              <div className="flex justify-between items-center"><span className="text-gray-300">Einnahmen aus Verkäufen:</span><span className="text-green-400">{formatCurrency(euerData.einnahmenAusVerkauf)}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-300">Produktzugänge:</span><span className="text-green-400">{formatCurrency(euerData.einnahmenProduktzugang)}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-300">Privatentnahmen:</span><span className="text-green-400">{formatCurrency(euerData.einnahmenPrivatentnahme)}</span></div>
            </div>
          </div>

          {euerData.streuArtikelActive && (
            <div className="flex justify-start items-center p-2 bg-slate-750 rounded-md text-xs">
              <span className="text-gray-400 flex items-center"><FaInfoCircle className="mr-1 h-3 w-3" />Streuartikelregelung aktiv (Limit: {formatCurrency(euerData.streuArtikelLimit)})</span>
            </div>
          )}

          <div className="p-3 bg-slate-700 rounded-md">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-gray-100">Betriebsausgaben:</span>
              <span className="font-bold text-red-400">{formatCurrency(euerData.totalOperationalExpenses)}</span>
            </div>
            <div className="pl-6 space-y-1 mt-1 text-sm">
              <div className="flex justify-between items-center"><span className="text-gray-400">Ausgaben für Anlagevermögen:</span><span className="text-red-400">{formatCurrency(euerData.ausgabenAnlagevermoegen)}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-400">Ausgaben für Umlaufvermögen:</span><span className="text-red-400">{formatCurrency(euerData.ausgabenUmlaufvermoegen)}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-400">Home-Office-Pauschale:</span><span className="text-red-400">{formatCurrency(euerData.ausgabenHomeOffice)}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-400">Sonstige erfasste Betriebsausgaben:</span><span className="text-red-400">{formatCurrency(euerData.ausgabenSonstigeBetriebsausgaben)}</span></div>
            </div>
          </div>

          <hr className="border-slate-600" />
          <div className="flex justify-between items-center p-3 bg-slate-700 rounded-md text-lg">
            <span className="font-bold text-gray-100">Gewinn / Verlust:</span>
            <span className={`font-bold ${euerData.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {formatCurrency(euerData.profit)}
            </span>
          </div>
        </div>

        {euerData.usingEuerMethodETVInOut ? (
          <p className="text-xs text-gray-400 mt-4 px-1">
            <FaInfoCircle className="inline mr-1 mb-0.5" />
            Methode aktiv: Einnahme und Ausgabe werden im Bestelljahr mit dem gewählten Basiswert (ETV/Teilwert) gebucht.
          </p>
        ) : (
          <p className="text-xs text-gray-400 mt-4 px-1">
            <FaInfoCircle className="inline mr-1 mb-0.5" />
            Standard EÜR-Methode aktiv:
            Produktzugänge (Lager, Betriebl.Nutzung, Entsorgt, Verkauft) werden im Bestelljahr mit {settings.useTeilwertForIncome ? 'Teilwert' : 'ETV'} als Einnahme gebucht.
            Ausgaben für Anlage-/Umlaufvermögen ebenso im Bestelljahr mit {settings.useTeilwertForIncome ? 'Teilwert' : 'ETV'}.
            Privatentnahmen werden im Entnahmejahr mit {settings.useTeilwertForIncome ? 'Teilwert' : 'ETV'} als Einnahme gebucht (keine direkte Ausgabe im Bestelljahr für diese).
          </p>
        )}
      </div>
    </div>
  );
};

export default EuerPage;
