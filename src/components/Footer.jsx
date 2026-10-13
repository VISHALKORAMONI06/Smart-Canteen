import React from 'react';
import { useApp } from '../context/AppContext.jsx';

export default function Footer() {
  const { resetDemoData, loadSampleOrders, setConfirmDialog } = useApp();

  const handleResetClick = () => {
    setConfirmDialog({
      title: 'Reset Demo Data',
      message: 'Are you sure you want to reset all data? This will clear all active orders, re-seed the default 15-item menu, empty the cart, and reset the token counter back to SC-101.',
      confirmText: 'Reset Everything',
      cancelText: 'Cancel',
      isDestructive: true,
      onConfirm: resetDemoData
    });
  };

  const handleSampleOrdersClick = () => {
    setConfirmDialog({
      title: 'Load Viva Sample Orders',
      message: 'Populate the kitchen queue and demand dashboard with realistic demo pre-orders across Placed, Preparing, Ready, Collected, and Expired states?',
      confirmText: 'Load Sample Orders',
      cancelText: 'Cancel',
      isDestructive: false,
      onConfirm: loadSampleOrders
    });
  };

  return (
    <footer className="app-footer no-print">
      <div className="footer-container">
        <div className="footer-left">
          <p className="footer-storage-note">
            <span className="storage-dot" aria-hidden="true">●</span>
            <strong>Browser Storage Note:</strong> All data is stored in this browser only via LocalStorage (keys prefixed <code>smartcanteen:</code>).
          </p>
          <p className="footer-subnote">
            SmartCanteen — College Canteen Pre-Ordering &amp; Demand Management Mini-Project.
          </p>
        </div>

        <div className="footer-actions">
          <button
            type="button"
            className="btn btn-sm btn-outline footer-btn"
            onClick={handleSampleOrdersClick}
            title="Populate kitchen queue and charts with sample orders"
          >
            ⚡ Load Sample Orders
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline text-danger footer-btn"
            onClick={handleResetClick}
            title="Clear all orders and reset token counter to 100"
          >
            ↺ Reset Demo Data
          </button>
        </div>
      </div>
    </footer>
  );
}
