import React, { useMemo } from 'react';
import { Product, ProductUsage } from '../../types';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { parseDMYtoDate } from '../../utils/dateUtils';
import { FaChartPie } from 'react-icons/fa';

interface UsagePieChartsProps {
  products: Product[];
  selectedYear: string; // 'all' or specific year
}

const CATEGORY_ORDER: ProductUsage[] = [
  ProductUsage.STORNIERT,
  ProductUsage.VERKAUFT,
  ProductUsage.ENTSORGT,
  ProductUsage.PRIVATENTNAHME,
  ProductUsage.LAGER,
  ProductUsage.BETRIEBLICHE_NUTZUNG,
];

const CATEGORY_COLORS: Record<ProductUsage, string> = {
  [ProductUsage.STORNIERT]: '#ef4444',
  [ProductUsage.VERKAUFT]: '#22c55e',
  [ProductUsage.ENTSORGT]: '#f97316',
  [ProductUsage.PRIVATENTNAHME]: '#a855f7',
  [ProductUsage.LAGER]: '#3b82f6',
  [ProductUsage.BETRIEBLICHE_NUTZUNG]: '#f59e0b',
  [ProductUsage.DEFEKT]: '#6b7280',
};

const CATEGORY_LABELS: Record<ProductUsage, string> = {
  [ProductUsage.STORNIERT]: 'Storniert',
  [ProductUsage.VERKAUFT]: 'Verkauft',
  [ProductUsage.ENTSORGT]: 'Entsorgt',
  [ProductUsage.PRIVATENTNAHME]: 'Privatentnahme',
  [ProductUsage.LAGER]: 'Lager',
  [ProductUsage.BETRIEBLICHE_NUTZUNG]: 'Betriebliche Nutzung',
  [ProductUsage.DEFEKT]: 'Defekt',
};

const UsagePieCharts: React.FC<UsagePieChartsProps> = ({ products, selectedYear }) => {
  const pieData = useMemo(() => {
    const filtered = selectedYear === 'all'
      ? products
      : products.filter(p => {
          const orderDate = parseDMYtoDate(p.date);
          return orderDate && orderDate.getFullYear().toString() === selectedYear;
        });

    const sums: Record<ProductUsage, { etv: number; teilwert: number; count: number }> = {
      [ProductUsage.STORNIERT]: { etv: 0, teilwert: 0, count: 0 },
      [ProductUsage.VERKAUFT]: { etv: 0, teilwert: 0, count: 0 },
      [ProductUsage.ENTSORGT]: { etv: 0, teilwert: 0, count: 0 },
      [ProductUsage.PRIVATENTNAHME]: { etv: 0, teilwert: 0, count: 0 },
      [ProductUsage.LAGER]: { etv: 0, teilwert: 0, count: 0 },
      [ProductUsage.BETRIEBLICHE_NUTZUNG]: { etv: 0, teilwert: 0, count: 0 },
      [ProductUsage.DEFEKT]: { etv: 0, teilwert: 0, count: 0 },
    };

    const getTeilwert = (p: Product) =>
      p.myTeilwert != null ? p.myTeilwert : p.teilwert != null ? p.teilwert : p.etv;

    filtered.forEach(p => {
      let category: ProductUsage = ProductUsage.PRIVATENTNAHME;
      if (p.usageStatus.includes(ProductUsage.STORNIERT)) category = ProductUsage.STORNIERT;
      else if (p.usageStatus.includes(ProductUsage.VERKAUFT)) category = ProductUsage.VERKAUFT;
      else if (p.usageStatus.includes(ProductUsage.ENTSORGT)) category = ProductUsage.ENTSORGT;
      else if (p.usageStatus.includes(ProductUsage.LAGER)) category = ProductUsage.LAGER;
      else if (p.usageStatus.includes(ProductUsage.BETRIEBLICHE_NUTZUNG)) category = ProductUsage.BETRIEBLICHE_NUTZUNG;
      else if (p.usageStatus.includes(ProductUsage.PRIVATENTNAHME)) category = ProductUsage.PRIVATENTNAHME;

      sums[category].etv += p.etv;
      sums[category].teilwert += getTeilwert(p);
      sums[category].count += 1;
    });

    const etvData = CATEGORY_ORDER.map(cat => ({ name: CATEGORY_LABELS[cat], value: sums[cat].etv, color: CATEGORY_COLORS[cat] }));
    const teilwertData = CATEGORY_ORDER.map(cat => ({ name: CATEGORY_LABELS[cat], value: sums[cat].teilwert, color: CATEGORY_COLORS[cat] }));
    const countData = CATEGORY_ORDER.map(cat => ({ name: CATEGORY_LABELS[cat], value: sums[cat].count, color: CATEGORY_COLORS[cat] }));

    return { etvData, teilwertData, countData };
  }, [products, selectedYear]);

  const renderPie = (data: { name: string; value: number; color: string }[], title: string, formatter?: (v: number) => string) => (
    <div>
      <h4 className="text-md font-medium text-gray-300 mb-3 text-center">{title}</h4>
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" outerRadius={80}>
            {data.map((entry, idx) => <Cell key={`cell-${idx}`} fill={entry.color} />)}
          </Pie>
          <Tooltip formatter={(v: number) => (formatter ? formatter(v) : v)}
                   contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.375rem', color: '#e5e7eb' }}
                   labelStyle={{ color: '#9ca3af' }}
          />
          <Legend wrapperStyle={{ color: '#d1d5db', fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );

  if (pieData.etvData.every(d => d.value === 0) && pieData.countData.every(d => d.value === 0)) {
    return (
      <div className="p-4 bg-slate-750 rounded-md shadow-inner text-center">
        <FaChartPie size={32} className="mx-auto text-gray-400 mb-3" />
        <p className="text-gray-300">Keine Produktdaten für diese Auswahl.</p>
      </div>
    );
  }

  const formatCurrency = (v: number) => `${v.toFixed(2)} €`;

  return (
    <div className="p-4 bg-slate-750 rounded-md shadow-inner">
      <h4 className="text-md font-medium text-gray-200 mb-4 flex items-center">
        <FaChartPie className="mr-2 text-sky-400" /> Bestandsverteilung ({selectedYear === 'all' ? 'Alle Jahre' : selectedYear})
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {renderPie(pieData.etvData, 'ETV', formatCurrency)}
        {renderPie(pieData.teilwertData, 'Teilwert', formatCurrency)}
        {renderPie(pieData.countData, 'Anzahl')}
      </div>
    </div>
  );
};

export default UsagePieCharts;
