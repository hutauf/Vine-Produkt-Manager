import React, { useState } from 'react';
import Modal from '../Common/Modal';
import Button from '../Common/Button';

interface CreateShopModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (opts: { email: string; percent: number; reference: 'etv' | 'teilwert'; showDiscount: boolean; name: string; publish: boolean; }) => void;
}

const CreateShopModal: React.FC<CreateShopModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [email, setEmail] = useState('');
  const [percent, setPercent] = useState('100');
  const [reference, setReference] = useState<'etv' | 'teilwert'>('teilwert');
  const [showDiscount, setShowDiscount] = useState(false);
  const [name, setName] = useState('');

  const handle = (publish: boolean) => {
    const pct = parseFloat(percent) || 0;
    onSubmit({ email, percent: pct, reference, showDiscount, name, publish });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Shop erstellen" size="md">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300">Empfänger Email (optional)</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1 block w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm text-gray-100 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300">Preisfaktor in %</label>
          <input type="number" value={percent} onChange={e => setPercent(e.target.value)} className="mt-1 block w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm text-gray-100 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300">Referenzpreis</label>
          <select value={reference} onChange={e => setReference(e.target.value as 'etv' | 'teilwert')} className="mt-1 block w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm text-gray-100 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm">
            <option value="teilwert">Teilwert</option>
            <option value="etv">ETV</option>
          </select>
        </div>
        <div className="flex items-center space-x-2">
          <input id="showDiscount" type="checkbox" className="form-checkbox h-4 w-4 text-sky-600 bg-slate-600 border-slate-500 rounded" checked={showDiscount} onChange={e => setShowDiscount(e.target.checked)} />
          <label htmlFor="showDiscount" className="text-sm text-gray-300">Rabatt anzeigen</label>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300">Name für Veröffentlichung (optional)</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} className="mt-1 block w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm text-gray-100 focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm" />
        </div>
        <div className="flex justify-end space-x-3 pt-4 border-t border-slate-700 mt-2">
          <Button variant="secondary" onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={() => handle(false)}>Nur anzeigen</Button>
          <Button onClick={() => handle(true)}>Veröffentlichen</Button>
        </div>
      </div>
    </Modal>
  );
};

export default CreateShopModal;
