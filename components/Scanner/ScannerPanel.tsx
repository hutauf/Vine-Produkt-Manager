import React, { useState, useEffect, useRef, useMemo } from 'react';
import Button from '../Common/Button';
import { Html5Qrcode, CameraDevice } from 'html5-qrcode';

interface ScannerPanelProps {
  title: string;
  helpText?: string;
  onDetected: (code: string) => Promise<void> | void;
  cameraPreferenceKey?: string;
}

const ScannerPanel: React.FC<ScannerPanelProps> = ({ title, helpText, onDetected, cameraPreferenceKey = 'default' }) => {
  const [manualCode, setManualCode] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>('');
  const [lastSuccessCode, setLastSuccessCode] = useState<string>('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isHandlingDetectionRef = useRef(false);
  const lastScannedRef = useRef<{code: string, time: number} | null>(null);
  const cameraStorageKey = `scanner:lastCameraGlobal`;
  const scannerContainerId = useMemo(() => `qr-reader-${title.replace(/[^a-z0-9]/gi, '')}-${Math.random().toString(36).substring(7)}`, [title]);

  const playSound = () => {
    try {
      const audio = new Audio('/sounds/bingsound.mp3');
      audio.play().catch(e => console.warn('Could not play sound', e));
    } catch (e) {}
  };

  const findBestDefaultCamera = (devices: CameraDevice[]) => {
    const preferred = devices.find((cam) => /back|rear|environment|rück/i.test(cam.label || ''));
    return preferred?.id || devices[0]?.id || '';
  };

  const handleDetect = async (code: string) => {
    if (isHandlingDetectionRef.current) return;
    
    const now = Date.now();
    if (lastScannedRef.current) {
      const { code: lastCode, time: lastTime } = lastScannedRef.current;
      if (code === lastCode && (now - lastTime) < 2000) {
        return;
      }
    }
    
    // Lock it immediately
    isHandlingDetectionRef.current = true;
    lastScannedRef.current = { code, time: now };
    playSound();
    setLastSuccessCode(code);
    setIsScanning(false); // Stop scanner automatically after a successful read
    
    try {
      await onDetected(code);
    } catch (e) {
      console.error('Error in onDetected', e);
    }
  };

  const triggerScan = async () => {
    if (!manualCode.trim()) return;
    setIsScanning(false); // Stop camera if manual entry is used while scanning
    isHandlingDetectionRef.current = false; // Reset for manual scan
    handleDetect(manualCode.trim());
    setManualCode('');
  };

  useEffect(() => {
    let isMounted = true;

    if (isScanning && !scannerRef.current) {
      Html5Qrcode.getCameras().then((devices) => {
        if (!isMounted) return;
        if (devices && devices.length) {
          setCameras(devices);
          const storedCamId = localStorage.getItem(cameraStorageKey);
          const knownStoredCam = storedCamId && devices.some((d) => d.id === storedCamId) ? storedCamId : '';
          const defaultCamId = selectedCamera || knownStoredCam || findBestDefaultCamera(devices);
          if (!selectedCamera && defaultCamId) setSelectedCamera(defaultCamId);
          
          const html5QrCode = new Html5Qrcode(scannerContainerId);
          scannerRef.current = html5QrCode;
          
          html5QrCode.start(
            defaultCamId, 
            { fps: 10, qrbox: { width: 250, height: 250 } },
            (decodedText) => {
              if (isMounted) handleDetect(decodedText);
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
  }, [cameraStorageKey, isScanning, scannerContainerId, onDetected, selectedCamera]);

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
        <Button variant="secondary" onClick={() => {
          if (!isScanning) {
            isHandlingDetectionRef.current = false;
            setLastSuccessCode('');
          }
          setIsScanning((prev) => !prev);
        }}>
          {isScanning ? 'Kamera-Scanner stoppen' : 'Kamera-Scanner starten'}
        </Button>
        
        {isScanning && cameras.length > 1 && (
          <select
            value={selectedCamera}
            onChange={(e) => {
              const nextCamera = e.target.value;
              localStorage.setItem(cameraStorageKey, nextCamera);
              // Stop current scan before changing camera state
              if (scannerRef.current) {
                setIsScanning(false);
                setTimeout(() => {
                  setSelectedCamera(nextCamera);
                  setIsScanning(true);
                }, 500); // Give it half a second to completely tear down
              } else {
                setSelectedCamera(nextCamera);
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

      {lastSuccessCode && !isScanning && (
        <div className="text-emerald-300 text-sm bg-emerald-900/30 border border-emerald-700 rounded-md px-3 py-2">
          Erfolgreich gescannt: <span className="font-mono">{lastSuccessCode}</span>
        </div>
      )}
    </div>
  );
};

export default ScannerPanel;
