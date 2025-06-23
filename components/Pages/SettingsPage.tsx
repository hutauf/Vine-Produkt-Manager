
import React, { useState, useEffect } from 'react';
import Button from '../Common/Button';
import Modal from '../Common/Modal';
import { FaSave, FaTrashAlt, FaCalendarAlt, FaExclamationTriangle, FaGlobe, FaDatabase } from 'react-icons/fa';
import { FaKey, FaServer, FaBroom, FaWandMagicSparkles } from 'react-icons/fa6';
import { EuerSettings } from '../../types'; // Import EuerSettings
import { convertISOToGerman, convertGermanToISO, getTodayGermanFormat } from '../../utils/dateUtils'; // For date input
import { DEFAULT_API_BASE_URL } from '../../constants';


interface SettingsPageProps {
  apiToken: string | null;
  onApiTokenChange: (token: string) => void;
  apiBaseUrl: string;
  onApiBaseUrlChange: (url: string) => void;
  euerSettings: EuerSettings; 
  onEuerSettingsChange: (settings: EuerSettings) => void; 
  onDeleteAllServerData: () => Promise<void>;
  onClearLocalDataAndToken: () => void;
  onBulkFestschreiben: (dateYYYYMMDD: string) => Promise<void>; 
}

const DEMO_TOKEN = 'f08h2h8923fh48923h4f8923hf89r23f';

const SettingsPage: React.FC<SettingsPageProps> = ({
  apiToken,
  onApiTokenChange,
  apiBaseUrl,
  onApiBaseUrlChange,
  euerSettings,
  onEuerSettingsChange,
  onDeleteAllServerData,
  onClearLocalDataAndToken,
  onBulkFestschreiben,
}) => {
  const [currentTokenValue, setCurrentTokenValue] = useState(apiToken || '');
  const [currentApiBaseUrlValue, setCurrentApiBaseUrlValue] = useState(apiBaseUrl);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [showClearLocalConfirmModal, setShowClearLocalConfirmModal] = useState(false);
  const [isDeletingServerData, setIsDeletingServerData] = useState(false);
  const [isClearingLocalData, setIsClearingLocalData] = useState(false);

  const [bulkFestschreibenDate, setBulkFestschreibenDate] = useState<string>(convertGermanToISO(getTodayGermanFormat())); 
  const [showBulkFestschreibenConfirmModal, setShowBulkFestschreibenConfirmModal] = useState(false);
  const [isBulkFestschreibenLoading, setIsBulkFestschreibenLoading] = useState(false);


  useEffect(() => {
    setCurrentTokenValue(apiToken || '');
  }, [apiToken]);

  useEffect(() => {
    setCurrentApiBaseUrlValue(apiBaseUrl);
  }, [apiBaseUrl]);

  const handleApiTokenSave = () => {
    onApiTokenChange(currentTokenValue.trim());
  };

  const handleApiBaseUrlSave = () => {
    onApiBaseUrlChange(currentApiBaseUrlValue.trim());
  };

  const handleApiBaseUrlReset = () => {
    setCurrentApiBaseUrlValue(DEFAULT_API_BASE_URL);
    onApiBaseUrlChange(DEFAULT_API_BASE_URL);
  };

  const handleUseDemoToken = () => {
    setCurrentTokenValue(DEMO_TOKEN);
    onApiTokenChange(DEMO_TOKEN);
  };

  const handleDeleteDataConfirmed = async () => {
    setIsDeletingServerData(true);
    await onDeleteAllServerData();
    setIsDeletingServerData(false);
    setShowDeleteConfirmModal(false);
  };

  const handleClearLocalDataConfirmed = () => {
    setIsClearingLocalData(true);
    onClearLocalDataAndToken();
    setIsClearingLocalData(false);
    setShowClearLocalConfirmModal(false);
  };

  const handleEuerSettingChange = <K extends keyof EuerSettings>(key: K, value: EuerSettings[K]) => {
    if (key === 'useTeilwertV2') {
      console.log('SettingsPage: useTeilwertV2 toggled to', value);
    }
    onEuerSettingsChange({ ...euerSettings, [key]: value });
  };
  
  const handleBulkFestschreibenAttempt = () => {
    if (!bulkFestschreibenDate) {
        alert("Bitte wählen Sie ein Datum für die Massen-Festschreibung.");
        return;
    }
    setShowBulkFestschreibenConfirmModal(true);
  };

  const handleBulkFestschreibenConfirmed = async () => {
    setIsBulkFestschreibenLoading(true);
    await onBulkFestschreiben(bulkFestschreibenDate); 
    setIsBulkFestschreibenLoading(false);
    setShowBulkFestschreibenConfirmModal(false);
  };


  return (
    <div className="p-6 bg-slate-800 rounded-lg shadow-xl border border-slate-700 max-w-2xl mx-auto space-y-10">
      {/* API Synchronisation Section */}
      <div>
        <h2 className="text-2xl font-semibold text-gray-100 mb-6 flex items-center">
          <FaServer className="mr-3 text-sky-400" /> API Synchronisation (Primäre Produktdatenbank)
        </h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="apiTokenInput" className="block text-sm font-medium text-gray-300">
              API Token (für beide Datenbanken)
            </label>
            <input
              id="apiTokenInput"
              type="password"
              value={currentTokenValue}
              onChange={(e) => setCurrentTokenValue(e.target.value)}
              placeholder="Deinen API Token hier eingeben"
              className="mt-1 block w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm text-gray-100 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm"
              aria-label="API Token Eingabefeld"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleApiTokenSave} leftIcon={<FaSave />} aria-label="API Token Speichern">
              Token speichern
            </Button>
            {!apiToken && (
              <Button 
                onClick={handleUseDemoToken} 
                leftIcon={<FaWandMagicSparkles />} 
                variant="secondary"
                aria-label="Demo Token verwenden und Produkte laden"
              >
                Demo Token verwenden
              </Button>
            )}
          </div>
           {!apiToken && (
             <p className="text-xs text-gray-400 mt-2">
                Der Demo-Token lädt einen Beispieldatensatz. Änderungen mit dem Demo-Token werden nicht dauerhaft gespeichert. Der gleiche Token wird für beide Datenbankabfragen verwendet.
              </p>
           )}
        </div>
      </div>

      {/* Allgemeine Produkteinstellungen Section */}
      <div className="pt-6 border-t border-slate-700">
         <h2 className="text-2xl font-semibold text-gray-100 mb-6 flex items-center">
            <FaDatabase className="mr-3 text-sky-400" /> Datenquellen & Produktfilter
        </h2>
        <div className="space-y-6">
            {/* Teilwert V2 Source */}
            <div>
                <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={euerSettings.useTeilwertV2}
                        onChange={(e) => handleEuerSettingChange('useTeilwertV2', e.target.checked)}
                        className="form-checkbox h-4 w-4 text-sky-600 bg-slate-600 border-slate-500 rounded focus:ring-sky-500"
                    />
                    <span>Teilwert v2 (aus "v2processstatus" Datenbank) verwenden</span>
                </label>
                <p className="text-xs text-gray-500 mt-1 pl-6">
                    Wenn aktiv, wird der Teilwert und der zugehörige PDF-Link aus der neueren v2 Datenbank geladen.
                    Falls für ein Produkt keine v2 Daten gefunden werden, wird der Teilwert auf 'null' gesetzt.
                    Sonst wird der ursprüngliche Teilwert aus der Haupt-Produktdatenbank verwendet.
                </p>
            </div>

            {/* StreuArtikelRegelung */}
            <div>
                <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={euerSettings.streuArtikelLimitActive}
                        onChange={(e) => handleEuerSettingChange('streuArtikelLimitActive', e.target.checked)}
                        className="form-checkbox h-4 w-4 text-sky-600 bg-slate-600 border-slate-500 rounded focus:ring-sky-500"
                    />
                    <span>Streuartikelregelung anwenden</span>
                </label>
                {euerSettings.streuArtikelLimitActive && (
                    <div className="mt-2 pl-6">
                        <label htmlFor="streuArtikelLimitValueSettings" className="block text-xs font-medium text-gray-400">
                            Grenzwert für Streuartikel (€)
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            id="streuArtikelLimitValueSettings"
                            value={euerSettings.streuArtikelLimitValue}
                            onChange={(e) => handleEuerSettingChange('streuArtikelLimitValue', parseFloat(e.target.value) || 0)}
                            className="mt-1 block w-full max-w-xs px-3 py-1.5 bg-slate-600 border-slate-500 rounded-md shadow-sm text-gray-100 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-xs"
                        />
                         <p className="text-xs text-gray-500 mt-1">Produkte mit ETV unter diesem Wert werden in EÜR und Beleg-Erstellung ignoriert.</p>
                    </div>
                )}
            </div>
             {/* Ignore ETV=0 Produkte */}
            <div>
                <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={euerSettings.ignoreETVZeroProducts}
                        onChange={(e) => handleEuerSettingChange('ignoreETVZeroProducts', e.target.checked)}
                        className="form-checkbox h-4 w-4 text-sky-600 bg-slate-600 border-slate-500 rounded focus:ring-sky-500"
                    />
                    <span>Produkte mit ETV=0 global ignorieren/ausblenden</span>
                </label>
                <p className="text-xs text-gray-500 mt-1 pl-6">
                    Wenn aktiv, werden Produkte mit ETV=0 lokal ausgeblendet. Deaktivieren lädt ggf. vom Server nach (API Token benötigt).
                </p>
            </div>
        </div>
      </div>


      {/* Gefahrenzone Section */}
      <div className="mt-8 pt-6 border-t border-slate-700">
        <h3 className="text-lg font-semibold text-red-400 mb-3 flex items-center"><FaExclamationTriangle className="mr-2"/> Gefahrenzone</h3>
        <div className="space-y-6">
          {/* API Base URL Configuration for main product DB */}
          <div className="pt-4 border-t border-slate-600">
              <h4 className="text-md font-medium text-red-300 mb-1">Backend API URL (Primäre Produktdatenbank)</h4>
              <p className="text-sm text-gray-400 mb-2">
                  URL für die Haupt-Produktdatenbank (<code>data_operations</code>). Die URL für Teilwert v2 (<code>api/get_all</code>) ist fest codiert.
              </p>
              <input
                type="text"
                value={currentApiBaseUrlValue}
                onChange={(e) => setCurrentApiBaseUrlValue(e.target.value)}
                placeholder={DEFAULT_API_BASE_URL}
                className="block w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm text-gray-100 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm mb-2"
                aria-label="Backend API URL Eingabefeld (Primäre Produktdatenbank)"
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" onClick={handleApiBaseUrlSave} leftIcon={<FaSave />} aria-label="API URL Speichern">
                    API URL Speichern
                </Button>
                <Button variant="secondary" onClick={handleApiBaseUrlReset} aria-label="API URL auf Standard zurücksetzen">
                    Auf Standard zurücksetzen
                </Button>
              </div>
          </div>

          {/* Server Data Deletion */}
          <div className="pt-4 border-t border-slate-600">
              <p className="text-sm text-gray-300 mb-2">
                  Diese Aktion löscht alle deine Produktdaten unwiderruflich von der primären Server-Datenbank.
                  Deine lokalen EÜR-Einstellungen und Teilwert v2 Daten sind davon nicht betroffen.
              </p>
              <Button
                  variant="danger"
                  onClick={() => setShowDeleteConfirmModal(true)}
                  leftIcon={<FaTrashAlt />}
                  isLoading={isDeletingServerData}
                  disabled={!apiToken || apiToken.length === 0 || apiToken === DEMO_TOKEN}
                  title={apiToken === DEMO_TOKEN ? "Serverdatenlöschung mit Demo Token nicht möglich" : "Alle Produktdaten auf dem Server löschen (Primäre DB)"}
                  aria-label="Alle Produktdaten auf dem Server löschen (Primäre DB)"
              >
                  Primäre Produktdaten auf Server löschen
              </Button>
          </div>
          {/* Clear Local Data */}
          <div className="pt-4 border-t border-slate-600">
              <p className="text-sm text-gray-300 mb-2">
                  Diese Aktion löscht alle lokal gespeicherten Produktdaten, Ausgaben und den API Token aus deinem Browser.
                  Daten auf dem Server (falls vorhanden) bleiben unberührt. Nützlich für einen kompletten lokalen Reset.
              </p>
              <Button
                  variant="danger"
                  onClick={() => setShowClearLocalConfirmModal(true)}
                  leftIcon={<FaBroom />}
                  isLoading={isClearingLocalData}
                  aria-label="Alle lokalen Produktdaten, Ausgaben und API Token löschen"
              >
                  Lokale Daten, Ausgaben & Token löschen
              </Button>
          </div>
          {/* Bulk Festschreiben */}
           <div className="pt-4 border-t border-slate-600">
                <h4 className="text-md font-medium text-red-300 mb-1">Massen-Festschreibung für ältere Produkte</h4>
                <p className="text-sm text-gray-400 mb-2">
                    Markieren Sie alle Produkte, deren Bestelldatum älter ist als das angegebene Datum, als "festgeschrieben".
                    Es wird keine Rechnungsnummer zugewiesen und kein PDF generiert.
                    Nützlich, wenn die Steuererklärung für ältere Jahre bereits erledigt ist und für diese Produkte keine individuellen Belege mehr benötigt werden.
                </p>
                <div className="flex items-center space-x-3">
                     <input
                        type="date"
                        value={bulkFestschreibenDate}
                        onChange={(e) => setBulkFestschreibenDate(e.target.value)} 
                        className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-gray-100 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm"
                        style={{ colorScheme: 'dark' }}
                        aria-label="Datum für Massen-Festschreibung"
                    />
                    <Button
                        variant="danger"
                        onClick={handleBulkFestschreibenAttempt}
                        leftIcon={<FaCalendarAlt />}
                        isLoading={isBulkFestschreibenLoading}
                        disabled={!bulkFestschreibenDate}
                        aria-label="Massen-Festschreibung starten"
                    >
                        Ältere Produkte festschreiben
                    </Button>
                </div>
            </div>
        </div>
      </div>

      {/* Modals */}
      {showDeleteConfirmModal && (
        <Modal
          isOpen={showDeleteConfirmModal}
          onClose={() => setShowDeleteConfirmModal(false)}
          title="Server-Datenlöschung bestätigen (Primäre DB)"
          size="md"
        >
          <p className="text-gray-300 mb-6">
            Bist du sicher, dass du alle deine Produktdaten von der primären Server-Datenbank löschen möchtest? Diese Aktion kann nicht rückgängig gemacht werden.
          </p>
          <div className="flex justify-end space-x-3">
            <Button variant="secondary" onClick={() => setShowDeleteConfirmModal(false)} disabled={isDeletingServerData} aria-label="Abbrechen">
              Abbrechen
            </Button>
            <Button variant="danger" onClick={handleDeleteDataConfirmed} isLoading={isDeletingServerData} aria-label="Ja, Server-Daten löschen">
              {isDeletingServerData ? 'Wird gelöscht...' : 'Ja, Primär-DB Daten löschen'}
            </Button>
          </div>
        </Modal>
      )}

      {showClearLocalConfirmModal && (
        <Modal
          isOpen={showClearLocalConfirmModal}
          onClose={() => setShowClearLocalConfirmModal(false)}
          title="Lokale Datenlöschung bestätigen"
          size="md"
        >
          <p className="text-gray-300 mb-6">
            Bist du sicher, dass du alle lokalen Produktdaten, Ausgaben und den API Token aus deinem Browser löschen möchtest? Diese Aktion ist nur lokal und kann nicht rückgängig gemacht werden.
          </p>
          <div className="flex justify-end space-x-3">
            <Button variant="secondary" onClick={() => setShowClearLocalConfirmModal(false)} disabled={isClearingLocalData} aria-label="Abbrechen">
              Abbrechen
            </Button>
            <Button variant="danger" onClick={handleClearLocalDataConfirmed} isLoading={isClearingLocalData} aria-label="Ja, lokale Daten löschen">
              {isClearingLocalData ? 'Wird gelöscht...' : 'Ja, lokale Daten löschen'}
            </Button>
          </div>
        </Modal>
      )}

      {showBulkFestschreibenConfirmModal && (
        <Modal
            isOpen={showBulkFestschreibenConfirmModal}
            onClose={() => setShowBulkFestschreibenConfirmModal(false)}
            title="Massen-Festschreibung bestätigen"
            size="md"
        >
            <p className="text-gray-300 mb-6">
                Möchten Sie wirklich alle Produkte, die vor dem {convertISOToGerman(bulkFestschreibenDate) || 'gewählten Datum'} bestellt wurden und noch nicht festgeschrieben sind,
                als festgeschrieben markieren? Diese Aktion kann nicht direkt rückgängig gemacht werden (nur durch manuelle Bearbeitung jedes Produkts).
            </p>
            <div className="flex justify-end space-x-3">
                <Button variant="secondary" onClick={() => setShowBulkFestschreibenConfirmModal(false)} disabled={isBulkFestschreibenLoading}>
                    Abbrechen
                </Button>
                <Button variant="danger" onClick={handleBulkFestschreibenConfirmed} isLoading={isBulkFestschreibenLoading}>
                    {isBulkFestschreibenLoading ? 'Wird ausgeführt...' : 'Ja, festschreiben'}
                </Button>
            </div>
        </Modal>
      )}

    </div>
  );
};

export default SettingsPage;