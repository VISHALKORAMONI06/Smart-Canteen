import React, { useState, useMemo } from 'react';
import StatusBadge from './StatusBadge.jsx';
import { useApp } from '../context/AppContext.jsx';
import { formatTime, formatDateTime, formatRelativeTime } from '../utils/dates.js';

export default function StaffOrders() {
  const { orders, transitionOrderStatus } = useApp();
  const [statusFilter, setStatusFilter] = useState('Active');
  const [tokenSearch, setTokenSearch] = useState('');
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Compute status counts
  const counts = useMemo(() => {
    let active = 0;
    let placed = 0;
    let preparing = 0;
    let ready = 0;
    let collected = 0;
    let expired = 0;

    for (const o of orders) {
      if (o.status === 'Placed') placed++;
      if (o.status === 'Preparing') preparing++;
      if (o.status === 'Ready') ready++;
      if (o.status === 'Collected') collected++;
      if (o.status === 'Expired') expired++;

      if (o.status === 'Placed' || o.status === 'Preparing' || o.status === 'Ready') {
        active++;
      }
    }

    return {
      Active: active,
      Placed: placed,
      Preparing: preparing,
      Ready: ready,
      Collected: collected,
      Expired: expired,
      All: orders.length
    };
  }, [orders]);

  // Filter orders according to chip and search
  const filteredOrders = useMemo(() => {
    const q = tokenSearch.trim().toUpperCase();

    return orders.filter((order) => {
      // Search match
      if (q && !order.token.toUpperCase().includes(q)) {
        return false;
      }

      // Filter match
      if (statusFilter === 'Active') {
        return order.status === 'Placed' || order.status === 'Preparing' || order.status === 'Ready';
      }
      if (statusFilter === 'All') return true;
      return order.status === statusFilter;
    });
  }, [orders, statusFilter, tokenSearch]);

  // History orders (Collected + Expired)
  const historyOrders = useMemo(() => {
    return orders.filter((o) => o.status === 'Collected' || o.status === 'Expired');
  }, [orders]);

  const getNextAction = (status) => {
    switch (status) {
      case 'Placed':
        return { label: 'Mark Preparing →', nextStatus: 'Preparing', className: 'btn-staff-preparing' };
      case 'Preparing':
        return { label: 'Mark Ready →', nextStatus: 'Ready', className: 'btn-staff-ready' };
      case 'Ready':
        return { label: 'Mark Collected →', nextStatus: 'Collected', className: 'btn-staff-collected' };
      default:
        return null;
    }
  };

  const filterTabs = ['Active', 'Placed', 'Preparing', 'Ready', 'Collected', 'All'];

  return (
    <div className="page-content staff-orders-page">
      <section className="staff-header-section">
        <div className="staff-title-col">
          <span className="eyebrow-tag">KITCHEN COUNTER</span>
          <h1 className="hero-title">Incoming pre-orders</h1>
          <p className="hero-subtitle">
            Move orders along as they&apos;re cooked, packed and handed over to students.
          </p>
        </div>

        <div className="token-search-wrapper">
          <svg
            className="search-icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            className="token-search-input"
            placeholder="Find token, e.g. SC-104"
            value={tokenSearch}
            onChange={(e) => setTokenSearch(e.target.value)}
            aria-label="Find token"
          />
        </div>
      </section>

      {/* Filter Chips */}
      <section className="staff-filters-row" aria-label="Status Filters">
        <div className="category-chips-list" role="tablist">
          {filterTabs.map((tab) => {
            const count = counts[tab] || 0;
            const isSelected = statusFilter === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={isSelected}
                className={`category-chip ${isSelected ? 'active' : ''}`}
                onClick={() => setStatusFilter(tab)}
              >
                <span className="chip-label">{tab}</span>
                <span className="chip-count">{count}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Main Order Grid */}
      <section className="staff-grid-section" aria-label="Kitchen Orders Queue">
        {filteredOrders.length === 0 ? (
          <div className="empty-state-box">
            <div className="empty-state-icon" aria-hidden="true">🍳</div>
            <h2 className="empty-state-title">No orders in &ldquo;{statusFilter}&rdquo;</h2>
            <p className="empty-state-text">
              {statusFilter === 'Active'
                ? 'All clear at the cooking counter! New incoming orders will appear here automatically.'
                : 'No orders match the current filter selection.'}
            </p>
            {(statusFilter !== 'Active' || tokenSearch) && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setStatusFilter('Active');
                  setTokenSearch('');
                }}
              >
                Reset to Active
              </button>
            )}
          </div>
        ) : (
          <div className="staff-orders-grid">
            {filteredOrders.map((order) => {
              const action = getNextAction(order.status);
              return (
                <article key={order.id} className={`staff-order-card status-${order.status.toLowerCase()}`}>
                  <div className="staff-card-header">
                    <div>
                      <h3 className="staff-token-title">{order.token}</h3>
                      <div className="staff-timing-meta">
                        {formatRelativeTime(order.createdAt)} · pickup {formatTime(order.pickupAt)}
                      </div>
                    </div>
                    <StatusBadge status={order.status} />
                  </div>

                  <div className="staff-card-items-list">
                    {order.items.map((line, idx) => (
                      <div key={idx} className="staff-item-row">
                        <span className="item-qty-badge">{line.quantity}</span>
                        <span className="item-line-name">{line.name}</span>
                      </div>
                    ))}
                  </div>

                  {order.note && (
                    <div className="staff-order-note">
                      <span className="note-label">Note:</span> {order.note}
                    </div>
                  )}

                  <div className="staff-card-footer">
                    <span className="current-status-tag">
                      {order.status}
                    </span>

                    {action ? (
                      <button
                        type="button"
                        className={`btn ${action.className}`}
                        onClick={() => transitionOrderStatus(order.id, action.nextStatus)}
                        aria-label={`${action.label} for ${order.token}`}
                      >
                        {action.label}
                      </button>
                    ) : (
                      <span className="status-finished-note">
                        {order.status === 'Collected' ? 'Handed over' : 'Order expired'}
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* History Collapsible Section (Collected & Expired) */}
      <section className="staff-history-section" aria-label="Order History">
        <button
          type="button"
          className="history-toggle-bar"
          onClick={() => setIsHistoryOpen(!isHistoryOpen)}
          aria-expanded={isHistoryOpen}
        >
          <div className="history-toggle-left">
            <span className="history-toggle-icon">{isHistoryOpen ? '▼' : '▶'}</span>
            <span className="history-toggle-title">Order History (Collected &amp; Expired)</span>
          </div>
          <span className="count-pill">{historyOrders.length}</span>
        </button>

        {isHistoryOpen && (
          <div className="history-content-panel">
            {historyOrders.length === 0 ? (
              <p className="empty-section-hint">No completed or expired orders in history.</p>
            ) : (
              <div className="history-table-container">
                <table className="canteen-table history-table">
                  <thead>
                    <tr>
                      <th>Token</th>
                      <th>Placed</th>
                      <th>Items</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyOrders.map((o) => (
                      <tr key={o.id}>
                        <td className="font-semibold">{o.token}</td>
                        <td>{formatDateTime(o.createdAt)}</td>
                        <td>
                          {o.items.map((it) => `${it.quantity}× ${it.name}`).join(', ')}
                        </td>
                        <td>₹{o.totalAmount.toLocaleString('en-IN')}</td>
                        <td>
                          <StatusBadge status={o.status} />
                        </td>
                        <td>
                          {o.collectedAt ? formatDateTime(o.collectedAt) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
