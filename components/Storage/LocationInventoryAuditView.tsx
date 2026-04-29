import React, { useMemo, useState } from 'react';
import { Product } from '../../types';
import ScannerPanel from '../Scanner/ScannerPanel';

interface LocationInventoryAuditViewProps {
  locationId: string;
  products: Product[];
}

const LocationInventoryAuditView: React.FC<LocationInventoryAuditViewProps> = ({ locationId, products }) => {
  const expected = useMemo(() => products.filter((p: any) => p.storageLocationId === locationId), [products, locationId]);
  const [scanned, setScanned] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const ordered = useMemo(() => {
    return [...expected].sort((a, b) => Number(scanned.has(a.ASIN)) - Number(scanned.has(b.ASIN)));
  }, [expected, scanned]);

  const onDetected = (code: string) => {
    const match = expected.find((p) => p.ASIN === code || (p as any).barcode === code);
    if (!match) {
      setError(`Produkt ${code} gehört laut System nicht zu Lagerort ${locationId}.`);
      return;
    }
    setError(null);
    setScanned((prev) => new Set(prev).add(match.ASIN));
  };

  return (
    <div className="space-y-4">
      <ScannerPanel title={`Inventur-Scan · ${locationId}`} helpText="Scannt korrekte Produkte grün ab und verschiebt sie ans Listenende." onDetected={onDetected} />
      {error && <div className="p-3 rounded bg-red-950 text-red-300 text-sm">{error}</div>}
      <ul className="space-y-2">
        {ordered.map((p) => {
          const ok = scanned.has(p.ASIN);
          return (
            <li key={p.ASIN} className={`p-3 rounded border ${ok ? 'bg-green-900/30 border-green-600' : 'bg-slate-800 border-slate-700'}`}>
              <div className="text-sm text-gray-100">{p.name}</div>
              <div className="text-xs text-gray-400">ASIN: {p.ASIN}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default LocationInventoryAuditView;
