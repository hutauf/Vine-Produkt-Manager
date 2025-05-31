import React from 'react';
import Modal from './Modal';
import Button from './Button';

interface ConfirmGoBDChangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading?: boolean;
}

const ConfirmGoBDChangeModal: React.FC<ConfirmGoBDChangeModalProps> = ({ 
    isOpen, 
    onClose, 
    onConfirm, 
    isLoading = false 
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Änderung bestätigen (GoBD)" size="md">
      <p className="text-gray-300 mb-6">
        Das Produkt ist bereits festgeschrieben. Sind Sie sicher, dass Sie nachträgliche Änderungen vornehmen möchten?
        <br />
        Beachten Sie die GoBD-Richtlinien bezüglich der Änderung von bereits festgeschriebenen Daten.
        <br />
        Möchten Sie die Änderungen trotzdem speichern?
      </p>
      <div className="flex justify-end space-x-3 pt-4 border-t border-slate-700 mt-2">
        <Button variant="secondary" onClick={onClose} disabled={isLoading}>
          Doch nicht
        </Button>
        <Button variant="danger" onClick={onConfirm} isLoading={isLoading}>
          {isLoading ? 'Wird gespeichert...' : 'Änderungen speichern'}
        </Button>
      </div>
    </Modal>
  );
};

export default ConfirmGoBDChangeModal;
