import React, { useState, useMemo } from 'react';
import StatusBadge from './StatusBadge.jsx';
import { useApp } from '../context/AppContext.jsx';
import { formatTime, formatDateTime } from '../utils/dates.js';

export default function OrdersPage() {
  const { orders, setStudentView } = useApp();
  const [tokenSearch, setTokenSearch] = useState('');

  // Filter orders by token search
  const filteredOrders = useMemo(() => {
    const q = tokenSearch.trim().toUpperCase();
    if (!q) return orders;
    return orders.filter((o) => o.token && o.token.toUpperCase().includes(q));
  }, [orders, tokenSearch]);

  // Separate active orders (Placed, Preparing, Ready) vs past (Collected, Expired)
  const { activeOrders, pastOrders, latestActive } = useMemo(() => {
    const active = [];
    const past = [];

    for (const order of filteredOrders) {
      if (order.status === 'Placed' || order.status === 'Preparing' || order.status === 'Ready') {
        active.push(order);
      } else {
        past.push(order);
      }
    }

    return {
      activeOrders: active,
      pastOrders: past,
      latestActive: active.length > 0 ? active[0] : null
    };
  }, [filteredOrders]);

  const renderTimeline = (status) => {
    const steps = ['Placed', 'Preparing', 'Ready', 'Collected'];
    const currentIndex = steps.indexOf(status);
    const isExpired = status === 'Expired';

    return (
      <div className="order-timeline" aria-label={`Order status progress: ${status}`}>
        <div className="timeline-track">
          <div
            className={`timeline-progress ${isExpired ? 'progress-expired' : ''}`}
            style={{
              width: isExpired ? '100%' : `${(Math.max(0, currentIndex) / (steps.length - 1)) * 100}%`
            }}
          />
        </div>
        <div className="timeline-steps">
          {steps.map((step, idx) => {
            const isCompleted = !isExpired && currentIndex >= idx;
            const isCurrent = !isExpired && currentIndex === idx;
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

      {/* Hero Banner for Latest Active Order (matches Screenshot 3) */}
      {latestActive && !tokenSearch && (
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
          {/* Active Orders Section */}
          <section className="orders-section" aria-label="Active Orders">
            <h2 className="section-title">
              Active <span className="count-pill">{activeOrders.length}</span>
            </h2>

            {activeOrders.length === 0 ? (
              <p className="empty-section-hint">No active orders right now. Ready for lunch?</p>
            ) : (
              <div className="order-cards-grid">
                {activeOrders.map((order) => (
                  <article key={order.id} className="student-order-card">
                    <div className="order-card-header">
                      <div>
                        <span className="order-token-label">TOKEN</span>
                        <h3 className="order-token-val">{order.token}</h3>
                      </div>
                      <StatusBadge status={order.status} />
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

                    <div className="order-card-footer">
                      <div className="order-timing-info">
                        <div>Placed: {formatDateTime(order.createdAt)}</div>
                        <div className="pickup-highlight">
                          Pickup: ~{formatTime(order.pickupAt)}
                        </div>
                      </div>
                      <div className="order-card-total">
                        ₹{order.totalAmount.toLocaleString('en-IN')}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Past Orders Section */}
          <section className="orders-section past-orders-section" aria-label="Past Orders">
            <h2 className="section-title">
              Past orders <span className="count-pill">{pastOrders.length}</span>
            </h2>

            {pastOrders.length === 0 ? (
              <p className="empty-section-hint">No past orders in history.</p>
            ) : (
              <div className="order-cards-grid">
                {pastOrders.map((order) => (
                  <article key={order.id} className="student-order-card past-order-card">
                    <div className="order-card-header">
                      <div>
                        <span className="order-token-label">TOKEN</span>
                        <h3 className="order-token-val">{order.token}</h3>
                      </div>
                      <StatusBadge status={order.status} />
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

                    <div className="order-card-footer">
                      <div className="order-timing-info">
                        <div>Placed: {formatDateTime(order.createdAt)}</div>
                        {order.collectedAt && (
                          <div className="collected-timestamp">
                            Collected: {formatDateTime(order.collectedAt)}
                          </div>
                        )}
                        {order.status === 'Expired' && (
                          <div className="expired-timestamp text-danger">
                            Expired (uncollected)
                          </div>
                        )}
                      </div>
                      <div className="order-card-total">
                        ₹{order.totalAmount.toLocaleString('en-IN')}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
