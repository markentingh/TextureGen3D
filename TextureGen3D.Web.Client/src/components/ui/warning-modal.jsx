import React from 'react';
import Modal from '@/components/ui/modal';
import Button from '@/components/ui/button';
import Icon from '@/components/ui/icon';

export default function WarningModal({ show, title, message, confirmLabel = 'OK', onConfirm, onClose }) {
  if (!show) return null;

  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex items-start gap-3 mb-6">
        <Icon name="warning" className="text-yellow-500 flex-shrink-0" style={{ fontSize: '30px' }} />
        <p className="text-gray-700 dark:text-gray-300">{message}</p>
      </div>
      <div className="buttons flex gap-3 justify-end">
        <Button color="gray" onClick={onConfirm || onClose}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
