import React, { useState, useEffect, useRef, useMemo } from 'react';
import Button from '../Common/Button';
import { Html5Qrcode, CameraDevice } from 'html5-qrcode';

interface ScannerPanelProps {
  title: string;
  helpText?: string;
  onDetected: (code: string) => Promise<void> | void;
}

const ScannerPanel: React.FC<ScannerPanelProps> = ({ title, helpText, onDetected }) => {
  const [manualCode, setManualCode] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerId = useMemo(() => `qr-reader-${title.replace(/[^a-z0-9]/gi, '')}-${Math.random().toString(36).substring(7)}`, [title]);

  const triggerScan = async () => {
    if (!manualCode.trim()) return;
    await onDetected(manualCode.trim());
    setManualCode('');
  };

  useEffect(() => {
    let isMounted = true;

    if (isScanning && !scannerRef.current) {
      Html5Qrcode.getCameras().then((devices) => {
        if (!isMounted) return;
        if (devices && devices.length) {
          setCameras(devices);
          const defaultCamId = selectedCamera || devices[0].id;
          if (!selectedCamera) setSelectedCamera(devices[0].id);
          
          const html5QrCode = new Html5Qrcode(scannerContainerId);
          scannerRef.current = html5QrCode;
          
          html5QrCode.start(
            defaultCamId, 
            { fps: 10, qrbox: { width: 250, height: 250 } },
            (decodedText) => {
              if (isMounted) onDetected(decodedText);
            },
            (error) => {
              // Ignore frequent error callbacks for not finding a barcode
            }
          ).catch((err) => {
            console.error('Failed to start scanner', err);
            if (isMounted) setIsScanning(false);
          });
        }
      }).catch((err) => {
        console.error('Failed to get cameras', err);
        if (isMounted) setIsScanning(false);
      });
    } else if (!isScanning && scannerRef.current) {
      // It's crucial that the DOM element still exists when stop() and clear() are called.
      // We also handle the case where stop() might fail if it wasn't fully started.
      const html5QrCode = scannerRef.current;
      scannerRef.current = null; // Detach immediately to prevent double-calls
      
      try {
        html5QrCode.stop().then(() => {
          html5QrCode.clear();
        }).catch(e => {
          console.warn('Failed to stop scanner smoothly, trying clear anyway', e);
          try { html5QrCode.clear(); } catch (err) {}
        });
      } catch (err) {
        console.warn('Sync error stopping scanner', err);
      }
    }

    return () => {
      isMounted = false;
    };
  }, [isScanning, scannerContainerId, onDetected, selectedCamera]);

  // Handle unmount cleanup separately so it only runs when the component actually unmounts
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        const html5QrCode = scannerRef.current;
        scannerRef.current = null;
        try {
          html5QrCode.stop().then(() => {
             try { html5QrCode.clear(); } catch (err) {}
          }).catch(() => {
             try { html5QrCode.clear(); } catch (err) {}
          });
        } catch (err) {}
      }
    };
  }, []);

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
      
      <div className="flex flex-wrap gap-2 items-center">
        <Button variant="secondary" onClick={() => setIsScanning((prev) => !prev)}>
          {isScanning ? 'Kamera-Scanner stoppen' : 'Kamera-Scanner starten'}
        </Button>
        
        {isScanning && cameras.length > 1 && (
          <select
            value={selectedCamera}
            onChange={(e) => {
              // Stop current scan before changing camera state
              if (scannerRef.current) {
                setIsScanning(false);
                setTimeout(() => {
                  setSelectedCamera(e.target.value);
                  setIsScanning(true);
                }, 500); // Give it half a second to completely tear down
              } else {
                setSelectedCamera(e.target.value);
              }
            }}
            className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm text-gray-100 text-sm"
          >
            {cameras.map(cam => (
              <option key={cam.id} value={cam.id}>{cam.label || `Kamera ${cam.id}`}</option>
            ))}
          </select>
        )}
      </div>

      <div className={`mt-4 bg-slate-200 rounded-lg overflow-hidden ${isScanning ? 'block' : 'hidden'}`}>
        <div id={scannerContainerId}></div>
      </div>
    </div>
  );
};

export default ScannerPanel;
