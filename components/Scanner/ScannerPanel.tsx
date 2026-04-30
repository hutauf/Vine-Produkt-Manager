import React, { useState, useEffect, useRef, useMemo } from 'react';
import Button from '../Common/Button';
import { Html5Qrcode, CameraDevice } from 'html5-qrcode';
import { FaCamera, FaTimes, FaCheckCircle, FaSyncAlt } from 'react-icons/fa';

interface ScannerPanelProps {
  title: string;
  helpText?: string;
  onDetected: (code: string) => Promise<void> | void;
  cameraPreferenceKey?: string;
}

const ScannerPanel: React.FC<ScannerPanelProps> = ({ title, helpText, onDetected }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>('');
  const [successCode, setSuccessCode] = useState<string>('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isHandlingDetectionRef = useRef(false);
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
    isHandlingDetectionRef.current = true;
    
    playSound();
    setSuccessCode(code);
    
    try {
      await onDetected(code);
    } catch (e) {
      console.error('Error in onDetected', e);
    }

    setTimeout(() => {
      setIsModalOpen(false);
      setSuccessCode('');
    }, 1500); // Wait 1.5s to show success then close
  };

  // Keep a ref to the latest handleDetect
  const handleDetectRef = useRef(handleDetect);
  useEffect(() => {
    handleDetectRef.current = handleDetect;
  }, [handleDetect]);

  useEffect(() => {
    let isMounted = true;

    if (isModalOpen && !successCode && !scannerRef.current) {
      Html5Qrcode.getCameras().then((devices) => {
        if (!isMounted) return;
        if (devices && devices.length) {
          setCameras(devices);
          const storedCamId = localStorage.getItem(cameraStorageKey);
          const knownStoredCam = storedCamId && devices.some((d) => d.id === storedCamId) ? storedCamId : '';
          const defaultCamId = selectedCamera || knownStoredCam || findBestDefaultCamera(devices);
          
          if (!selectedCamera && defaultCamId) {
            setSelectedCamera(defaultCamId);
            // Return early! Let the next render cycle (which now has selectedCamera set) start the scanner.
            // This prevents a stale closure where the scanner starts but the effect cleans up immediately.
            return;
          }
          
          const html5QrCode = new Html5Qrcode(scannerContainerId);
          scannerRef.current = html5QrCode;
          
          html5QrCode.start(
            defaultCamId, 
            { fps: 10, qrbox: { width: 250, height: 250 } },
            (decodedText) => {
              handleDetectRef.current(decodedText);
            },
            (error) => {} // ignore
          ).catch((err) => {
            console.error('Failed to start scanner', err);
          });
        }
      }).catch((err) => {
        console.error('Failed to get cameras', err);
      });
    } else if ((!isModalOpen || successCode) && scannerRef.current) {
      const html5QrCode = scannerRef.current;
      scannerRef.current = null;
      
      try {
        html5QrCode.stop().then(() => {
          try { html5QrCode.clear(); } catch (e) {}
        }).catch(e => {
          try { html5QrCode.clear(); } catch (err) {}
        });
      } catch (err) {
        console.warn('Sync error stopping scanner', err);
      }
    }

    return () => {
      isMounted = false;
    };
  }, [cameraStorageKey, isModalOpen, scannerContainerId, selectedCamera, successCode]);

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
    <>
      <Button 
        variant="secondary" 
        onClick={() => {
          setSuccessCode('');
          isHandlingDetectionRef.current = false;
          setIsModalOpen(true);
        }}
        leftIcon={<FaCamera />}
      >
        {title}
      </Button>

      {isModalOpen && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-slate-900 animate-in fade-in zoom-in-95 duration-200">
          <div className="flex justify-between items-center p-4 bg-slate-800 border-b border-slate-700 shadow-md">
            <div>
              <h3 className="text-xl font-bold text-white">{title}</h3>
              {helpText && <p className="text-sm text-gray-400 mt-1">{helpText}</p>}
            </div>
            <button 
              onClick={() => {
                setIsModalOpen(false);
                setSuccessCode('');
              }} 
              className="p-3 text-gray-400 hover:text-white rounded-full bg-slate-700 hover:bg-slate-600 transition-colors"
            >
              <FaTimes className="text-xl" />
            </button>
          </div>
          
          <div className="flex-1 flex flex-col items-center justify-center p-4 relative bg-black">
            {successCode ? (
              <div className="text-center animate-in zoom-in fade-in duration-300">
                <FaCheckCircle className="text-6xl text-emerald-500 mx-auto mb-4" />
                <h2 className="text-2xl font-bold text-white mb-2">Erfolgreich gescannt!</h2>
                <p className="text-emerald-300 text-2xl font-mono bg-emerald-900/30 p-4 rounded border border-emerald-700">{successCode}</p>
              </div>
            ) : (
              <>
                <div id={scannerContainerId} className="w-full max-w-lg rounded-xl overflow-hidden shadow-2xl bg-slate-800"></div>
                {cameras.length > 1 && (
                  <div className="absolute bottom-8 flex justify-center w-full">
                    <Button 
                      variant="secondary" 
                      onClick={() => {
                        const currentIndex = cameras.findIndex(c => c.id === selectedCamera);
                        const nextIndex = (currentIndex + 1) % cameras.length;
                        const nextCamera = cameras[nextIndex].id;
                        localStorage.setItem(cameraStorageKey, nextCamera);
                        if (scannerRef.current) {
                           const oldScanner = scannerRef.current;
                           scannerRef.current = null;
                           oldScanner.stop().then(() => {
                             oldScanner.clear();
                             setSelectedCamera(nextCamera);
                           }).catch(() => {
                             try { oldScanner.clear(); } catch(e) {}
                             setSelectedCamera(nextCamera);
                           });
                        } else {
                           setSelectedCamera(nextCamera);
                        }
                      }} 
                      leftIcon={<FaSyncAlt />}
                      className="shadow-xl bg-slate-800/80 backdrop-blur-md border-slate-600 text-white"
                    >
                      Kamera wechseln
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default ScannerPanel;
