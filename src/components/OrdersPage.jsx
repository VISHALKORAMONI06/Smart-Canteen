import React, { useState, useMemo, useEffect, useCallback } from 'react';
import StatusBadge from './StatusBadge.jsx';
import { useApp } from '../context/AppContext.jsx';
import { formatTime, formatDateTime } from '../utils/dates.js';
import { fetchPickupToken } from '../services/paymentService.js';
import { isSupabaseConfigured } from '../lib/supabaseClient.js';

// ---------------------------------------------------------------------------
// Map DB payment_status to a user-friendly label and style
// ---------------------------------------------------------------------------
function PaymentBadge({ paymentStatus }) {
  if (!paymentStatus || paymentStatus === 'not_required') return null;

  const config = {
    pending:   { label: '⏳ Payment Pending', cls: 'payment-badge-pending'  },
    captured:  { label: '✅ Paid',           cls: 'payment-badge-captured' },
    failed:    { label: '❌ Payment Failed', cls: 'payment-badge-failed'   },
    refunded:  { label: '↩️ Refunded',       cls: 'payment-badge-refunded' }
  };

  const c = config[paymentStatus] || { label: paymentStatus, cls: 'payment-badge-default' };
  return <span className={`payment-status-badge ${c.cls}`}>{c.label}</span>;
}

// ---------------------------------------------------------------------------
// QR Code display using inline SVG grid (no external dependency)
// Shows the pickup token for staff to scan
// ---------------------------------------------------------------------------
function PickupQRCard({ orderId, orderStatus, paymentStatus }) {
  const [tokenData, setTokenData] = useState(null);
  const [loading, setLoading]     = useState(false);
  const [expanded, setExpanded]   = useState(false);

  // Only fetch QR token for confirmed/active orders with captured payment
  const shouldShow = (
    isSupabaseConfigured &&
    paymentStatus === 'captured' &&
    (orderStatus === 'Confirmed' || orderStatus === 'Preparing' || orderStatus === 'Ready')
  );

  const fetchToken = useCallback(async () => {
    if (!orderId || !shouldShow) return;
    setLoading(true);
    const { data, error } = await fetchPickupToken(orderId);
    if (!error && data) setTokenData(data);
    setLoading(false);
  }, [orderId, shouldShow]);

  useEffect(() => {
    if (shouldShow && expanded) fetchToken();
  }, [shouldShow, expanded, fetchToken]);

  if (!shouldShow) return null;

  return (
    <div className="pickup-qr-section">
      <button
        type="button"
        className="pickup-qr-toggle"
        onClick={() => { setExpanded((e) => !e); }}
        aria-expanded={expanded}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
        </svg>
        {expanded ? 'Hide pickup QR' : 'Show pickup QR'}
        <span className="qr-chevron">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="pickup-qr-content">
          {loading && (
            <div className="qr-loading"><div className="spinner spinner-sm" /> Loading…</div>
          )}
          {!loading && tokenData && !tokenData.used && (
            <>
              <div className="qr-visual" role="img" aria-label={`Pickup token QR code`}>
                <VisualQRGrid token={tokenData.token} />
              </div>
              <div className="qr-token-display">
                <span className="qr-token-label">TOKEN CODE</span>
                <code className="qr-token-code">{tokenData.token}</code>
              </div>
              <p className="qr-instruction">
                Show this QR code or token to the canteen staff when collecting your order.
              </p>
              {tokenData.expires_at && (
                <p className="qr-expiry">
                  Expires: {formatDateTime(tokenData.expires_at)}
                </p>
              )}
            </>
          )}
          {!loading && tokenData?.used && (
            <div className="qr-used-state">
              <span>✅ This order has already been collected.</span>
            </div>
          )}
          {!loading && !tokenData && (
            <div className="qr-unavailable">
              <p>Pickup QR will be available once your order is confirmed.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * CSS-grid visual QR representation — not a real scannable QR.
 * For production, use qrcode.react or qrcode library.
 */
function VisualQRGrid({ token }) {
  const SIZE = 7; // 7×7 grid
  const cells = useMemo(() => {
    const result = [];
    for (let i = 0; i < SIZE * SIZE; i++) {
      const charCode = token ? token.charCodeAt(i % token.length) : 0;
      result.push((charCode ^ (i * 13)) % 2 === 0);
    }
    // Force corner "finder" patterns (visual QR code convention)
    const corners = [0,1,2,3,4,5,6, 7,13, 14,20, 21,27, 28,34, 35,41, 42,43,44,45,46,47,48];
    corners.forEach((idx) => { result[idx] = true; });
    return result;
  }, [token]);

  return (
    <div
      className="qr-grid-visual"
      style={{ display: 'grid', gridTemplateColumns: `repeat(${SIZE}, 1fr)`, gap: '2px', width: '140px', height: '140px' }}
    >
      {cells.map((filled, i) => (
        <div
          key={i}
          style={{
            background: filled ? '#1a1a2e' : '#fff',
            borderRadius: '1px'
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main OrdersPage component
// ---------------------------------------------------------------------------
export default function OrdersPage() {
  const { orders, setStudentView } = useApp();
  const [tokenSearch, setTokenSearch] = useState('');

  // Filter by search
  const filteredOrders = useMemo(() => {
    const q = tokenSearch.trim().toUpperCase();
    if (!q) return orders;
    return orders.filter((o) => o.token && o.token.toUpperCase().includes(q));
  }, [orders, tokenSearch]);

  // Separate active vs past orders
  // Active: PendingPayment, Placed, Confirmed, Preparing, Ready
  // Past: Collected, Cancelled, Expired
  const { activeOrders, pastOrders, latestActive } = useMemo(() => {
    const active = [];
    const past   = [];
    const ACTIVE_STATUSES = new Set(['PendingPayment', 'Placed', 'Confirmed', 'Preparing', 'Ready']);

    for (const order of filteredOrders) {
      if (ACTIVE_STATUSES.has(order.status)) {
        active.push(order);
      } else {
        past.push(order);
      }
    }

    return { activeOrders: active, pastOrders: past, latestActive: active[0] || null };
  }, [filteredOrders]);

  const renderTimeline = (status) => {
    // Payment lifecycle → fulfilment lifecycle
    const isPendingPayment = status === 'PendingPayment';
    const steps = ['Confirmed', 'Preparing', 'Ready', 'Collected'];
    const currentIndex = steps.indexOf(status === 'Placed' ? 'Confirmed' : status);
    const isExpired   = status === 'Expired';
    const isCancelled = status === 'Cancelled';

    if (isPendingPayment) {
      return (
        <div className="order-timeline payment-pending-timeline" aria-label="Awaiting payment">
          <div className="pending-payment-indicator">
            <span className="spinner spinner-sm" aria-hidden="true" />
            <span>Awaiting payment confirmation…</span>
          </div>
        </div>
      );
    }

    return (
      <div className="order-timeline" aria-label={`Order status progress: ${status}`}>
        <div className="timeline-track">
          <div
            className={`timeline-progress ${isExpired || isCancelled ? 'progress-expired' : ''}`}
            style={{
              width: isExpired || isCancelled
                ? '100%'
                : `${(Math.max(0, currentIndex) / (steps.length - 1)) * 100}%`
            }}
          />
        </div>
        <div className="timeline-steps">
          {steps.map((step, idx) => {
            const isCompleted = !isExpired && !isCancelled && currentIndex >= idx;
            const isCurrent   = !isExpired && !isCancelled && currentIndex === idx;
            return (
              <div
                key={step}
                className={`timeline-step ${isCompleted ? 'step-completed' : ''} ${isCurrent ? 'step-current' : ''}`}
              >
                <div className="step-dot" />
                <span className="step-label">{step}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Order card renderer
  // ---------------------------------------------------------------------------
  const renderOrderCard = (order, isPast = false) => (
    <article
      key={order.id}
      className={`student-order-card ${isPast ? 'past-order-card' : ''} payment-status-${order.paymentStatus || 'unknown'}`}
    >
      <div className="order-card-header">
        <div>
          <span className="order-token-label">TOKEN</span>
          <h3 className="order-token-val">{order.token}</h3>
        </div>
        <div className="order-status-group">
          <StatusBadge status={order.status} />
          <PaymentBadge paymentStatus={order.paymentStatus} />
        </div>
      </div>

      {renderTimeline(order.status)}

      <div className="order-items-summary">
        {order.items.map((line, idx) => (
          <div key={idx} className="order-line-item">
            <span>{line.quantity}× {line.name}</span>
            <span className="order-line-price">
              ₹{(line.unitPrice * line.quantity).toLocaleString('en-IN')}
            </span>
          </div>
        ))}
      </div>

      {order.note && (
        <p className="order-note-display">
          <em>Kitchen Note:</em> {order.note}
        </p>
      )}

      {/* Pickup QR Code (only for confirmed paid orders) */}
      <PickupQRCard
        orderId={order.id}
        orderStatus={order.status}
        paymentStatus={order.paymentStatus}
      />

      <div className="order-card-footer">
        <div className="order-timing-info">
          <div>Placed: {formatDateTime(order.createdAt)}</div>
          {!isPast && order.pickupAt && (
            <div className="pickup-highlight">
              Pickup: ~{formatTime(order.pickupAt)}
            </div>
          )}
          {isPast && order.collectedAt && (
            <div className="collected-timestamp">
              Collected: {formatDateTime(order.collectedAt)}
            </div>
          )}
          {isPast && order.cancelledAt && (
            <div className="cancelled-timestamp text-danger">
              Cancelled: {formatDateTime(order.cancelledAt)}
            </div>
          )}
          {order.status === 'Expired' && (
            <div className="expired-timestamp text-danger">Expired (uncollected)</div>
          )}
        </div>
        <div className="order-card-total">
          ₹{order.totalAmount.toLocaleString('en-IN')}
        </div>
      </div>
    </article>
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="page-content orders-page">
      <section className="orders-header-row">
        <div>
          <span className="eyebrow-tag">ORDER TRACKING</span>
          <h1 className="hero-title">Where&apos;s my food?</h1>
          <p className="hero-subtitle">
            Follow your pre-orders live, or look one up by token number.
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
            placeholder="Search token, e.g. SC-108"
            value={tokenSearch}
            onChange={(e) => setTokenSearch(e.target.value)}
            aria-label="Filter orders by token"
          />
        </div>
      </section>

      {/* Hero Banner for Latest Active Order */}
      {latestActive && !tokenSearch && latestActive.status !== 'PendingPayment' && (
        <section className="hero-active-order-banner" aria-label="Latest pre-order status">
          <div className="hero-banner-status">
            <span className="hero-status-pill">
              ✓ Pre-order confirmed · {latestActive.status}
            </span>
          </div>

          <div className="hero-banner-content">
            <div className="hero-token-block">
              <span className="hero-token-caption">YOUR TOKEN</span>
              <h2 className="hero-token-display">{latestActive.token}</h2>
            </div>

            <div className="hero-pickup-block">
              <span className="hero-pickup-caption">PICKUP AROUND</span>
              <span className="hero-pickup-time">{formatTime(latestActive.pickupAt)}</span>
            </div>
          </div>

          <p className="hero-banner-footnote">
            Show this token at the counter. Placed at {formatTime(latestActive.createdAt)}.
            {latestActive.note && <span> · Note: &ldquo;{latestActive.note}&rdquo;</span>}
          </p>
        </section>
      )}

      {/* Pending payment banner */}
      {latestActive?.status === 'PendingPayment' && !tokenSearch && (
        <section className="alert-banner alert-warning pending-payment-banner" role="alert">
          <div className="spinner spinner-sm" aria-hidden="true" />
          <div>
            <strong>Payment Pending:</strong> Your order is waiting for payment confirmation.
            If you completed payment, it will be confirmed shortly.
          </div>
        </section>
      )}

      {orders.length === 0 ? (
        <div className="empty-state-box">
          <div className="empty-state-icon" aria-hidden="true">📋</div>
          <h2 className="empty-state-title">No orders placed yet</h2>
          <p className="empty-state-text">
            When you pre-order food, your token and live kitchen status will appear here.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setStudentView('menu')}
          >
            Go to Menu
          </button>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="empty-state-box">
          <div className="empty-state-icon" aria-hidden="true">🔍</div>
          <h2 className="empty-state-title">No orders found for &ldquo;{tokenSearch}&rdquo;</h2>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => setTokenSearch('')}
          >
            Clear search
          </button>
        </div>
      ) : (
        <>
          {/* Active Orders */}
          <section className="orders-section" aria-label="Active Orders">
            <h2 className="section-title">
              Active <span className="count-pill">{activeOrders.length}</span>
            </h2>
            {activeOrders.length === 0 ? (
              <p className="empty-section-hint">No active orders right now. Ready for lunch?</p>
            ) : (
              <div className="order-cards-grid">
                {activeOrders.map((order) => renderOrderCard(order, false))}
              </div>
            )}
          </section>

          {/* Past Orders */}
          <section className="orders-section past-orders-section" aria-label="Past Orders">
            <h2 className="section-title">
              Past orders <span className="count-pill">{pastOrders.length}</span>
            </h2>
            {pastOrders.length === 0 ? (
              <p className="empty-section-hint">No past orders in history.</p>
            ) : (
              <div className="order-cards-grid">
                {pastOrders.map((order) => renderOrderCard(order, true))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
