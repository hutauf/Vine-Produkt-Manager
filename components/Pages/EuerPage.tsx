import React, { useEffect, useMemo, useState } from 'react';
import { ProductUsage, EuerPageProps, EuerSettings } from '../../types';
import { FaCalculator, FaCog, FaFileExcel, FaFilePdf, FaInfoCircle, FaSave, FaBook } from 'react-icons/fa';
import { parseGermanDate } from '../../utils/dateUtils';
import { DEFAULT_PRIVATENTNAHME_DELAY_OPTIONS } from '../../constants';
import { isProductIgnoredForBelegAndEuer } from '../../utils/euerUtils';
import { getProductBookingEntries } from '../../utils/bookingUtils';
import { buildEuerExportRows, exportEuerRowsToPdf, exportEuerRowsToXlsx } from '../../utils/euerExport';
import { apiGetProcedureDoc, apiUpdateProcedureDoc } from '../../utils/apiService';
import { jsPDF } from 'jspdf';



type ProcedureSection = {
  id: string;
  title: string;
  level: 1 | 2;
  body?: string[];
};
type ProcedureDocVersion = {
  version: number;
  timestamp: number;
  docId: string;
};

const PROCEDURE_SECURITY_TEXT = 'Die vollständige Amazon-Bestellhistorie sowie die Datensätze des Vine Produkt Managers (inklusive Audit-Log/Änderungshistorie) werden unverändert gespeichert und dienen als nachvollziehbarer Nachweis der Einzelvorgänge. Änderungen an erfassten Datensätzen werden dokumentiert, sodass die Entstehung und Entwicklung der Buchungsgrundlagen jederzeit prüfbar bleibt.';

const createProcedureDocPdf = (variables: {
  name: string;
  anschrift: string;
  plzOrt: string;
  ustId: string;
  kleinunternehmerSatz: string;
  datumHeute: string;
  uhrzeitHeute: string;
  wertText: string;
  lagerort: string;
  software: string;
  backup: string;
  createdAtText: string;
  lastUpdatedText: string;
  versionLabel: string;
  changeHistory: ProcedureDocVersion[];
  includeGeneratedAt: boolean;
}) => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 25;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - margin * 2;
  const lineHeight = 6.4;

  let y = margin;
  const tocEntries: { title: string; level: 1 | 2; page: number }[] = [];

  const ensurePageBreak = (neededHeight = lineHeight) => {
    if (y + neededHeight > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const addParagraph = (text: string) => {
    const cleaned = (text || '').trim();
    if (!cleaned) return;
    doc.setFont('times', 'normal');
    doc.setFontSize(11);
    const lines = doc.splitTextToSize(cleaned, contentWidth);
    lines.forEach((line: string) => {
      ensurePageBreak();
      doc.text(line, margin, y);
      y += lineHeight;
    });
    y += 1.5;
  };

  const addHeading = (title: string, level: 1 | 2) => {
    const fontSize = level === 1 ? 16 : 13;
    const topSpacing = level === 1 ? 5 : 3;
    ensurePageBreak(topSpacing + lineHeight);
    y += topSpacing;
    doc.setFont('times', 'bold');
    doc.setFontSize(fontSize);
    doc.text(title, margin, y);
    y += lineHeight + (level === 1 ? 1 : 0);
    tocEntries.push({ title, level, page: doc.getNumberOfPages() });
  };

  doc.setFont('times', 'bold');
  doc.setFontSize(24);
  doc.text('Verfahrensdokumentation zur Erfassung und Versteuerung von Amazon Vine Testprodukten', pageWidth / 2, 70, { align: 'center', maxWidth: 160 });

  doc.setFontSize(14);
  doc.setFont('times', 'normal');
  doc.text(`Dokumentenversion: ${variables.versionLabel}`, pageWidth / 2, 110, { align: 'center' });
  doc.text(`Erstellt am: ${variables.createdAtText}`, pageWidth / 2, 120, { align: 'center' });
  doc.text(`Stand vom: ${variables.lastUpdatedText}`, pageWidth / 2, 130, { align: 'center' });
  if (variables.includeGeneratedAt) {
    doc.text(`PDF generiert am: ${variables.datumHeute} um ${variables.uhrzeitHeute} Uhr`, pageWidth / 2, 140, { align: 'center' });
  }

  doc.setFont('times', 'bold');
  doc.setFontSize(14);
  doc.text('Steuerpflichtiger / Geltungsbereich:', margin, 160);
  doc.setFont('times', 'normal');
  doc.setFontSize(12);
  doc.text(`Name: ${variables.name}`, margin, 172);
  doc.text(`Anschrift: ${variables.anschrift}, ${variables.plzOrt}`, margin, 182);
  doc.text(`USt-IdNr.: ${variables.ustId}`, margin, 192);
  doc.text(`Steuerlicher Status: ${variables.kleinunternehmerSatz}`, margin, 202, { maxWidth: contentWidth });

  doc.addPage();
  y = margin;

  const tocPageNumber = doc.getNumberOfPages();
  doc.setFont('times', 'bold');
  doc.setFontSize(20);
  doc.text('Inhaltsverzeichnis', margin, y);

  doc.addPage();
  y = margin;

  const sections: ProcedureSection[] = [
    { id: '1', title: '1. Allgemeine Beschreibung', level: 1 },
    { id: '1.1', title: '1.1. Zweck der Dokumentation', level: 2, body: ['Diese Verfahrensdokumentation beschreibt die kaufmännischen, steuerlichen und technischen Prozesse des oben genannten Steuerpflichtigen im Rahmen seiner Tätigkeit als Produkttester für das "Amazon Vine"-Programm. Zweck ist die GoBD-konforme Darlegung, wie die durch Amazon überlassenen Sachbezüge (Testprodukte) erfasst, bewertet, aufbewahrt und in die Finanzbuchhaltung überführt werden.'] },
    { id: '1.2', title: '1.2. Geschäftsmodell und Prozessübersicht', level: 2, body: ['Der Steuerpflichtige fordert über das Amazon Vine Portal Testprodukte an. Die Produkte werden mit einem von Amazon geschätzten Steuerwert (Estimated Tax Value / ETV) ausgewiesen. Nach Erhalt sind die Produkte innerhalb einer Frist zu bewerten und unterliegen in der Regel einer sechsmonatigen Sperrfrist, in der sie weder veräußert noch an Dritte weitergegeben werden dürfen. Die Erfassung dieser Sachzuwendungen stellt die Grundlage für die steuerliche Gewinnermittlung (EÜR) dar.'] },
    { id: '2', title: '2. Anwenderdokumentation (Fachliches Verfahren)', level: 1 },
    { id: '2.1', title: '2.1. Erfassung und Lagerung', level: 2, body: ['Die Erfassung der bestellten und gelieferten Produkte erfolgt digital über das Tool "Vine Produkt Manager". Während der von Amazon vorgeschriebenen sechsmonatigen Sperrfrist, in der die Produkte im Eigentum von Amazon verbleiben bzw. nicht frei verwertbar sind, erfolgt die physische Aufbewahrung an folgendem Ort:', `${variables.lagerort}.`] },
    { id: '2.2', title: '2.2. Wertermittlung und Privatentnahme', level: 2, body: ['Die steuerliche Bemessungsgrundlage der erhaltenen Produkte wird nach fest definierten Regeln ermittelt. Hierfür gilt folgender, vom Steuerpflichtigen festgelegter Prozess:', variables.wertText] },
    { id: '3', title: '3. Technische Systemdokumentation', level: 1 },
    { id: '3.1', title: '3.1. Eingesetzte Systeme', level: 2, body: [`Die primäre Erfassung, Verwaltung und Historisierung der Testprodukte erfolgt durch die Software "Vine Produkt Manager". Sofern eine weitere Software für die finale Rechnungserstellung, Buchhaltung oder Übermittlung an das Finanzamt genutzt wird, handelt es sich um: ${variables.software}. Ist hier keine Software aufgeführt, erfolgt die Übertragung der ermittelten Summen direkt in das ELSTER-Portal der Finanzverwaltung.`] },
    { id: '4', title: '4. Betriebsdokumentation', level: 1 },
    { id: '4.1', title: '4.1. Unveränderbarkeit und Revisionssicherheit', level: 2, body: ['Um die gesetzlich vorgeschriebene Unveränderbarkeit von Buchungsdatensätzen (§ 146 Abs. 4 AO) zu gewährleisten, greifen folgende technische und organisatorische Schutzmaßnahmen:', PROCEDURE_SECURITY_TEXT] },
    { id: '4.2', title: '4.2. Datensicherung und Aufbewahrung', level: 2, body: ['Der Steuerpflichtige ist für die Einhaltung der 10-jährigen gesetzlichen Aufbewahrungsfrist der digitalen Unterlagen selbst verantwortlich. Um Datenverlust vorzubeugen, wird folgende Backup-Strategie für die lokale Datenbank des Vine Produkt Managers angewendet:', `Die Sicherung erfolgt über: ${variables.backup}.`] },
    { id: '5', title: '5. Änderungshistorie', level: 1 },
  ];

  sections.forEach(section => {
    addHeading(section.title, section.level);
    section.body?.forEach(addParagraph);
    if (section.id === '5') {
      const sorted = [...variables.changeHistory].sort((a, b) => a.version - b.version);
      doc.setFont('times', 'bold');
      doc.setFontSize(11);
      ensurePageBreak(lineHeight);
      doc.text('Version', margin, y);
      doc.text('Zeitpunkt', margin + 40, y);
      y += lineHeight;
      doc.setFont('times', 'normal');
      sorted.forEach(entry => {
        ensurePageBreak(lineHeight);
        const tsDate = new Date(entry.timestamp * 1000);
        doc.text(`${entry.version}`, margin, y);
        doc.text(tsDate.toLocaleString('de-DE'), margin + 40, y);
        y += lineHeight;
      });
    }
  });

  doc.setPage(tocPageNumber);
  y = margin + 12;
  doc.setFont('times', 'normal');
  doc.setFontSize(11);
  tocEntries.forEach(entry => {
    const indent = entry.level === 1 ? 0 : 8;
    const titleX = margin + indent;
    const dotsStartX = margin + 130;
    ensurePageBreak();
    doc.text(entry.title, titleX, y);
    const pageText = `${entry.page}`;
    const pageWidthText = doc.getTextWidth(pageText);
    const dotsWidth = dotsStartX - titleX - doc.getTextWidth(entry.title) - 4;
    if (dotsWidth > 6) {
      const dotCount = Math.floor(dotsWidth / doc.getTextWidth('.'));
      doc.text('.'.repeat(Math.max(4, dotCount)), titleX + doc.getTextWidth(entry.title) + 2, y);
    }
    doc.text(pageText, pageWidth - margin - pageWidthText, y);
    y += lineHeight;
  });

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('times', 'normal');
    doc.setFontSize(9);
    doc.text(`Seite ${i} von ${totalPages}`, pageWidth - margin, pageHeight - 10, { align: 'right' });
  }

  return doc;
};
const EuerPage: React.FC<EuerPageProps> = ({ products, settings, onSettingsChange, additionalExpenses, apiToken, apiBaseUrl, belegSettings, onBelegSettingsChange }) => {
  const [isProcedureOpen, setIsProcedureOpen] = useState(false);
  const [useAutoText, setUseAutoText] = useState(true);
  const [customText, setCustomText] = useState('');
  const [storageLocation, setStorageLocation] = useState('');
  const [accountingTool, setAccountingTool] = useState('Keines (Direkt Elster)');
  const [otherAccountingTool, setOtherAccountingTool] = useState('');
  const [backupStrategy, setBackupStrategy] = useState('Lokale Festplatte');
  const [lastUpdatedTs, setLastUpdatedTs] = useState<number | null>(null);
  const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
  const [procedureVersions, setProcedureVersions] = useState<ProcedureDocVersion[]>([]);
  const [createdAtTs, setCreatedAtTs] = useState<number | null>(null);
  const [isProcedureDirty, setIsProcedureDirty] = useState(false);
  const [hasLoadedProcedureDoc, setHasLoadedProcedureDoc] = useState(false);

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

  const procedureAutoText = useMemo(() => {
    const methode = settings.useTeilwertForIncome ? 'Teilwert' : 'ETV';
    const entnahme =
      settings.defaultPrivatentnahmeDelay === '14d'
        ? '2 Wochen nach Bestellung'
        : settings.defaultPrivatentnahmeDelay === '0d'
          ? 'sofort'
          : `${settings.defaultPrivatentnahmeDelay} nach Bestellung`;
    const streu = settings.streuArtikelLimitActive
      ? `Streuartikel unter ${new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(settings.streuArtikelLimitValue)} werden steuerlich nicht erfasst.`
      : 'Die Streuartikelregelung wird derzeit nicht angewendet.';
    return `Der Steuerpflichtige ermittelt den Wert der Testprodukte basierend auf ${methode}. Die Privatentnahme erfolgt standardmäßig ${entnahme}. ${streu}`;
  }, [settings]);

  useEffect(() => {
    if (!isProcedureOpen || !apiToken) return;
    (async () => {
      const resp = await apiGetProcedureDoc(apiBaseUrl, apiToken, 'verfahrensdoku-main');
      if (resp.status !== 'success' || !resp.data?.length) return;
      const entry = resp.data[0];
        setLastUpdatedTs(entry.timestamp || null);
        setCreatedAtTs(entry.timestamp || null);
      try {
        const parsed = JSON.parse(entry.value || '{}');
        setUseAutoText(parsed.useAutoText ?? true);
        setCustomText(parsed.customText ?? '');
        setStorageLocation(parsed.storageLocation ?? '');
        setAccountingTool(parsed.accountingTool ?? 'Keines (Direkt Elster)');
        setOtherAccountingTool(parsed.otherAccountingTool ?? '');
        setBackupStrategy(parsed.backupStrategy ?? 'Lokale Festplatte');
        const parsedHistory = Array.isArray(parsed.versionHistory) ? parsed.versionHistory : [];
        const normalizedHistory = parsedHistory
          .filter((h: any) => typeof h?.version === 'number' && typeof h?.timestamp === 'number' && typeof h?.docId === 'string')
          .map((h: any) => ({ version: h.version, timestamp: h.timestamp, docId: h.docId })) as ProcedureDocVersion[];
        setProcedureVersions(normalizedHistory);
        if (typeof parsed.createdAt === 'number') setCreatedAtTs(parsed.createdAt);
        setIsProcedureDirty(false);
        setHasLoadedProcedureDoc(true);
      } catch (e) {
        console.error('Verfahrensdoku konnte nicht geparst werden', e);
      }
    })();
  }, [isProcedureOpen, apiToken, apiBaseUrl]);

  useEffect(() => {
    if (!isProcedureOpen || !hasLoadedProcedureDoc) return;
    setIsProcedureDirty(true);
  }, [useAutoText, customText, storageLocation, accountingTool, otherAccountingTool, backupStrategy, belegSettings.userData, isProcedureOpen, hasLoadedProcedureDoc]);

  const handleAddressChange = (key: 'nameOrCompany' | 'addressLine1' | 'addressLine2' | 'vatId' | 'isKleinunternehmer', value: string | boolean) => {
    onBelegSettingsChange(prev => ({ ...prev, userData: { ...prev.userData, [key]: value } }));
  };

  const handleSaveProcedureDoc = async () => {
    if (!apiToken) return alert('Bitte API Token konfigurieren, um die Verfahrensdoku zu speichern.');
    const ts = Math.floor(Date.now() / 1000);
    const nextVersion = (procedureVersions.reduce((max, entry) => Math.max(max, entry.version), 0) || 0) + 1;
    const versionDocId = `verfahrensdoku-v${nextVersion}`;
    const nextHistory = [...procedureVersions, { version: nextVersion, timestamp: ts, docId: versionDocId }];
    const effectiveCreatedAt = createdAtTs ?? ts;
    const payload = JSON.stringify({ useAutoText, customText, storageLocation, accountingTool, otherAccountingTool, backupStrategy, createdAt: effectiveCreatedAt, versionHistory: nextHistory });
    const [versionResp, mainResp] = await Promise.all([
      apiUpdateProcedureDoc(apiBaseUrl, apiToken, versionDocId, payload, ts),
      apiUpdateProcedureDoc(apiBaseUrl, apiToken, 'verfahrensdoku-main', payload, ts),
    ]);
    if (versionResp.status === 'success' && mainResp.status === 'success') {
      setLastUpdatedTs(ts);
      setCreatedAtTs(effectiveCreatedAt);
      setProcedureVersions(nextHistory);
      setIsProcedureDirty(false);
      alert('Verfahrensdokumentation gespeichert.');
    } else {
      alert(`Fehler beim Speichern: ${versionResp.message || mainResp.message || 'Unbekannt'}`);
    }
  };

  const handleExportProcedurePdf = () => {
    const now = new Date();
    const datumHeute = now.toLocaleDateString('de-DE');
    const uhrzeitHeute = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const doc = createProcedureDocPdf({
      name: belegSettings.userData.nameOrCompany || 'Nicht angegeben',
      anschrift: belegSettings.userData.addressLine1 || 'Nicht angegeben',
      plzOrt: belegSettings.userData.addressLine2 || 'Nicht angegeben',
      ustId: belegSettings.userData.vatId || 'Nicht angegeben',
      kleinunternehmerSatz: belegSettings.userData.isKleinunternehmer
        ? 'Das Unternehmen macht von der Kleinunternehmerregelung nach § 19 UStG Gebrauch.'
        : 'Das Unternehmen ist regelbesteuert.',
      datumHeute,
      uhrzeitHeute,
      wertText: (useAutoText ? procedureAutoText : customText).trim() || 'Nicht angegeben.',
      lagerort: (storageLocation || 'Nicht angegeben').trim(),
      software: (accountingTool === 'Sonstiges (Freitext)' ? otherAccountingTool : accountingTool).trim() || 'Keine zusätzliche Software',
      backup: (backupStrategy || 'Nicht angegeben').trim(),
      createdAtText: createdAtTs ? new Date(createdAtTs * 1000).toLocaleString('de-DE') : now.toLocaleString('de-DE'),
      lastUpdatedText: lastUpdatedTs ? new Date(lastUpdatedTs * 1000).toLocaleString('de-DE') : now.toLocaleString('de-DE'),
      versionLabel: `v${Math.max(1, ...procedureVersions.map(v => v.version))}`,
      changeHistory: procedureVersions,
      includeGeneratedAt: true,
    });

    doc.save('GoBD_Verfahrensdokumentation.pdf');
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
        <button onClick={() => setIsProcedureOpen(v => !v)} className="w-full flex items-center justify-between text-left">
          <h2 className="text-2xl font-semibold text-gray-100 flex items-center"><FaBook className="mr-3 text-sky-400" /> Verfahrensdokumentation (GoBD)</h2>
          <span className="text-sky-300 text-sm">{isProcedureOpen ? 'Einklappen' : 'Öffnen'}</span>
        </button>
        {isProcedureOpen && (
          <div className="mt-5 space-y-4 text-gray-200">
            <p className="text-xs text-gray-400">Hinweis: Adressdaten sind global und werden mit dem Reiter „Belege“ synchronisiert.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input className="px-3 py-2 bg-slate-700 rounded" value={belegSettings.userData.nameOrCompany} onChange={(e) => handleAddressChange('nameOrCompany', e.target.value)} placeholder="Name/Firma" />
              <input className="px-3 py-2 bg-slate-700 rounded" value={belegSettings.userData.vatId} onChange={(e) => handleAddressChange('vatId', e.target.value)} placeholder="USt-IdNr." />
              <input className="px-3 py-2 bg-slate-700 rounded" value={belegSettings.userData.addressLine1} onChange={(e) => handleAddressChange('addressLine1', e.target.value)} placeholder="Anschrift Zeile 1" />
              <input className="px-3 py-2 bg-slate-700 rounded" value={belegSettings.userData.addressLine2} onChange={(e) => handleAddressChange('addressLine2', e.target.value)} placeholder="Anschrift Zeile 2" />
            </div>
            <label className="flex items-center gap-2"><input type="checkbox" checked={belegSettings.userData.isKleinunternehmer} onChange={(e) => handleAddressChange('isKleinunternehmer', e.target.checked)} /> Kleinunternehmer (§19 UStG)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={useAutoText} onChange={(e) => setUseAutoText(e.target.checked)} /> Automatisch aus EÜR-Einstellungen generierten Text verwenden</label>
            {useAutoText ? <p className="text-sm bg-slate-700 p-3 rounded">{procedureAutoText}</p> : <textarea value={customText} onChange={(e) => setCustomText(e.target.value)} className="w-full min-h-28 px-3 py-2 bg-slate-700 rounded" />}
            <input className="w-full px-3 py-2 bg-slate-700 rounded" value={storageLocation} onChange={(e) => setStorageLocation(e.target.value)} placeholder="Lagerort während 6-monatiger Sperrfrist" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <select value={accountingTool} onChange={(e) => setAccountingTool(e.target.value)} className="px-3 py-2 bg-slate-700 rounded">
                {['Keines (Direkt Elster)', 'invoiz', 'lexoffice', 'sevDesk', 'Sonstiges (Freitext)'].map(opt => <option key={opt}>{opt}</option>)}
              </select>
              {accountingTool === 'Sonstiges (Freitext)' && <input className="px-3 py-2 bg-slate-700 rounded" value={otherAccountingTool} onChange={(e) => setOtherAccountingTool(e.target.value)} placeholder="Sonstiges Tool" />}
            </div>
            <div className="bg-slate-700 rounded p-3 text-sm">Vollständigkeit der Einnahmen: Alle bestellten Testprodukte sind dauerhaft und unveränderlich in der Amazon Vine Bestellhistorie des Nutzers hinterlegt. Ein spurloses Löschen von Produkten zur Verschleierung von Sachbezügen ist systemseitig durch Amazon ausgeschlossen.{"\n"}Revisionssicherheit des Tools: Der eingesetzte 'Vine Produkt Manager' protokolliert jede Änderung an Produktdaten und Einstellungen serverseitig in einem append-only Audit-Log.</div>
            <select value={backupStrategy} onChange={(e) => setBackupStrategy(e.target.value)} className="px-3 py-2 bg-slate-700 rounded">
              {['Lokale Festplatte', 'Externe Festplatte / NAS', 'Cloud-Speicher'].map(opt => <option key={opt}>{opt}</option>)}
            </select>
            {lastUpdatedTs && <p className="text-xs text-gray-400">Zuletzt gespeichert: {new Date(lastUpdatedTs * 1000).toLocaleString('de-DE')}</p>}
            <div className="flex gap-3 flex-wrap">
              <button onClick={handleSaveProcedureDoc} className="inline-flex items-center px-3 py-2 rounded bg-sky-600"><FaSave className="mr-2" />Speichern</button>
              <button
                onClick={handleExportProcedurePdf}
                disabled={!!apiToken && isProcedureDirty}
                title={!!apiToken && isProcedureDirty ? 'Erst speichern, dann PDF erzeugen.' : 'PDF erzeugen'}
                className={`inline-flex items-center px-3 py-2 rounded ${!!apiToken && isProcedureDirty ? 'bg-rose-900 cursor-not-allowed opacity-60' : 'bg-rose-600'}`}
              ><FaFilePdf className="mr-2" />Als PDF herunterladen</button>
            </div>
            <div className="mt-4 bg-slate-700 rounded p-3">
              <h3 className="font-semibold mb-2">Archiv</h3>
              {procedureVersions.length === 0 ? <p className="text-sm text-gray-400">Noch keine gespeicherten Versionen vorhanden.</p> : (
                <ul className="space-y-2 text-sm">
                  {[...procedureVersions].sort((a,b) => b.version - a.version).map(version => (
                    <li key={version.docId}>
                      <button
                        className="text-sky-300 hover:underline"
                        onClick={async () => {
                          if (!apiToken) return;
                          const resp = await apiGetProcedureDoc(apiBaseUrl, apiToken, version.docId);
                          if (resp.status !== 'success' || !resp.data?.length) return alert('Archiv-Version konnte nicht geladen werden.');
                          const entry = resp.data[0];
                          const parsed = JSON.parse(entry.value || '{}');
                          const now = new Date();
                          const doc = createProcedureDocPdf({
                            name: belegSettings.userData.nameOrCompany || 'Nicht angegeben',
                            anschrift: belegSettings.userData.addressLine1 || 'Nicht angegeben',
                            plzOrt: belegSettings.userData.addressLine2 || 'Nicht angegeben',
                            ustId: belegSettings.userData.vatId || 'Nicht angegeben',
                            kleinunternehmerSatz: belegSettings.userData.isKleinunternehmer ? 'Das Unternehmen macht von der Kleinunternehmerregelung nach § 19 UStG Gebrauch.' : 'Das Unternehmen ist regelbesteuert.',
                            datumHeute: now.toLocaleDateString('de-DE'),
                            uhrzeitHeute: now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
                            wertText: ((parsed.useAutoText ? procedureAutoText : parsed.customText) || '').trim() || 'Nicht angegeben.',
                            lagerort: (parsed.storageLocation || 'Nicht angegeben').trim(),
                            software: ((parsed.accountingTool === 'Sonstiges (Freitext)' ? parsed.otherAccountingTool : parsed.accountingTool) || 'Keine zusätzliche Software').trim(),
                            backup: (parsed.backupStrategy || 'Nicht angegeben').trim(),
                            createdAtText: parsed.createdAt ? new Date(parsed.createdAt * 1000).toLocaleString('de-DE') : new Date(entry.timestamp * 1000).toLocaleString('de-DE'),
                            lastUpdatedText: new Date(entry.timestamp * 1000).toLocaleString('de-DE'),
                            versionLabel: `v${version.version}`,
                            changeHistory: Array.isArray(parsed.versionHistory) ? parsed.versionHistory : procedureVersions,
                            includeGeneratedAt: false,
                          });
                          doc.save(`GoBD_Verfahrensdokumentation_v${version.version}.pdf`);
                        }}
                      >
                        Version v{version.version} – {new Date(version.timestamp * 1000).toLocaleString('de-DE')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
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
