import React, { useState, useEffect, useRef } from 'react';
import Button from '../Common/Button';
import { Html5QrcodeScanner } from 'html5-qrcode';

interface ScannerPanelProps {
  title: string;
  helpText?: string;
  onDetected: (code: string) => Promise<void> | void;
}

const ScannerPanel: React.FC<ScannerPanelProps> = ({ title, helpText, onDetected }) => {
  const [manualCode, setManualCode] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const scannerContainerId = `qr-reader-${title.replace(/[^a-z0-9]/gi, '')}`;

  const triggerScan = async () => {
    if (!manualCode.trim()) return;
    await onDetected(manualCode.trim());
    setManualCode('');
  };

  useEffect(() => {
    if (isScanning && !scannerRef.current) {
      scannerRef.current = new Html5QrcodeScanner(
        scannerContainerId,
        { fps: 10, qrbox: { width: 250, height: 250 } },
        false
      );

      scannerRef.current.render(
        (decodedText) => {
          onDetected(decodedText);
          // Optional: we can stop scanning on first detect, or keep it running.
          // Since it's a panel, keep it running is usually better for inventory.
        },
        (error) => {
          // Ignore frequent error callbacks for not finding a barcode
        }
      );
    }

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(e => console.error('Failed to clear scanner', e));
        scannerRef.current = null;
      }
    };
  }, [isScanning, scannerContainerId, onDetected]);

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
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              triggerScan();
            }
          }}
        />
        <Button onClick={triggerScan} disabled={!manualCode.trim()}>
          Prüfen
        </Button>
      </div>
      <Button variant="secondary" onClick={() => setIsScanning((prev) => !prev)}>
        {isScanning ? 'Kamera-Scanner stoppen' : 'Kamera-Scanner starten'}
      </Button>
      {isScanning && (
        <div className="mt-4 bg-slate-200 rounded-lg overflow-hidden">
          <div id={scannerContainerId}></div>
        </div>
      )}
    </div>
  );
};

export default ScannerPanel;
