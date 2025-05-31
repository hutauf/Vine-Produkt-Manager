
import React, { useMemo } from 'react';
import { Product } from '../../types';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { FaChartLine } from 'react-icons/fa';
import { parseDMYtoDate } from '../../utils/dateUtils';

interface ProductPlotsProps {
  products: Product[];
  yearFilter: string; // Added yearFilter prop
}

const ProductPlots: React.FC<ProductPlotsProps> = ({ products, yearFilter }) => {

  const plotData = useMemo(() => {
    if (products.length === 0) {
      // This case will be primarily handled by the outer check,
      // but as a fallback for plotData generation:
      const monthLabel = yearFilter === 'all' 
        ? 'Start' 
        : new Date(parseInt(yearFilter, 10) || new Date().getFullYear(), 0, 1).toLocaleDateString('de-DE', { month: 'short' });
      return [{ month: monthLabel, cumulativeEtv: 0, cumulativeTeilwert: 0 }];
    }

    const sortedProductsForPlot = [...products].sort((a, b) => (parseDMYtoDate(a.date)?.getTime() ?? 0) - (parseDMYtoDate(b.date)?.getTime() ?? 0));
    
    // Aggregate ETV/Teilwert per month key (YYYY-MM)
    const monthlyAggregates: { [monthKey: string]: { etv: number, teilwert: number, dateObj: Date } } = {};
    sortedProductsForPlot.forEach(p => {
      const orderDate = parseDMYtoDate(p.date);
      if (!orderDate) return;

      const year = orderDate.getFullYear();
      const month = orderDate.getMonth(); // 0-indexed
      const monthKey = `${year}-${String(month).padStart(2, '0')}`; // e.g., "2023-00" for Jan 2023

      if (!monthlyAggregates[monthKey]) {
        monthlyAggregates[monthKey] = { etv: 0, teilwert: 0, dateObj: new Date(year, month, 1) };
      }
      monthlyAggregates[monthKey].etv += p.etv;
      monthlyAggregates[monthKey].teilwert += (p.myTeilwert ?? p.teilwert ?? 0); // <--- MODIFIED HERE
    });

    const dataForChart: { month: string, cumulativeEtv: number, cumulativeTeilwert: number }[] = [];
    let cumulativeEtv = 0;
    let cumulativeTeilwert = 0;

    if (yearFilter === 'all') {
      const sortedMonthKeys = Object.keys(monthlyAggregates).sort((a,b) => monthlyAggregates[a].dateObj.getTime() - monthlyAggregates[b].dateObj.getTime());
      for (const monthKey of sortedMonthKeys) {
        const aggregate = monthlyAggregates[monthKey];
        cumulativeEtv += aggregate.etv;
        cumulativeTeilwert += aggregate.teilwert;
        
        const displayMonth = aggregate.dateObj.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
        dataForChart.push({
            month: displayMonth,
            cumulativeEtv,
            cumulativeTeilwert,
        });
      }
    } else { // Specific year is selected (yearFilter is e.g. "2024")
      const targetYear = parseInt(yearFilter, 10);
      if (isNaN(targetYear)) { // Should not happen if yearFilter is validated, but defensive
         return [{ month: 'Ungültiges Jahr', cumulativeEtv: 0, cumulativeTeilwert: 0 }];
      }
      
      const currentActualYear = new Date().getFullYear();
      const currentMonthInCurrentYear = new Date().getMonth(); // 0-indexed
      
      // Iterate through months of the targetYear
      // For past years & future years: show all 12 months.
      // For current year: show up to current month.
      const endMonthIteration = (targetYear === currentActualYear) ? currentMonthInCurrentYear : 11;

      for (let m = 0; m <= endMonthIteration; m++) {
        const monthDate = new Date(targetYear, m, 1);
        const monthKeyForLookup = `${targetYear}-${String(m).padStart(2, '0')}`;
        
        const aggregate = monthlyAggregates[monthKeyForLookup];
        cumulativeEtv += (aggregate?.etv || 0);
        cumulativeTeilwert += (aggregate?.teilwert || 0);
        
        const displayMonth = monthDate.toLocaleDateString('de-DE', { month: 'short' });
        dataForChart.push({
            month: displayMonth,
            cumulativeEtv,
            cumulativeTeilwert,
        });
      }
    }
    
    if (dataForChart.length === 0) {
      // If, after processing, no data points were generated (e.g., specific year with no products from filtered list)
      const monthLabel = yearFilter === 'all' 
        ? 'Start' 
        : new Date(parseInt(yearFilter, 10) || new Date().getFullYear(), 0, 1).toLocaleDateString('de-DE', { month: 'short' });
      return [{ month: monthLabel, cumulativeEtv: 0, cumulativeTeilwert: 0 }];
    }

    return dataForChart;
  }, [products, yearFilter]);

  if (products.length === 0) {
    const messageContext = yearFilter === 'all' ? 'die aktuellen Filter' : `das Jahr ${yearFilter}`;
    const titleContext = yearFilter === 'all' ? 'Gesamtübersicht' : `Jahresübersicht ${yearFilter}`;
    return (
      <div className="p-6 bg-slate-800 rounded-lg shadow-md border border-slate-700 text-center">
        <FaChartLine size={32} className="mx-auto text-gray-500 mb-2" />
        <h3 className="text-lg font-semibold text-gray-100 mb-2">{titleContext}</h3>
        <p className="text-gray-400">Keine Produktdaten für Diagramme für {messageContext} verfügbar.</p>
      </div>
    );
  }
  
  const formatCurrencyTooltip = (value: number) => `${value.toFixed(2)} €`;
  const chartTitle = yearFilter === 'all' ? 'Gesamtübersicht (Kumulativ)' : `Jahresübersicht ${yearFilter} (Kumulativ)`;

  return (
    <div className="p-4 sm:p-6 bg-slate-800 rounded-lg shadow-xl border border-slate-700">
      <h3 className="text-xl font-semibold text-gray-100 mb-6 flex items-center">
        <FaChartLine className="mr-3 text-sky-400"/> {chartTitle}
      </h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <h4 className="text-md font-medium text-gray-300 mb-3 text-center">Kumulativer ETV</h4>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={plotData}>
              <defs>
                <linearGradient id="colorEtvPlot" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.1}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} stroke="#475569"/>
              <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 12 }} interval="preserveStartEnd" />
              <YAxis tickFormatter={formatCurrencyTooltip} tick={{ fill: '#9ca3af', fontSize: 12 }} domain={['auto', 'auto']}/>
              <Tooltip
                formatter={formatCurrencyTooltip}
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '0.5rem' }}
                labelStyle={{ color: '#cbd5e1' }}
                itemStyle={{ color: '#e2e8f0' }}
              />
              <Legend wrapperStyle={{ color: '#cbd5e1', fontSize: 14 }}/>
              <Area type="monotone" dataKey="cumulativeEtv" name="Kum. ETV" stroke="#38bdf8" fillOpacity={1} fill="url(#colorEtvPlot)" activeDot={{ r: 6 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div>
          <h4 className="text-md font-medium text-gray-300 mb-3 text-center">Kumulativer Teilwert</h4>
           <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={plotData}>
               <defs>
                <linearGradient id="colorTeilwertPlot" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#84cc16" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="#84cc16" stopOpacity={0.1}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} stroke="#475569" />
              <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 12 }} interval="preserveStartEnd" />
              <YAxis tickFormatter={formatCurrencyTooltip} tick={{ fill: '#9ca3af', fontSize: 12 }} domain={['auto', 'auto']}/>
              <Tooltip
                formatter={formatCurrencyTooltip}
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '0.5rem' }}
                labelStyle={{ color: '#cbd5e1' }}
                itemStyle={{ color: '#e2e8f0' }}
              />
              <Legend wrapperStyle={{ color: '#cbd5e1', fontSize: 14 }}/>
              <Area type="monotone" dataKey="cumulativeTeilwert" name="Kum. Teilwert" stroke="#84cc16" fillOpacity={1} fill="url(#colorTeilwertPlot)" activeDot={{ r: 6 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default ProductPlots;