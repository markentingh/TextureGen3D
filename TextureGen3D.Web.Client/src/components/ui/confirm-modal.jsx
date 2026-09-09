import React from 'react';
import Modal from '@/components/ui/modal';
import Button from '@/components/ui/button';

export default function ConfirmModal({ show, title, message, confirmLabel = 'Delete', onConfirm, onClose }) {
  if (!show) return null;

  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-gray-700 dark:text-gray-300 mb-6">{message}</p>
      <div className="buttons flex gap-3 justify-end">
        <Button color="red" onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button color="gray" className="cancel" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
