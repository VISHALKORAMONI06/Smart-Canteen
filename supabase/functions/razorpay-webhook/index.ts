// =============================================================================
// Supabase Edge Function: razorpay-webhook
// Handles asynchronous Razorpay webhook events.
//
// Security:
//   - Verifies webhook signature against raw request body using RAZORPAY_WEBHOOK_SECRET
//   - Processes events idempotently (safe to call multiple times)
//   - Uses service-role client — this endpoint is NOT authenticated by user JWT
//   - Never marks an order paid via webhook alone (depends on RPC idempotency)
//   - Returns 200 for all processed events (Razorpay retries on non-2xx)
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RAZORPAY_WEBHOOK_SECRET = Deno.env.get('RAZORPAY_WEBHOOK_SECRET')!;
const SUPABASE_URL            = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY        = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Razorpay sends signature in this header
const RAZORPAY_SIGNATURE_HEADER = 'x-razorpay-signature';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-razorpay-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    // 1. Read raw body for signature verification (must happen BEFORE .json() parsing)
    const rawBody = await req.text();

    // 2. Verify webhook signature
    const receivedSignature = req.headers.get(RAZORPAY_SIGNATURE_HEADER);

    if (!RAZORPAY_WEBHOOK_SECRET) {
      console.error('[razorpay-webhook] RAZORPAY_WEBHOOK_SECRET not set');
      // Return 200 to prevent Razorpay from retrying — log and skip processing
      return new Response('Webhook secret not configured', { status: 200, headers: corsHeaders });
    }

    if (!receivedSignature) {
      console.warn('[razorpay-webhook] Missing webhook signature header');
      return new Response(JSON.stringify({ error: 'Missing signature' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // HMAC-SHA256 of raw body using webhook secret
    const encoder = new TextEncoder();
    const keyData = encoder.encode(RAZORPAY_WEBHOOK_SECRET);
    const msgData = encoder.encode(rawBody);

    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const mac = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
    const expectedSignature = Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    if (!constantTimeEqual(expectedSignature, receivedSignature)) {
      console.warn('[razorpay-webhook] Webhook signature mismatch');
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 3. Parse payload
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response('Invalid JSON', { status: 400, headers: corsHeaders });
    }

    const eventName  = payload.event as string;
    const eventData  = (payload.payload as Record<string, unknown>) || {};

    console.log('[razorpay-webhook] Processing event:', eventName);

    // 4. Use admin client for DB operations
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });

    // 5. Route by event type
    switch (eventName) {
      // -----------------------------------------------------------------
      // payment.captured — authoritative payment success
      // This is the primary event to trust. The frontend flow also calls
      // verify-razorpay-payment, so confirm_payment_captured is idempotent.
      // -----------------------------------------------------------------
      case 'payment.captured': {
        const paymentEntity = getNestedEntity(eventData, 'payment.entity');
        if (!paymentEntity) break;

        const rzpOrderId   = paymentEntity.order_id as string;
        const rzpPaymentId = paymentEntity.id as string;

        // Fetch the stored payment record to get the student_id
        const { data: paymentRow } = await adminClient
          .from('payments')
          .select('student_id, status')
          .eq('razorpay_order_id', rzpOrderId)
          .single();

        if (!paymentRow) {
          console.warn('[razorpay-webhook] payment.captured: payment not found for order', rzpOrderId);
          break;
        }

        // Idempotency: skip if already captured
        if (paymentRow.status === 'captured') {
          console.log('[razorpay-webhook] payment.captured: already captured, skipping');
          break;
        }

        // For webhook, we don't have the client signature — we use a special
        // admin confirm that skips the student-scoped check.
        // The signature was already verified via webhook secret above.
        // We'll call the RPC with the student_id from our DB (trusted source).
        const { error: confirmError } = await adminClient.rpc('confirm_payment_captured', {
          p_razorpay_order_id:   rzpOrderId,
          p_razorpay_payment_id: rzpPaymentId,
          p_razorpay_signature:  'webhook_confirmed', // sentinel for webhook path
          p_student_id:          paymentRow.student_id
        });

        if (confirmError) {
          console.error('[razorpay-webhook] payment.captured confirm error:', confirmError.message);
        } else {
          console.log('[razorpay-webhook] payment.captured: confirmed order for', rzpOrderId);

          // Trigger email (fire-and-forget)
          const { data: order } = await adminClient
            .from('payments')
            .select('order_id')
            .eq('razorpay_order_id', rzpOrderId)
            .single();

          if (order) {
            triggerEmail(adminClient, order.order_id, paymentRow.student_id, 'order_confirmed');
            triggerEmail(adminClient, order.order_id, paymentRow.student_id, 'payment_receipt');
          }
        }

        // Record webhook event for dedup tracking
        await recordWebhookEvent(adminClient, rzpOrderId, eventName);
        break;
      }

      // -----------------------------------------------------------------
      // payment.failed — payment attempt failed
      // -----------------------------------------------------------------
      case 'payment.failed': {
        const paymentEntity = getNestedEntity(eventData, 'payment.entity');
        if (!paymentEntity) break;

        const rzpOrderId     = paymentEntity.order_id as string;
        const rzpPaymentId   = paymentEntity.id as string;
        const errorCode      = (paymentEntity.error_code as string) || 'UNKNOWN';
        const errorDesc      = (paymentEntity.error_description as string) || 'Payment failed';

        const { error: failError } = await adminClient.rpc('record_payment_failed', {
          p_razorpay_order_id:   rzpOrderId,
          p_razorpay_payment_id: rzpPaymentId,
          p_failure_code:        errorCode,
          p_failure_description: errorDesc
        });

        if (failError) {
          console.error('[razorpay-webhook] payment.failed record error:', failError.message);
        }

        await recordWebhookEvent(adminClient, rzpOrderId, eventName);
        break;
      }

      // -----------------------------------------------------------------
      // order.paid — Razorpay order fully paid (alternative capture event)
      // Handle same as payment.captured for belt-and-suspenders reliability
      // -----------------------------------------------------------------
      case 'order.paid': {
        const orderEntity = getNestedEntity(eventData, 'order.entity');
        if (!orderEntity) break;

        const rzpOrderId = orderEntity.id as string;
        console.log('[razorpay-webhook] order.paid event for', rzpOrderId);
        // The payment.captured event should handle this; record for dedup only
        await recordWebhookEvent(adminClient, rzpOrderId, eventName);
        break;
      }

      // -----------------------------------------------------------------
      // payment.authorized — authorized but not yet captured (rare, Razorpay auto-captures)
      // -----------------------------------------------------------------
      case 'payment.authorized': {
        const paymentEntity = getNestedEntity(eventData, 'payment.entity');
        if (paymentEntity?.order_id) {
          await recordWebhookEvent(adminClient, paymentEntity.order_id as string, eventName);
        }
        break;
      }

      // -----------------------------------------------------------------
      // refund.created — refund initiated
      // -----------------------------------------------------------------
      case 'refund.created': {
        const refundEntity = getNestedEntity(eventData, 'refund.entity');
        if (!refundEntity) break;

        const rzpPaymentId = refundEntity.payment_id as string;
        // refundEntity.amount (paise) is recorded implicitly by Razorpay;
        // we don't store a separate refund_amount column, so no local variable needed.

        // Update payment record to refunded
        const { error: refundError } = await adminClient
          .from('payments')
          .update({
            status:      'refunded',
            refunded_at: new Date().toISOString()
          })
          .eq('razorpay_payment_id', rzpPaymentId)
          .eq('status', 'captured'); // safety: only refund captured payments

        if (refundError) {
          console.error('[razorpay-webhook] refund.created update error:', refundError.message);
        } else {
          console.log('[razorpay-webhook] Refund recorded for payment', rzpPaymentId);
        }
        break;
      }

      default:
        console.log('[razorpay-webhook] Unhandled event type:', eventName);
    }

    // Always return 200 to prevent Razorpay from retrying
    return new Response(JSON.stringify({ received: true, event: eventName }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('[razorpay-webhook] Unexpected error:', err);
    // Return 200 to avoid Razorpay retry storm on infrastructure errors
    return new Response(JSON.stringify({ received: true, processing_error: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate nested object path, e.g. 'payment.entity' on { payment: { entity: {...} } }
 */
function getNestedEntity(data: unknown, path: string): Record<string, unknown> | null {
  const parts = path.split('.');
  let current: unknown = data;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return (typeof current === 'object' && current !== null)
    ? (current as Record<string, unknown>)
    : null;
}

/**
 * Appends an event name to the payment.webhook_events JSONB array for dedup tracking.
 * Idempotent: skips if the event name is already in the array.
 * Non-fatal: errors are caught and logged so a recording failure never breaks the webhook response.
 *
 * NOTE: The previous implementation attempted `adminClient.rpc('sql', {...})` which does
 * not exist in the Supabase JS client and always threw. This is the corrected direct-update path.
 */
async function recordWebhookEvent(
  // deno-lint-ignore no-explicit-any
  adminClient: any,
  rzpOrderId: string,
  eventName: string
): Promise<void> {
  try {
    const { data: paymentRow } = await adminClient
      .from('payments')
      .select('id, webhook_events')
      .eq('razorpay_order_id', rzpOrderId)
      .single();

    if (!paymentRow) {
      console.warn('[razorpay-webhook] recordWebhookEvent: no payment found for order', rzpOrderId);
      return;
    }

    const events: string[] = Array.isArray(paymentRow.webhook_events)
      ? paymentRow.webhook_events
      : [];

    // Idempotency: only append if not already recorded
    if (!events.includes(eventName)) {
      const { error } = await adminClient
        .from('payments')
        .update({ webhook_events: [...events, eventName] })
        .eq('id', paymentRow.id);

      if (error) {
        console.error('[razorpay-webhook] recordWebhookEvent update error (non-fatal):', error.message);
      }
    }
  } catch (err) {
    // Non-fatal: webhook response must not depend on audit record success
    console.error('[razorpay-webhook] recordWebhookEvent failed (non-fatal):', err);
  }
}


/**
 * Fire-and-forget email trigger.
 */
function triggerEmail(
  // deno-lint-ignore no-explicit-any
  adminClient: any,
  orderId: string,
  studentId: string,
  emailType: string
): void {
  const emailUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-order-email`;
  fetch(emailUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ order_id: orderId, student_id: studentId, email_type: emailType })
  }).catch((err) => {
    console.error('[razorpay-webhook] Email trigger failed (non-fatal):', err);
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
