import React from 'react';

/**
 * Accessible Status Badge conveying state with both text and distinct color tokens.
 * Statuses: PendingPayment, Placed, Confirmed, Preparing, Ready, Collected, Expired, Cancelled
 */
export default function StatusBadge({ status }) {
  const getBadgeConfig = (st) => {
    switch (st) {
      case 'PendingPayment':
        return {
          label: 'Awaiting Payment',
          className: 'badge-pending-payment',
          dotChar: '⏳'
        };
      case 'Placed':
        return {
          label: 'Placed',
          className: 'badge-placed',
          dotChar: '●'
        };
      case 'Confirmed':
        return {
          label: 'Confirmed',
          className: 'badge-confirmed',
          dotChar: '✓'
        };
      case 'Preparing':
        return {
          label: 'Preparing',
          className: 'badge-preparing',
          dotChar: '●'
        };
      case 'Ready':
        return {
          label: 'Ready for Pickup',
          className: 'badge-ready',
          dotChar: '✓'
        };
      case 'Collected':
        return {
          label: 'Collected',
          className: 'badge-collected',
          dotChar: '✓'
        };
      case 'Expired':
        return {
          label: 'Expired',
          className: 'badge-expired',
          dotChar: '✕'
        };
      case 'Cancelled':
        return {
          label: 'Cancelled',
          className: 'badge-expired',
          dotChar: '✕'
        };
      default:
        return {
          label: st || 'Unknown',
          className: 'badge-placed',
          dotChar: '•'
        };
    }
  };

  const { label, className, dotChar } = getBadgeConfig(status);

  return (
    <span className={`status-badge ${className}`} role="status" aria-label={`Status: ${label}`}>
      <span className="badge-dot" aria-hidden="true">{dotChar}</span>
      <span className="badge-text">{label}</span>
    </span>
  );
}
