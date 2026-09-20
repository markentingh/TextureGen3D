import React, { createContext, useContext, useState, useCallback } from 'react';
import Modal from '@/components/ui/modal';
import Button from '@/components/ui/button';

const ModalContext = createContext(null);

export function ModalProvider({ children }) {
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const showModal = useCallback((content) => {
    setModal(content);
  }, []);

  const hideModal = useCallback(() => {
    setModal(null);
  }, []);

  const showConfirmModal = useCallback((opts) => {
    setConfirm({
      title: opts.title || 'Confirm',
      message: opts.message || '',
      confirmLabel: opts.confirmLabel || 'Delete',
      confirmColor: opts.confirmColor || 'red',
      showCancel: opts.showCancel !== false,
      onConfirm: opts.onConfirm || (() => {}),
      onClose: opts.onClose || (() => {}),
    });
  }, []);

  const hideConfirmModal = useCallback(() => {
    setConfirm(null);
  }, []);

  const handleConfirm = useCallback(() => {
    if (confirm?.onConfirm) confirm.onConfirm();
    setConfirm(null);
  }, [confirm]);

  const handleConfirmClose = useCallback(() => {
    if (confirm?.onClose) confirm.onClose();
    setConfirm(null);
  }, [confirm]);

  return (
    <ModalContext.Provider value={{ showModal, hideModal, showConfirmModal, hideConfirmModal }}>
      {children}
      {modal && (
        <Modal title={modal.title || ''} onClose={modal.onClose || hideModal} className={modal.className}>
          {modal.body}
        </Modal>
      )}
      {confirm && (
        <Modal title={confirm.title} onClose={handleConfirmClose}>
          <p className="text-gray-700 dark:text-gray-300 mb-6">{confirm.message}</p>
          <div className="buttons flex gap-3 justify-end">
            <Button color={confirm.confirmColor} onClick={handleConfirm}>
              {confirm.confirmLabel}
            </Button>
            {confirm.showCancel && (
              <Button color="gray" className="cancel" onClick={handleConfirmClose}>
                Cancel
              </Button>
            )}
          </div>
        </Modal>
      )}
    </ModalContext.Provider>
  );
}

export function useModal() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be used within a ModalProvider');
  return ctx;
}
