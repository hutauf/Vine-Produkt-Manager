
import React, { useState, useEffect } from 'react';
import Button from '../Common/Button';
import Modal from '../Common/Modal';
import { FaKey, FaTrashAlt, FaSave, FaServer, FaBroom } from 'react-icons/fa';

interface SettingsPageProps {
  apiToken: string | null;
  onApiTokenChange: (token: string) => void;
  onDeleteAllServerData: () => Promise<void>;
  onClearLocalDataAndToken: () => void; // New prop
}

const SettingsPage: React.FC<SettingsPageProps> = ({
  apiToken,
  onApiTokenChange,
  onDeleteAllServerData,
  onClearLocalDataAndToken, // New prop
}) => {
  const [currentTokenValue, setCurrentTokenValue] = useState(apiToken || '');
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [showClearLocalConfirmModal, setShowClearLocalConfirmModal] = useState(false); // New state
  const [isDeletingServerData, setIsDeletingServerData] = useState(false);
  const [isClearingLocalData, setIsClearingLocalData] = useState(false); // New state

  useEffect(() => {
    setCurrentTokenValue(apiToken || '');
  }, [apiToken]);

  const handleApiTokenSave = () => {
    onApiTokenChange(currentTokenValue.trim());
  };

  const handleDeleteDataConfirmed = async () => {
    setIsDeletingServerData(true);
    await onDeleteAllServerData();
    setIsDeletingServerData(false);
    setShowDeleteConfirmModal(false);
  };

  const handleClearLocalDataConfirmed = () => {
    setIsClearingLocalData(true);
    onClearLocalDataAndToken(); // Call the new handler
    setIsClearingLocalData(false);
    setShowClearLocalConfirmModal(false);
  };

  return (
    <div className="p-6 bg-slate-800 rounded-lg shadow-xl border border-slate-700 max-w-2xl mx-auto space-y-10">
      <div>
        <h2 className="text-2xl font-semibold text-gray-100 mb-6 flex items-center">
          <FaServer className="mr-3 text-sky-400" /> API Synchronisation
        </h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="apiTokenInput" className="block text-sm font-medium text-gray-300">
              API Token
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
          <Button onClick={handleApiTokenSave} leftIcon={<FaSave />} aria-label="API Token Speichern">
            Token speichern
          </Button>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-700">
          <h3 className="text-lg font-medium text-red-400 mb-2">Gefahrenzone</h3>
          <div className="space-y-4">
            <div>
                <p className="text-sm text-gray-400 mb-2">
                    Diese Aktion löscht alle deine Produktdaten unwiderruflich vom Server.
                    Deine lokalen EÜR-Einstellungen sind davon nicht betroffen.
                </p>
                <Button
                    variant="danger"
                    onClick={() => setShowDeleteConfirmModal(true)}
                    leftIcon={<FaTrashAlt />}
                    isLoading={isDeletingServerData}
                    disabled={!apiToken || apiToken.length === 0}
                    aria-label="Alle Produktdaten auf dem Server löschen"
                >
                    Alle Produktdaten auf Server löschen
                </Button>
            </div>
            <div className="pt-4 border-t border-slate-600">
                <p className="text-sm text-gray-400 mb-2">
                    Diese Aktion löscht alle lokal gespeicherten Produktdaten und den API Token aus deinem Browser.
                    Daten auf dem Server (falls vorhanden) bleiben unberührt. Nützlich für einen kompletten lokalen Reset.
                </p>
                <Button
                    variant="danger"
                    onClick={() => setShowClearLocalConfirmModal(true)}
                    leftIcon={<FaBroom />}
                    isLoading={isClearingLocalData}
                    aria-label="Alle lokalen Produktdaten und API Token löschen"
                >
                    Lokale Daten & Token löschen
                </Button>
            </div>
          </div>
        </div>
      </div>

      {showDeleteConfirmModal && (
        <Modal
          isOpen={showDeleteConfirmModal}
          onClose={() => setShowDeleteConfirmModal(false)}
          title="Server-Datenlöschung bestätigen"
          size="md"
        >
          <p className="text-gray-300 mb-6">
            Bist du sicher, dass du alle deine Produktdaten vom Server löschen möchtest? Diese Aktion kann nicht rückgängig gemacht werden.
          </p>
          <div className="flex justify-end space-x-3">
            <Button variant="secondary" onClick={() => setShowDeleteConfirmModal(false)} disabled={isDeletingServerData} aria-label="Abbrechen">
              Abbrechen
            </Button>
            <Button variant="danger" onClick={handleDeleteDataConfirmed} isLoading={isDeletingServerData} aria-label="Ja, Server-Daten löschen">
              {isDeletingServerData ? 'Wird gelöscht...' : 'Ja, Server-Daten löschen'}
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
            Bist du sicher, dass du alle lokalen Produktdaten und den API Token aus deinem Browser löschen möchtest? Diese Aktion ist nur lokal und kann nicht rückgängig gemacht werden.
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
    </div>
  );
};

export default SettingsPage;
