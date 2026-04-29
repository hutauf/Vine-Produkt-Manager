import React, { useState } from 'react';
import Button from '../Common/Button';

interface ScannerPanelProps {
  title: string;
  helpText?: string;
  onDetected: (code: string) => Promise<void> | void;
}

const ScannerPanel: React.FC<ScannerPanelProps> = ({ title, helpText, onDetected }) => {
  const [manualCode, setManualCode] = useState('');
  const [isScanning, setIsScanning] = useState(false);

  const triggerScan = async () => {
    if (!manualCode.trim()) return;
    await onDetected(manualCode.trim());
    setManualCode('');
  };

  return (
    <div className="p-4 rounded-lg border border-slate-700 bg-slate-800 space-y-3">
      <h3 className="text-lg font-semibold text-gray-100">{title}</h3>
      {helpText && <p className="text-sm text-gray-400">{helpText}</p>}
      <div className="flex gap-2">
        <input
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value)}
          placeholder="Barcode/QR-Code"
          className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-gray-100"
        />
        <Button onClick={triggerScan} disabled={!manualCode.trim()}>
          Prüfen
        </Button>
      </div>
      <Button variant="secondary" onClick={() => setIsScanning((prev) => !prev)}>
        {isScanning ? 'Kamera-Scanner stoppen' : 'Kamera-Scanner starten'}
      </Button>
      {isScanning && (
        <div className="text-xs text-gray-400">
          Kamera-Scanner-Platzhalter (z. B. html5-qrcode). Verbinden Sie den Decoder-Callback mit <code>onDetected(code)</code>.
        </div>
      )}
    </div>
  );
};

export default ScannerPanel;
