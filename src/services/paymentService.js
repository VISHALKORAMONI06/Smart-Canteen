/**
 * paymentService.js — Razorpay payment integration for SmartCanteen.
 *
 * Flow:
 *  1. createRazorpayOrder()  → calls Edge Function to create Razorpay order + DB record
 *  2. openRazorpayCheckout() → opens Razorpay Checkout modal
 *  3. verifyPayment()        → calls Edge Function to verify HMAC signature server-side
 *
 * Security:
 *  - The KEY_SECRET is NEVER in this file — it lives in the Edge Function only
 *  - key_id (public) is returned by the Edge Function and used here
 *  - Client-side total is never trusted — server always recalculates
 *  - Verification is done server-side in verify-razorpay-payment Edge Function
 */
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js';

// ---------------------------------------------------------------------------
// Load Razorpay Checkout script dynamically (lazy — only loaded at checkout time)
// ---------------------------------------------------------------------------
let razorpayScriptPromise = null;

function loadRazorpayScript() {
  if (razorpayScriptPromise) return razorpayScriptPromise;

  razorpayScriptPromise = new Promise((resolve, reject) => {
    if (window.Razorpay) {
      resolve(window.Razorpay);
      return;
    }

    const script = document.createElement('script');
    script.src     = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async   = true;
    script.onload  = () => resolve(window.Razorpay);
    script.onerror = () => {
      razorpayScriptPromise = null; // allow retry
      reject(new Error('Failed to load Razorpay Checkout script. Check your network connection.'));
    };
    document.head.appendChild(script);
  });

  return razorpayScriptPromise;
}

// ---------------------------------------------------------------------------
// Step 1: Create Razorpay order on the server
// Returns: { order_id, razorpay_order_id, payment_id, amount_paise, key_id, currency }
// ---------------------------------------------------------------------------
export async function createRazorpayOrder({ cartItems, studentNote, idempotencyKey }) {
  if (!isSupabaseConfigured || !supabase) {
    return { data: null, error: new Error('Supabase not configured') };
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { data: null, error: new Error('You must be signed in to place an order.') };
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const endpoint    = `${supabaseUrl}/functions/v1/create-razorpay-order`;

  try {
    const response = await fetch(endpoint, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        cart_items:       cartItems,
        student_note:     studentNote || '',
        idempotency_key:  idempotencyKey
      })
    });

    const responseData = await response.json();

    if (!response.ok) {
      return {
        data:  null,
        error: new Error(responseData.error || `Order creation failed (${response.status})`)
      };
    }

    return { data: responseData, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

// ---------------------------------------------------------------------------
// Step 2: Open Razorpay Checkout modal
// Returns a Promise that resolves with payment details or rejects on cancel/failure
// ---------------------------------------------------------------------------
export async function openRazorpayCheckout({
  razorpayOrderId,
  amountPaise,
  currency,
  keyId,
  prefillName,
  prefillEmail,
  orderId,
  onSuccess,
  onFailure,
  onDismiss
}) {
  await loadRazorpayScript();

  if (!window.Razorpay) {
    throw new Error('Razorpay Checkout could not be loaded.');
  }

  return new Promise((resolve, reject) => {
    const options = {
      key:         keyId,           // public key — safe in browser
      amount:      amountPaise,     // in paise (authoritative from server)
      currency:    currency || 'INR',
      name:        'SmartCanteen',
      description: `Order ${orderId ? orderId.substring(0, 8) : ''}`,
      order_id:    razorpayOrderId, // Razorpay order ID from server

      prefill: {
        name:  prefillName  || '',
        email: prefillEmail || '',
        // Note: UPI/contact info NOT prefilled — no PII collection beyond email
      },

      theme: {
        color: '#ff6b35'
      },

      // Handler: called by Razorpay on successful payment
      // NOTE: This is client-side — we still verify on the server before trusting it
      handler: async (response) => {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = response;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
          const err = new Error('Incomplete payment response from Razorpay.');
          if (onFailure) onFailure(err);
          reject(err);
          return;
        }

        try {
          // Server-side signature verification (CRITICAL)
          const verifyResult = await verifyPayment({
            razorpayOrderId:   razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id,
            razorpaySignature: razorpay_signature
          });

          if (verifyResult.error) {
            if (onFailure) onFailure(verifyResult.error);
            reject(verifyResult.error);
            return;
          }

          if (onSuccess) onSuccess(verifyResult.data);
          resolve(verifyResult.data);
        } catch (err) {
          if (onFailure) onFailure(err);
          reject(err);
        }
      },

      // Dismiss: called when user closes the modal without completing payment
      modal: {
        ondismiss: () => {
          const cancelError = new Error('PAYMENT_CANCELLED: Payment was cancelled by the user.');
          if (onDismiss) onDismiss();
          reject(cancelError);
        },
        animation: true,
        confirm_close: true,
        escape: false
      }
    };

    const rzp = new window.Razorpay(options);

    // Handle payment failure events (network errors, bank decline, etc.)
    rzp.on('payment.failed', (response) => {
      const error = new Error(
        `PAYMENT_FAILED: ${response.error?.description || 'Payment failed'}`
      );
      error.code        = response.error?.code;
      error.description = response.error?.description;
      error.field       = response.error?.field;

      if (onFailure) onFailure(error);
      reject(error);
    });

    rzp.open();
  });
}

// ---------------------------------------------------------------------------
// Step 3: Verify payment on the server (CRITICAL security step)
// The frontend never trusts its own success — server verifies HMAC signature
// ---------------------------------------------------------------------------
export async function verifyPayment({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  if (!isSupabaseConfigured || !supabase) {
    return { data: null, error: new Error('Supabase not configured') };
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { data: null, error: new Error('Authentication required for payment verification.') };
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const endpoint    = `${supabaseUrl}/functions/v1/verify-razorpay-payment`;

  try {
    const response = await fetch(endpoint, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        razorpay_order_id:   razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature:  razorpaySignature
      })
    });

    const responseData = await response.json();

    if (!response.ok) {
      return {
        data:  null,
        error: new Error(responseData.error || `Payment verification failed (${response.status})`)
      };
    }

    return { data: responseData, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

// ---------------------------------------------------------------------------
// Fetch pickup token for an order (for QR display in student view)
// ---------------------------------------------------------------------------
export async function fetchPickupToken(orderId) {
  if (!isSupabaseConfigured || !supabase) return { data: null, error: null };

  const { data, error } = await supabase
    .from('pickup_tokens')
    .select('token, expires_at, used')
    .eq('order_id', orderId)
    .single();

  return { data, error };
}

// ---------------------------------------------------------------------------
// Staff: verify a pickup token (delegates to edge function)
// ---------------------------------------------------------------------------
export async function verifyPickupToken(token) {
  if (!isSupabaseConfigured || !supabase) {
    return { data: null, error: new Error('Supabase not configured') };
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { data: null, error: new Error('Authentication required.') };
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const endpoint    = `${supabaseUrl}/functions/v1/verify-pickup-token`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token })
    });

    const responseData = await response.json();

    if (!response.ok) {
      return {
        data:  null,
        error: new Error(responseData.error || `Verification failed (${response.status})`)
      };
    }

    return { data: responseData, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

// ---------------------------------------------------------------------------
// Fetch analytics from the server (staff/admin only)
// ---------------------------------------------------------------------------
export async function fetchAnalytics({ fromDate, toDate } = {}) {
  if (!isSupabaseConfigured || !supabase) return { data: null, error: null };

  const { data, error } = await supabase.rpc('get_analytics', {
    p_from_date: fromDate || null,
    p_to_date:   toDate   || null
  });

  return { data, error };
}
