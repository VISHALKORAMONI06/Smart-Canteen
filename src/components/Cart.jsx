import React, { useState, useMemo, useCallback } from 'react';
import FoodImage from './FoodImage.jsx';
import { useApp } from '../context/AppContext.jsx';
import { calculateEstimatedPickupTime, formatTime } from '../utils/dates.js';
import { isSupabaseConfigured } from '../lib/supabaseClient.js';
import {
  createRazorpayOrder,
  openRazorpayCheckout
} from '../services/paymentService.js';

// ---------------------------------------------------------------------------
// Payment status constants
// ---------------------------------------------------------------------------
const PAYMENT_STAGE = {
  IDLE:         'idle',
  CREATING:     'creating',      // calling create-razorpay-order edge function
  CHECKOUT:     'checkout',      // Razorpay modal is open
  VERIFYING:    'verifying',     // calling verify-razorpay-payment edge function
  SUCCESS:      'success',       // payment verified and order confirmed
  FAILED:       'failed',        // payment failed or rejected
  CANCELLED:    'cancelled'      // user dismissed the modal
};

export default function Cart() {
  const {
    cart,
    menuMap,
    orders,
    updateCartQuantity,
    removeFromCart,
    clearCart,
    setStudentView,
    addToast,
    user,
    profile
  } = useApp();

  const [kitchenNote, setKitchenNote]       = useState('');
  const [paymentStage, setPaymentStage]     = useState(PAYMENT_STAGE.IDLE);
  const [paymentError, setPaymentError]     = useState(null);
  const [confirmedOrder, setConfirmedOrder] = useState(null);
  const [isSubmitting, setIsSubmitting]     = useState(false);

  // Active queue ahead count
  const queueAheadCount = useMemo(() =>
    orders.filter((o) => o.status === 'Placed' || o.status === 'Preparing').length,
  [orders]);

  // Hydrate cart with live menu data
  const { hydratedCart, hasInvalidItems, totalAmount, totalPortions } = useMemo(() => {
    let sumAmount   = 0;
    let sumPortions = 0;
    let hasInvalid  = false;

    const list = cart.map((c) => {
      const item        = menuMap.get(c.itemId);
      const isAvailable = Boolean(item && item.available);
      if (!isAvailable) hasInvalid = true;

      const unitPrice = item ? item.price : 0;
      const rowTotal  = unitPrice * c.quantity;
      sumAmount   += rowTotal;
      sumPortions += c.quantity;

      return {
        ...c,
        item,
        isAvailable,
        unitPrice,
        rowTotal,
        name:     item ? item.name     : 'Unknown Dish (Deleted)',
        imageUrl: item ? item.imageUrl : '',
        prepTime: item ? item.prepTime : 5
      };
    });

    return { hydratedCart: list, hasInvalidItems: hasInvalid, totalAmount: sumAmount, totalPortions: sumPortions };
  }, [cart, menuMap]);

  // Estimated pickup time display
  const estimatedPickupTime = useMemo(() =>
    formatTime(calculateEstimatedPickupTime(hydratedCart)),
  [hydratedCart]);

  // ---------------------------------------------------------------------------
  // Checkout handler — full Razorpay payment flow
  // ---------------------------------------------------------------------------
  const handleCheckout = useCallback(async () => {
    if (cart.length === 0 || hasInvalidItems || isSubmitting) return;
    if (paymentStage !== PAYMENT_STAGE.IDLE && paymentStage !== PAYMENT_STAGE.CANCELLED && paymentStage !== PAYMENT_STAGE.FAILED) return;

    setIsSubmitting(true);
    setPaymentError(null);
    setPaymentStage(PAYMENT_STAGE.CREATING);

    try {
      // Build cart payload (server fetches authoritative prices)
      const cartPayload = cart.map((item) => ({
        menu_item_id: item.itemId,
        quantity:     item.quantity
      }));

      // Generate idempotency key for this checkout attempt
      const idempotencyKey = typeof crypto !== 'undefined'
        ? crypto.randomUUID()
        : `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      // Step 1: Create Razorpay order on server
      const { data: orderData, error: orderError } = await createRazorpayOrder({
        cartItems:      cartPayload,
        studentNote:    kitchenNote.trim(),
        idempotencyKey
      });

      if (orderError) {
        const userMsg = parsePaymentError(orderError.message);
        setPaymentError(userMsg);
        setPaymentStage(PAYMENT_STAGE.FAILED);
        setIsSubmitting(false);
        return;
      }

      const {
        order_id,
        razorpay_order_id,
        amount_paise,
        key_id,
        currency
      } = orderData;

      setPaymentStage(PAYMENT_STAGE.CHECKOUT);

      // Step 2: Open Razorpay Checkout modal
      // onSuccess fires AFTER server verification inside paymentService.openRazorpayCheckout()
      const paymentResult = await openRazorpayCheckout({
        razorpayOrderId: razorpay_order_id,
        amountPaise:     amount_paise,
        currency,
        keyId:           key_id,
        prefillName:     profile?.display_name || '',
        prefillEmail:    user?.email           || '',
        orderId:         order_id,

        onSuccess: (verifiedData) => {
          // This callback fires after server-side HMAC verification succeeded
          setPaymentStage(PAYMENT_STAGE.SUCCESS);
          setConfirmedOrder({
            orderId:      order_id,
            pickupToken:  verifiedData.pickup_token,
            totalAmount,
            token:        null // will be fetched from orders list
          });
          clearCart();
          addToast('Payment confirmed! Your order is being prepared.', 'success');
          // Navigate to orders after brief delay
          setTimeout(() => setStudentView('orders'), 1500);
        },

        onFailure: (err) => {
          const userMsg = parsePaymentError(err.message);
          setPaymentError(userMsg);
          setPaymentStage(PAYMENT_STAGE.FAILED);
        },

        onDismiss: () => {
          setPaymentStage(PAYMENT_STAGE.CANCELLED);
        }
      });

    } catch (err) {
      const userMsg = parsePaymentError(err?.message || '');
      setPaymentError(userMsg);
      setPaymentStage(PAYMENT_STAGE.FAILED);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    cart, hasInvalidItems, isSubmitting, paymentStage,
    kitchenNote, totalAmount, profile, user,
    clearCart, addToast, setStudentView
  ]);

  const handleRetry = useCallback(() => {
    setPaymentStage(PAYMENT_STAGE.IDLE);
    setPaymentError(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Loading / processing overlay
  // ---------------------------------------------------------------------------
  const isProcessing = paymentStage === PAYMENT_STAGE.CREATING ||
                       paymentStage === PAYMENT_STAGE.VERIFYING;

  // ---------------------------------------------------------------------------
  // Payment state messages
  // ---------------------------------------------------------------------------
  const getCheckoutBtnLabel = () => {
    switch (paymentStage) {
      case PAYMENT_STAGE.CREATING:   return '⏳ Opening payment…';
      case PAYMENT_STAGE.CHECKOUT:   return '⏳ Complete payment in popup…';
      case PAYMENT_STAGE.VERIFYING:  return '⏳ Verifying payment…';
      case PAYMENT_STAGE.SUCCESS:    return '✅ Payment confirmed!';
      default:
        return isSupabaseConfigured
          ? `Pay ₹${totalAmount.toLocaleString('en-IN')} via Razorpay`
          : `Place pre-order · ₹${totalAmount.toLocaleString('en-IN')}`;
    }
  };

  // ---------------------------------------------------------------------------
  // Empty cart state
  // ---------------------------------------------------------------------------
  if (cart.length === 0 && paymentStage !== PAYMENT_STAGE.SUCCESS) {
    return (
      <div className="page-content cart-page">
        <section className="cart-hero">
          <span className="eyebrow-tag">YOUR TRAY</span>
          <h1 className="hero-title">Review &amp; checkout</h1>
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

  // ---------------------------------------------------------------------------
  // Payment success confirmation screen
  // ---------------------------------------------------------------------------
  if (paymentStage === PAYMENT_STAGE.SUCCESS && confirmedOrder) {
    return (
      <div className="page-content cart-page">
        <div className="payment-success-screen">
          <div className="payment-success-icon" aria-hidden="true">✅</div>
          <h1 className="payment-success-title">Payment Confirmed!</h1>
          <p className="payment-success-subtitle">
            Your order is now being prepared.
          </p>
          {confirmedOrder.pickupToken && (
            <div className="pickup-token-box">
              <div className="pickup-token-label">PICKUP TOKEN</div>
              <div className="pickup-token-qr" aria-label="QR Code placeholder">
                {/* QR Code: using the token text as a visual indicator */}
                <QRCodeDisplay token={confirmedOrder.pickupToken} />
              </div>
              <div className="pickup-token-hint">
                Show this QR code at the counter when collecting your order.
              </div>
            </div>
          )}
          <div className="payment-success-amount">
            Total paid: <strong>₹{confirmedOrder.totalAmount.toLocaleString('en-IN')}</strong>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setStudentView('orders')}
          >
            Track my order →
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main cart view
  // ---------------------------------------------------------------------------
  return (
    <div className="page-content cart-page">
      <section className="cart-hero">
        <span className="eyebrow-tag">YOUR TRAY</span>
        <h1 className="hero-title">Review &amp; checkout</h1>
        <p className="hero-subtitle">
          Adjust quantities, then pay securely via Razorpay.
        </p>
      </section>

      {/* Unavailable items warning */}
      {hasInvalidItems && (
        <div className="alert-banner alert-warning" role="alert">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <strong>Unavailable Items in Tray:</strong> One or more dishes are currently sold out.
            Please remove them before checking out.
          </div>
        </div>
      )}

      {/* Payment error banner */}
      {paymentError && (paymentStage === PAYMENT_STAGE.FAILED || paymentStage === PAYMENT_STAGE.CANCELLED) && (
        <div className="alert-banner alert-danger" role="alert">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <div>
            <strong>{paymentStage === PAYMENT_STAGE.CANCELLED ? 'Payment Cancelled' : 'Payment Failed'}:</strong>{' '}
            {paymentError}
            {' '}
            <button
              type="button"
              className="btn-link text-danger"
              onClick={handleRetry}
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {/* Payment processing overlay */}
      {isProcessing && (
        <div className="payment-processing-banner" role="status" aria-live="polite">
          <div className="spinner spinner-sm" aria-hidden="true" />
          <span>
            {paymentStage === PAYMENT_STAGE.CREATING
              ? 'Creating secure payment session…'
              : 'Verifying payment with server…'}
          </span>
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
                disabled={isProcessing || paymentStage === PAYMENT_STAGE.CHECKOUT}
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
                        disabled={isProcessing || paymentStage === PAYMENT_STAGE.CHECKOUT}
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
                        disabled={!row.isAvailable || isProcessing || paymentStage === PAYMENT_STAGE.CHECKOUT}
                        aria-label={`Increase quantity of ${row.name}`}
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
                    disabled={isProcessing || paymentStage === PAYMENT_STAGE.CHECKOUT}
                    aria-label={`Remove ${row.name} from tray`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Right Column: Order Summary & Checkout */}
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

            {/* Kitchen Note */}
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
                maxLength={200}
                disabled={isProcessing || paymentStage === PAYMENT_STAGE.CHECKOUT}
              />
            </div>

            {/* Payment method info */}
            {isSupabaseConfigured && (
              <div className="payment-method-info">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                  <line x1="1" y1="10" x2="23" y2="10" />
                </svg>
                <span>Pay securely via Razorpay (UPI, Card, NetBanking)</span>
              </div>
            )}

            {/* Checkout Action Button */}
            <button
              id="checkout-pay-btn"
              type="button"
              className={`btn btn-primary btn-block checkout-btn ${
                paymentStage === PAYMENT_STAGE.SUCCESS ? 'btn-success' : ''
              }`}
              disabled={
                hasInvalidItems ||
                isProcessing ||
                paymentStage === PAYMENT_STAGE.CHECKOUT ||
                paymentStage === PAYMENT_STAGE.SUCCESS ||
                cart.length === 0
              }
              onClick={handleCheckout}
              aria-busy={isProcessing}
              aria-live="polite"
            >
              {isProcessing && <span className="spinner spinner-xs" aria-hidden="true" />}
              {getCheckoutBtnLabel()}
            </button>

            {!isSupabaseConfigured && (
              <p className="summary-footer-note">
                Demo mode — no actual payment will be charged.
              </p>
            )}

            {isSupabaseConfigured && (
              <p className="summary-footer-note">
                🔒 Secured by Razorpay · PCI DSS Compliant
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Simple QR code visual using a CSS-based pattern (no external library)
// For production, integrate a proper QR library (e.g. qrcode.react)
// ---------------------------------------------------------------------------
function QRCodeDisplay({ token }) {
  // Generate a simple visual representation — in production use a real QR library
  const shortToken = token ? token.substring(0, 8).toUpperCase() : '';

  return (
    <div className="qr-code-placeholder" aria-label={`Pickup token: ${token}`}>
      <div className="qr-grid">
        {/* Visual QR pattern grid based on token hash */}
        {Array.from({ length: 25 }).map((_, i) => {
          const charCode = token ? token.charCodeAt(i % token.length) : 0;
          const filled = (charCode ^ (i * 7)) % 3 !== 0;
          return (
            <div
              key={i}
              className={`qr-cell ${filled ? 'qr-cell-filled' : ''}`}
            />
          );
        })}
      </div>
      <div className="qr-token-text">{shortToken}…</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parse payment error messages into user-friendly strings
// ---------------------------------------------------------------------------
function parsePaymentError(message) {
  const msg = message || '';
  if (msg.includes('PAYMENT_CANCELLED'))    return 'Payment was cancelled. Your order was not placed.';
  if (msg.includes('PAYMENT_FAILED'))       return msg.replace('PAYMENT_FAILED: ', '') || 'Payment failed. Please try again.';
  if (msg.includes('UNAUTHENTICATED'))      return 'You must be signed in to place an order.';
  if (msg.includes('CANTEEN_CLOSED'))       return 'The canteen is not accepting orders right now.';
  if (msg.includes('OUTSIDE_HOURS'))        return 'Orders can only be placed during canteen hours.';
  if (msg.includes('EMPTY_CART'))           return 'Your cart is empty.';
  if (msg.includes('ITEM_UNAVAILABLE'))     return msg.split('ITEM_UNAVAILABLE: ')[1] || 'An item in your cart is unavailable.';
  if (msg.includes('ITEM_NOT_FOUND'))       return 'One or more items no longer exist on the menu.';
  if (msg.includes('OUT_OF_STOCK'))         return msg.split('OUT_OF_STOCK: ')[1] || 'An item is out of stock.';
  if (msg.includes('INSUFFICIENT_STOCK'))   return 'Insufficient stock for one or more items.';
  if (msg.includes('Payment gateway'))      return msg;
  if (msg.includes('verification failed'))  return 'Payment verification failed. If money was deducted, it will be refunded.';
  if (msg.includes('Failed to load Razorpay')) return 'Could not load the payment page. Check your internet connection.';
  return msg || 'An unexpected error occurred. Please try again.';
}
