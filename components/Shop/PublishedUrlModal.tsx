import React from 'react';
import Modal from '../Common/Modal';
import Button from '../Common/Button';

interface PublishedUrlModalProps {
  url: string;
  isOpen: boolean;
  onClose: () => void;
}

const PublishedUrlModal: React.FC<PublishedUrlModalProps> = ({ url, isOpen, onClose }) => {
  const copy = () => navigator.clipboard.writeText(url);
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Shop veröffentlicht" size="sm">
      <p className="mb-4 break-all text-gray-300">{url}</p>
      <div className="flex justify-end space-x-3 pt-4 border-t border-slate-700">
        <Button variant="secondary" onClick={copy}>Kopieren</Button>
        <Button variant="primary" onClick={() => window.open(url, '_blank')}>Besuchen</Button>
        <Button onClick={onClose}>Schließen</Button>
      </div>
    </Modal>
  );
};

export default PublishedUrlModal;
