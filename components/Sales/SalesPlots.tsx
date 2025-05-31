
import React, { useMemo } from 'react';
import { Product } from '../../types';
import { ComposedChart, ScatterChart, Scatter, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Label, ReferenceLine } from 'recharts';
import { FaChartBar, FaChartLine, FaDollarSign, FaInfoCircle } from 'react-icons/fa';
import { parseGermanDate } from '../../utils/dateUtils';

interface SalesPlotsProps {
  soldProducts: Product[]; // Already filtered for "verkauft" status
  selectedYear: string; // "all" or a specific year string like "2023"
}

interface MonthlySalesData {
  month: string; // "Jan", "Feb", ... or "2023", "2024", ...
  yearMonthKey: string; // "YYYY-MM" for sorting monthly, or "YYYY" for yearly
  salesCount: number;
  totalRevenue: number;
}

interface ProfitabilityDataPoint {
  asin: string;
  name: string;
  etv: number;
  salePrice: number;
  ratio?: number; // salePrice / etv
}

const SalesPlots: React.FC<SalesPlotsProps> = ({ soldProducts, selectedYear }) => {

  const chartData = useMemo(() => {
    const monthlySales: { [key: string]: { salesCount: number, totalRevenue: number } } = {};
    const yearlySales: { [key: string]: { salesCount: number, totalRevenue: number } } = {};
    const profitabilityPoints: ProfitabilityDataPoint[] = [];

    let totalSalePriceForAverage = 0;
    let totalEtvForAverage = 0;

    soldProducts.forEach(p => {
      if (!p.saleDate || p.salePrice == null) return;
      const saleDateObj = parseGermanDate(p.saleDate);
      if (!saleDateObj) return;

      const year = saleDateObj.getFullYear().toString();
      const month = saleDateObj.getMonth(); // 0-indexed

      // Aggregate for selected year or all years for profitability plot
      if (selectedYear === 'all' || year === selectedYear) {
        profitabilityPoints.push({
          asin: p.ASIN,
          name: p.name,
          etv: p.etv,
          salePrice: p.salePrice,
          ratio: p.etv !== 0 ? p.salePrice / p.etv : undefined,
        });
        if (p.etv > 0) { // Only include in average calculation if ETV > 0 to avoid skewed ratios
           totalSalePriceForAverage += p.salePrice;
           totalEtvForAverage += p.etv;
        }
      }

      // Aggregations for Sales Performance Chart
      if (selectedYear === 'all') {
        // Yearly aggregation
        if (!yearlySales[year]) yearlySales[year] = { salesCount: 0, totalRevenue: 0 };
        yearlySales[year].salesCount++;
        yearlySales[year].totalRevenue += p.salePrice;
      } else if (year === selectedYear) {
        // Monthly aggregation for the selected year
        const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`; // YYYY-MM
        if (!monthlySales[monthKey]) monthlySales[monthKey] = { salesCount: 0, totalRevenue: 0 };
        monthlySales[monthKey].salesCount++;
        monthlySales[monthKey].totalRevenue += p.salePrice;
      }
    });

    let salesPerformanceData: MonthlySalesData[] = [];
    if (selectedYear === 'all') {
      salesPerformanceData = Object.keys(yearlySales)
        .map(year => ({
          month: year, // Display year as "month" on X-axis
          yearMonthKey: year, // For sorting
          salesCount: yearlySales[year].salesCount,
          totalRevenue: yearlySales[year].totalRevenue,
        }))
        .sort((a, b) => a.yearMonthKey.localeCompare(b.yearMonthKey));
    } else {
      salesPerformanceData = Object.keys(monthlySales)
        .map(monthKey => {
          const dateParts = monthKey.split('-');
          const monthDate = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, 1);
          return {
            month: monthDate.toLocaleDateString('de-DE', { month: 'short' }), // "Jan", "Feb"
            yearMonthKey: monthKey, // "YYYY-MM" for sorting
            salesCount: monthlySales[monthKey].salesCount,
            totalRevenue: monthlySales[monthKey].totalRevenue,
          };
        })
        .sort((a, b) => a.yearMonthKey.localeCompare(b.yearMonthKey));
    }
    
    // Ensure at least one data point for charts to render, even if empty
    if (salesPerformanceData.length === 0) {
        const label = selectedYear === 'all' ? new Date().getFullYear().toString() : new Date(parseInt(selectedYear), 0, 1).toLocaleDateString('de-DE', {month: 'short'});
        salesPerformanceData.push({ month: label, yearMonthKey: selectedYear === 'all' ? label : `${selectedYear}-01`, salesCount: 0, totalRevenue: 0 });
    }
    if (profitabilityPoints.length === 0) {
        profitabilityPoints.push({ asin: "N/A", name: "N/A", etv: 0, salePrice: 0 });
    }
    
    const averageRatio = totalEtvForAverage > 0 ? totalSalePriceForAverage / totalEtvForAverage : 1;


    return { salesPerformanceData, profitabilityPoints, averageRatio };
  }, [soldProducts, selectedYear]);

  if (soldProducts.length === 0) {
    return (
      <div className="p-6 bg-slate-700 rounded-lg shadow-md text-center">
        <FaInfoCircle size={32} className="mx-auto text-gray-400 mb-3" />
        <h4 className="text-lg font-semibold text-gray-100 mb-2">Keine Verkaufsdaten</h4>
        <p className="text-gray-300">Für den ausgewählten Zeitraum ({selectedYear === 'all' ? 'Alle Jahre' : selectedYear}) gibt es keine Verkaufsdaten für Diagramme.</p>
      </div>
    );
  }

  const formatCurrency = (value: number) => `${value.toFixed(2)} €`;
  const formatNumber = (value: number) => value.toString();
  
  const tickEuroFormatter = (value: number) => `${value.toLocaleString('de-DE')}€`;


  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Sales Performance Chart */}
      <div className="p-4 bg-slate-750 rounded-md shadow-inner">
        <h4 className="text-md font-medium text-gray-200 mb-4 flex items-center">
          <FaChartBar className="mr-2 text-sky-400" /> Verkaufsleistung ({selectedYear === 'all' ? 'Jährlich' : 'Monatlich'})
        </h4>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData.salesPerformanceData}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} stroke="#4b5563" />
            <XAxis dataKey="month" tick={{ fill: '#d1d5db', fontSize: 12 }} />
            <YAxis yAxisId="left" orientation="left" stroke="#818cf8" tickFormatter={formatNumber} tick={{ fill: '#d1d5db', fontSize: 12 }}>
                 <Label value="Anzahl Verkäufe" angle={-90} position="insideLeft" style={{ textAnchor: 'middle', fill: '#d1d5db', fontSize: 12 }} offset={-5}/>
            </YAxis>
            <YAxis yAxisId="right" orientation="right" stroke="#f59e0b" tickFormatter={tickEuroFormatter} tick={{ fill: '#d1d5db', fontSize: 12 }} >
                <Label value="Umsatz" angle={90} position="insideRight" style={{ textAnchor: 'middle', fill: '#d1d5db', fontSize: 12 }} offset={15}/>
            </YAxis>
            <Tooltip
              formatter={(value, name) => (name === "Umsatz" ? formatCurrency(value as number) : value)}
              contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.375rem', color: '#e5e7eb' }}
              labelStyle={{ color: '#9ca3af' }}
            />
            <Legend wrapperStyle={{ color: '#d1d5db', fontSize: 14, paddingTop: '10px' }} />
            <Bar yAxisId="left" dataKey="salesCount" name="Anzahl" fill="#818cf8" barSize={20} />
            <Line yAxisId="right" type="monotone" dataKey="totalRevenue" name="Umsatz" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Profitability Chart */}
      <div className="p-4 bg-slate-750 rounded-md shadow-inner">
        <h4 className="text-md font-medium text-gray-200 mb-4 flex items-center">
          <FaDollarSign className="mr-2 text-green-400" /> Profitabilitätsanalyse ({selectedYear === 'all' ? 'Alle Jahre' : selectedYear})
        </h4>
        <ResponsiveContainer width="100%" height={300}>
          <ScatterChart margin={{ top: 5, right: 20, bottom: 20, left: 25 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} stroke="#4b5563" />
            <XAxis type="number" dataKey="etv" name="ETV" tickFormatter={tickEuroFormatter} tick={{ fill: '#d1d5db', fontSize: 12 }}>
              <Label value="Estimated Tax Value (ETV)" position="insideBottom" offset={-15} style={{ fill: '#d1d5db', fontSize: 12 }} />
            </XAxis>
            <YAxis type="number" dataKey="salePrice" name="Verkaufspreis" tickFormatter={tickEuroFormatter} tick={{ fill: '#d1d5db', fontSize: 12 }}>
              <Label value="Verkaufspreis" angle={-90} position="insideLeft" style={{ textAnchor: 'middle', fill: '#d1d5db', fontSize: 12 }} offset={-15}/>
            </YAxis>
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.375rem', color: '#e5e7eb' }}
              labelStyle={{ color: '#9ca3af' }}
              formatter={(value, name, props) => {
                if (name === 'Verhältnis (VK/ETV)') return props.payload.ratio ? props.payload.ratio.toFixed(2) : 'N/A (ETV=0)';
                return typeof value === 'number' ? formatCurrency(value) : value;
              }}
            />
            <Legend 
                verticalAlign="top" 
                height={36} 
                wrapperStyle={{ color: '#d1d5db', fontSize: 12, paddingBottom: '10px' }}
                payload={[
                    { value: 'Verkaufte Produkte', type: 'scatter', id: 'ID01', color: '#60a5fa' },
                    { value: `Ø VK/ETV: ${chartData.averageRatio > 0 ? chartData.averageRatio.toFixed(2) : 'N/A (Kein ETV > 0)'}`, type: 'line', id: 'ID02', color: '#fbbf24' }
                ]}
            />
            <Scatter name="Verkaufte Produkte" data={chartData.profitabilityPoints} fill="#60a5fa" shape="circle" />
             <ReferenceLine 
                stroke="#fbbf24" 
                strokeDasharray="5 5"
                ifOverflow="extendDomain"
                label={{ 
                    value: `Ø VK/ETV-Verhältnis: ${chartData.averageRatio > 0 ? chartData.averageRatio.toFixed(2) : 'N/A'}`, 
                    position: 'insideTopRight', 
                    fill: '#fbbf24', 
                    fontSize: 10,
                    dy: -5, // Adjust vertical position of the label
                    dx: -5  // Adjust horizontal position of the label
                }}
                segment={[{ x: 0, y: 0 }, { x: Math.max(...chartData.profitabilityPoints.map(p=>p.etv), 10), y: Math.max(...chartData.profitabilityPoints.map(p=>p.etv), 10) * chartData.averageRatio }]}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default SalesPlots;
