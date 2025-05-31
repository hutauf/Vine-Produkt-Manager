
import React from 'react';
import { TAB_OPTIONS } from '../../constants';
import { FaFileExport, FaFileExcel, FaCog, FaSyncAlt, FaReceipt, FaThLarge, FaCalculator, FaArchive, FaDollarSign } from 'react-icons/fa'; 

interface NavbarProps {
  activeTab: string;
  onSelectTab: (tab: string) => void;
  onExportJson: () => void;
  onExportXlsx: () => void;
  onFullSync: () => void; 
}

const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  onExportJson,
  onExportXlsx,
  onFullSync 
}) => {
  const navTabs = [
    { key: TAB_OPTIONS.DASHBOARD, label: TAB_OPTIONS.DASHBOARD, icon: <FaThLarge className="mr-1.5 h-4 w-4" /> },
    { key: TAB_OPTIONS.EUER, label: TAB_OPTIONS.EUER, icon: <FaCalculator className="mr-1.5 h-4 w-4" /> },
    { key: TAB_OPTIONS.VERMOEGEN, label: TAB_OPTIONS.VERMOEGEN, icon: <FaArchive className="mr-1.5 h-4 w-4" /> }, // Changed from LAGER
    { key: TAB_OPTIONS.VERKAUFE, label: TAB_OPTIONS.VERKAUFE, icon: <FaDollarSign className="mr-1.5 h-4 w-4" /> },
    { key: TAB_OPTIONS.BELEGE, label: TAB_OPTIONS.BELEGE, icon: <FaReceipt className="mr-1.5 h-4 w-4" /> },
    { key: TAB_OPTIONS.SETTINGS, label: TAB_OPTIONS.SETTINGS, icon: <FaCog className="mr-1.5 h-4 w-4" /> },
  ];

  return (
    <nav className="bg-slate-800 shadow-lg">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center">
            <span className="font-semibold text-xl text-white tracking-tight">Vine Produkt Manager</span>
            <div className="hidden md:block ml-10">
              <div className="flex items-baseline space-x-1">
                {navTabs.map((tabItem) => (
                  <button
                    key={tabItem.key}
                    onClick={() => onSelectTab(tabItem.key)}
                    className={`px-3 py-2 rounded-md text-sm font-medium transition-colors duration-150 flex items-center
                      ${activeTab === tabItem.key
                        ? 'bg-sky-600 text-white'
                        : 'text-gray-300 hover:bg-slate-700 hover:text-white'
                      }`}
                    aria-current={activeTab === tabItem.key ? 'page' : undefined}
                  >
                    {tabItem.icon}
                    {tabItem.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center">
             <button
                onClick={onFullSync} 
                title="Vollständige Synchronisation mit Server"
                aria-label="Vollständige Synchronisation mit Server"
                className="p-2 rounded-md text-gray-300 hover:bg-slate-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-white mr-2"
              >
                <FaSyncAlt size={18} /> 
              </button>
             <button
                onClick={onExportJson}
                title="Daten als JSON exportieren"
                aria-label="Daten als JSON exportieren"
                className="p-2 rounded-md text-gray-300 hover:bg-slate-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-white mr-2"
              >
                <FaFileExport size={20} />
              </button>
              <button
                onClick={onExportXlsx}
                title="Daten als XLSX exportieren"
                aria-label="Daten als XLSX exportieren"
                className="p-2 rounded-md text-gray-300 hover:bg-slate-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-white mr-3"
              >
                <FaFileExcel size={20} />
              </button>
          </div>
        </div>
        <div className="md:hidden py-2">
            <div className="flex flex-wrap items-baseline space-x-1">
                {navTabs.map((tabItem) => (
                  <button
                    key={tabItem.key + "-mobile"}
                    onClick={() => onSelectTab(tabItem.key)}
                    className={`px-2 py-2 my-0.5 rounded-md text-xs font-medium transition-colors duration-150 flex items-center
                      ${activeTab === tabItem.key
                        ? 'bg-sky-600 text-white'
                        : 'text-gray-300 hover:bg-slate-700 hover:text-white'
                      }`}
                    aria-current={activeTab === tabItem.key ? 'page' : undefined}
                  >
                    {tabItem.icon}
                    {tabItem.label}
                  </button>
                ))}
            </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
