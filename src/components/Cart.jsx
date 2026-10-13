import React, { useState, useMemo } from 'react';
import FoodImage from './FoodImage.jsx';
import { useApp } from '../context/AppContext.jsx';
import { calculateEstimatedPickupTime, formatTime } from '../utils/dates.js';

export default function Cart() {
  const {
    cart,
    menuMap,
    orders,
    updateCartQuantity,
    removeFromCart,
    clearCart,
    placeOrder,
    setConfirmDialog,
    setStudentView
  } = useApp();

  const [kitchenNote, setKitchenNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Active queue ahead count (today's Placed or Preparing orders)
  const queueAheadCount = useMemo(() => {
    return orders.filter((o) => o.status === 'Placed' || o.status === 'Preparing').length;
  }, [orders]);

  // Map cart items with live menu data & check validity
  const { hydratedCart, hasInvalidItems, totalAmount, totalPortions, maxPrepItem } = useMemo(() => {
    let sumAmount = 0;
    let sumPortions = 0;
    let hasInvalid = false;
    let longestPrep = 5;

    const list = cart.map((c) => {
      const item = menuMap.get(c.itemId);
      const isAvailable = Boolean(item && item.available);
      if (!isAvailable) {
        hasInvalid = true;
      }

      const unitPrice = item ? item.price : 0;
      const rowTotal = unitPrice * c.quantity;
      sumAmount += rowTotal;
      sumPortions += c.quantity;

      if (item && item.prepTime > longestPrep) {
        longestPrep = item.prepTime;
      }

      return {
        ...c,
        item,
        isAvailable,
        unitPrice,
        rowTotal,
        name: item ? item.name : 'Unknown Dish (Deleted)',
        imageUrl: item ? item.imageUrl : '',
        prepTime: item ? item.prepTime : 5
      };
    });

    return {
      hydratedCart: list,
      hasInvalidItems: hasInvalid,
      totalAmount: sumAmount,
      totalPortions: sumPortions,
      maxPrepItem: longestPrep
    };
  }, [cart, menuMap]);

  // Calculate estimated pickup time
  const estimatedPickupTime = useMemo(() => {
    const iso = calculateEstimatedPickupTime(hydratedCart);
    return formatTime(iso);
  }, [hydratedCart]);

  const handleCheckoutClick = () => {
    if (cart.length === 0 || hasInvalidItems || isSubmitting) return;

    // Open in-app ConfirmDialog
    setConfirmDialog({
      title: 'Confirm Pre-Order',
      message: `Place pre-order for ${totalPortions} ${totalPortions === 1 ? 'item' : 'items'} (₹${totalAmount.toLocaleString('en-IN')})?`,
      details: (
        <div className="checkout-confirm-preview">
          <p><strong>Estimated Pickup:</strong> {estimatedPickupTime}</p>
          {kitchenNote && <p><strong>Kitchen Note:</strong> &ldquo;{kitchenNote}&rdquo;</p>}
          <p className="confirm-note">You will receive an instant token to show at the canteen counter.</p>
        </div>
      ),
      confirmText: `Place Order · ₹${totalAmount.toLocaleString('en-IN')}`,
      cancelText: 'Back to Tray',
      isDestructive: false,
      onConfirm: async () => {
        setIsSubmitting(true);
        try {
          await placeOrder(kitchenNote);
        } finally {
          setIsSubmitting(false);
        }
      }
    });
  };

  if (cart.length === 0) {
    return (
      <div className="page-content cart-page">
        <section className="cart-hero">
          <span className="eyebrow-tag">YOUR TRAY</span>
          <h1 className="hero-title">Review &amp; pre-order</h1>
        </section>

        <div className="empty-state-box">
          <div className="empty-state-icon" aria-hidden="true">🛒</div>
          <h2 className="empty-state-title">Your tray is empty</h2>
          <p className="empty-state-text">
            Add delicious dosas, thalis, or coffee to skip the counter queue.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setStudentView('menu')}
          >
            Browse menu
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content cart-page">
      <section className="cart-hero">
        <span className="eyebrow-tag">YOUR TRAY</span>
        <h1 className="hero-title">Review &amp; pre-order</h1>
        <p className="hero-subtitle">
          Adjust quantities, then confirm to get your pickup token.
        </p>
      </section>

      {hasInvalidItems && (
        <div className="alert-banner alert-warning" role="alert">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <strong>Unavailable Items in Tray:</strong> One or more dishes in your tray are currently sold out or removed from the menu. Please remove them before placing your order.
          </div>
        </div>
      )}

      <div className="cart-layout-grid">
        {/* Left Column: Tray Items */}
        <section className="cart-items-panel" aria-label="Selected food items">
          <div className="cart-items-card">
            <div className="cart-items-header">
              <h2 className="panel-title">Items in Tray ({totalPortions})</h2>
              <button
                type="button"
                className="btn-link text-danger"
                onClick={clearCart}
                aria-label="Clear all items from tray"
              >
                Clear tray
              </button>
            </div>

            <ul className="cart-items-list">
              {hydratedCart.map((row) => (
                <li
                  key={row.itemId}
                  className={`cart-item-row ${!row.isAvailable ? 'row-invalid' : ''}`}
                >
                  <div className="cart-item-media">
                    <FoodImage
                      src={row.imageUrl}
                      alt={row.name}
                      name={row.name}
                      className="cart-thumb"
                    />
                  </div>

                  <div className="cart-item-info">
                    <div className="cart-item-title-row">
                      <h3 className="cart-item-name">{row.name}</h3>
                      {!row.isAvailable && (
                        <span className="tag-soldout">Unavailable</span>
                      )}
                    </div>
                    <span className="cart-item-unit-price">
                      ₹{row.unitPrice.toLocaleString('en-IN')} each
                    </span>
                  </div>

                  <div className="cart-item-stepper">
                    <div className="qty-stepper" role="group" aria-label={`Quantity of ${row.name}`}>
                      <button
                        type="button"
                        className="qty-btn"
                        onClick={() => updateCartQuantity(row.itemId, -1)}
                        aria-label={`Decrease quantity of ${row.name}`}
                      >
                        −
                      </button>
                      <span className="qty-value" aria-live="polite">
                        {row.quantity}
                      </span>
                      <button
                        type="button"
                        className="qty-btn"
                        onClick={() => updateCartQuantity(row.itemId, 1)}
                        aria-label={`Increase quantity of ${row.name}`}
                        disabled={!row.isAvailable}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div className="cart-item-subtotal">
                    ₹{row.rowTotal.toLocaleString('en-IN')}
                  </div>

                  <button
                    type="button"
                    className="cart-remove-btn"
                    onClick={() => removeFromCart(row.itemId)}
                    aria-label={`Remove ${row.name} from tray`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Right Column: Order Summary & Checkout Card */}
        <aside className="cart-summary-panel" aria-label="Order summary">
          <div className="summary-card">
            <h2 className="summary-heading">Summary</h2>

            <div className="summary-line">
              <span className="summary-label">Items</span>
              <span className="summary-val">{totalPortions}</span>
            </div>

            <div className="summary-line">
              <span className="summary-label">Queue ahead</span>
              <span className="summary-val">{queueAheadCount} {queueAheadCount === 1 ? 'order' : 'orders'}</span>
            </div>

            <div className="summary-divider" />

            <div className="summary-line total-line">
              <span className="total-label">Total</span>
              <span className="total-amount">₹{totalAmount.toLocaleString('en-IN')}</span>
            </div>

            {/* Estimated Pickup Banner */}
            <div className="pickup-estimate-box">
              <div className="pickup-estimate-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <div className="pickup-estimate-content">
                <span className="pickup-caption">Estimated pickup</span>
                <span className="pickup-time-val">{estimatedPickupTime}</span>
              </div>
            </div>

            {/* Kitchen Note Input */}
            <div className="kitchen-note-wrapper">
              <label htmlFor="kitchen-note" className="input-label">
                Note for the kitchen (optional)
              </label>
              <textarea
                id="kitchen-note"
                rows="2"
                className="input-field note-textarea"
                placeholder="e.g. Less spicy, pack chutney separately..."
                value={kitchenNote}
                onChange={(e) => setKitchenNote(e.target.value)}
                maxLength={100}
              />
            </div>

            {/* Checkout Action Button */}
            <button
              type="button"
              className="btn btn-primary btn-block checkout-btn"
              disabled={hasInvalidItems || isSubmitting}
              onClick={handleCheckoutClick}
            >
              {isSubmitting ? 'Placing Order...' : `Place pre-order · ₹${totalAmount.toLocaleString('en-IN')}`}
            </button>

            <p className="summary-footer-note">
              Pay at the counter when you collect.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
