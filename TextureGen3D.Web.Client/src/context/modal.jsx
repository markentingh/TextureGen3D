import React, { createContext, useContext, useState, useCallback } from 'react';
import Modal from '@/components/ui/modal';
import Button from '@/components/ui/button';
import WarningModal from '@/components/ui/warning-modal';

const ModalContext = createContext(null);

export function ModalProvider({ children }) {
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [warning, setWarning] = useState(null);

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

  const showWarningModal = useCallback((opts) => {
    setWarning({
      title: opts.title || 'Warning',
      message: opts.message || '',
      confirmLabel: opts.confirmLabel || 'OK',
      onConfirm: opts.onConfirm || (() => {}),
      onClose: opts.onClose || (() => {}),
    });
  }, []);

  const hideWarningModal = useCallback(() => {
    setWarning(null);
  }, []);

  const handleWarningConfirm = useCallback(() => {
    if (warning?.onConfirm) warning.onConfirm();
    setWarning(null);
  }, [warning]);

  const handleWarningClose = useCallback(() => {
    if (warning?.onClose) warning.onClose();
    setWarning(null);
  }, [warning]);

  return (
    <ModalContext.Provider value={{ showModal, hideModal, showConfirmModal, hideConfirmModal, showWarningModal, hideWarningModal }}>
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
      {warning && (
        <WarningModal
          show
          title={warning.title}
          message={warning.message}
          confirmLabel={warning.confirmLabel}
          onConfirm={handleWarningConfirm}
          onClose={handleWarningClose}
        />
      )}
    </ModalContext.Provider>
  );
}

export function useModal() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be used within a ModalProvider');
  return ctx;
}
