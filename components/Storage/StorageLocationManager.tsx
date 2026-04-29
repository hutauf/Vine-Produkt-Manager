import React, { useMemo, useState } from 'react';
import Button from '../Common/Button';
import { Product } from '../../types';
import { StorageLocationEntry, UpdateStorageLocationInput } from '../../utils/storageLocationService';

interface StorageLocationManagerProps {
  locations: StorageLocationEntry[];
  products: Product[];
  onSave: (entries: UpdateStorageLocationInput[]) => Promise<void>;
  onDelete: (locationId: string) => Promise<void>;
  onOpenAudit: (locationId: string) => void;
  onPrintLabel: (locationId: string, options: { withMeta: boolean }) => void;
}

const StorageLocationManager: React.FC<StorageLocationManagerProps> = ({ locations, products, onSave, onDelete, onOpenAudit, onPrintLabel }) => {
  const [newLocationId, setNewLocationId] = useState('');

  const assignedCountMap = useMemo(() => {
    const counts = new Map<string, number>();
    products.forEach((product: any) => {
      const locationId = product.storageLocationId;
      if (!locationId) return;
      counts.set(locationId, (counts.get(locationId) ?? 0) + 1);
    });
    return counts;
  }, [products]);

  return (
    <div className="p-6 bg-slate-800 rounded-lg border border-slate-700 space-y-4">
      <h3 className="text-xl font-semibold text-gray-100">Lagerort-Verwaltung</h3>
      <div className="flex gap-2">
        <input
          value={newLocationId}
          onChange={(e) => setNewLocationId(e.target.value)}
          placeholder="Neuer Lagerort (location_id)"
          className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-gray-100"
        />
        <Button onClick={() => onSave([{ location_id: newLocationId.trim(), value: { status: 'free' } }])} disabled={!newLocationId.trim()}>
          Anlegen
        </Button>
      </div>

      <ul className="space-y-2">
        {locations.map((location) => {
          const assignedCount = assignedCountMap.get(location.location_id) ?? 0;
          const isEmpty = assignedCount === 0;
          return (
            <li key={location.location_id} className="p-3 bg-slate-700 rounded-md flex items-center justify-between">
              <button className="text-left" onClick={() => onOpenAudit(location.location_id)}>
                <div className="text-gray-100 font-medium">{location.location_id}</div>
                <div className="text-xs text-gray-400">Produkte: {assignedCount}</div>
              </button>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => onPrintLabel(location.location_id, { withMeta: true })}>QR drucken</Button>
                <Button size="sm" variant="danger" onClick={() => onDelete(location.location_id)} disabled={!isEmpty}>Löschen</Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default StorageLocationManager;
