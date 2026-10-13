import React, { useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext.jsx';

export default function ConfirmDialog() {
  const { confirmDialog, setConfirmDialog } = useApp();
  const dialogRef = useRef(null);
  const confirmBtnRef = useRef(null);

  useEffect(() => {
    if (!confirmDialog) return;

    // Focus confirm button when modal opens
    if (confirmBtnRef.current) {
      confirmBtnRef.current.focus();
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setConfirmDialog(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmDialog, setConfirmDialog]);

  if (!confirmDialog) return null;

  const {
    title = 'Please Confirm',
    message = 'Are you sure you want to proceed?',
    details = null,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    isDestructive = false,
    onConfirm
  } = confirmDialog;

  const handleBackdropClick = (e) => {
    if (e.target === dialogRef.current) {
      setConfirmDialog(null);
    }
  };

  const handleConfirm = () => {
    if (onConfirm) onConfirm();
    setConfirmDialog(null);
  };

  return (
    <div
      className="modal-backdrop"
      ref={dialogRef}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="modal-dialog confirm-dialog-box">
        <div className="modal-header">
          <h2 id="confirm-dialog-title" className="modal-title">
            {title}
          </h2>
          <button
            type="button"
            className="modal-close-btn"
            onClick={() => setConfirmDialog(null)}
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          <p className="confirm-message">{message}</p>
          {details && <div className="confirm-details">{details}</div>}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setConfirmDialog(null)}
          >
            {cancelText}
          </button>
          <button
            type="button"
            ref={confirmBtnRef}
            className={`btn ${isDestructive ? 'btn-danger' : 'btn-primary'}`}
            onClick={handleConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
