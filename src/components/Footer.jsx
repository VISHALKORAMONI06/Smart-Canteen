import React from 'react';
import { useApp } from '../context/AppContext.jsx';
import { isSupabaseConfigured } from '../lib/supabaseClient.js';

export default function Footer() {
  const {
    resetDemoData,
    loadSampleOrders,
    setConfirmDialog,
    isAdmin,
    settings,
    toggleOrderingOpen,
    addToast,
    isDemoMode
  } = useApp();

  const handleResetClick = () => {
    setConfirmDialog({
      title: 'Reset Demo Data',
      message:
        'Are you sure you want to reset all data? This will clear all active orders, re-seed the default 15-item menu, empty the cart, and reset the token counter back to SC-101.',
      confirmText: 'Reset Everything',
      cancelText: 'Cancel',
      isDestructive: true,
      onConfirm: resetDemoData
    });
  };

  const handleSampleOrdersClick = () => {
    setConfirmDialog({
      title: 'Load Viva Sample Orders',
      message:
        'Populate the kitchen queue and demand dashboard with realistic demo pre-orders across Placed, Preparing, Ready, Collected, and Expired states?',
      confirmText: 'Load Sample Orders',
      cancelText: 'Cancel',
      isDestructive: false,
      onConfirm: loadSampleOrders
    });
  };

  const handleToggleCanteen = () => {
    const action = settings?.orderingOpen ? 'close' : 'open';
    setConfirmDialog({
      title: `${action === 'open' ? 'Open' : 'Close'} Canteen Ordering`,
      message: `Are you sure you want to ${action} canteen ordering? ${
        action === 'close'
          ? 'Students will not be able to place new orders while ordering is closed.'
          : 'Students will be able to place orders again.'
      }`,
      confirmText: action === 'open' ? 'Open Ordering' : 'Close Ordering',
      cancelText: 'Cancel',
      isDestructive: action === 'close',
      onConfirm: () => {
        toggleOrderingOpen().then(({ error }) => {
          if (error) {
            addToast(`Failed to update canteen status: ${error.message}`, 'error');
          } else {
            addToast(
              `Canteen ordering is now ${action === 'open' ? 'open' : 'closed'}.`,
              'info'
            );
          }
        });
      }
    });
  };

  return (
    <footer className="app-footer no-print">
      <div className="footer-container">
        <div className="footer-left">
          {/* Storage/mode indicator */}
          {isDemoMode ? (
            <p className="footer-storage-note">
              <span className="storage-dot demo-dot" aria-hidden="true">●</span>
              <strong>Demo Mode:</strong> All data is stored in this browser only via
              LocalStorage. Configure Supabase for real multi-device operation.
            </p>
          ) : (
            <p className="footer-storage-note">
              <span className="storage-dot live-dot" aria-hidden="true">●</span>
              <strong>Live Mode:</strong> Connected to Supabase — real-time, multi-device.
            </p>
          )}
          <p className="footer-subnote">
            SmartCanteen — College Canteen Pre-Ordering &amp; Demand Management.
          </p>
        </div>

        <div className="footer-actions">
          {/* Admin-only: canteen open/close toggle (Supabase mode) */}
          {isAdmin && isSupabaseConfigured && (
            <button
              type="button"
              className={`btn btn-sm ${
                settings?.orderingOpen ? 'btn-outline text-danger' : 'btn-outline'
              } footer-btn`}
              onClick={handleToggleCanteen}
              title={settings?.orderingOpen ? 'Close canteen ordering' : 'Open canteen ordering'}
            >
              {settings?.orderingOpen ? '🔒 Close Canteen' : '🔓 Open Canteen'}
            </button>
          )}

          {/* Demo mode only: sample data controls */}
          {isDemoMode && (
            <>
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
            </>
          )}
        </div>
      </div>
    </footer>
  );
}
