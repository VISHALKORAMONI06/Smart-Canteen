// =============================================================================
// Supabase Edge Function: verify-razorpay-payment
// Verifies a Razorpay payment signature server-side and confirms the order.
//
// Security:
//   - Validates Supabase JWT (student must be authenticated)
//   - HMAC-SHA256 signature verification using RAZORPAY_KEY_SECRET
//   - Only marks payment captured AFTER successful signature verification
//   - Calls confirm_payment_captured RPC (SECURITY DEFINER) atomically
//   - Never trusts frontend-reported success — always verify on server
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET')!;
const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonError('Method not allowed', 405);
  }

  try {
    // 1. Validate secrets
    if (!RAZORPAY_KEY_SECRET) {
      console.error('[verify-razorpay-payment] Missing RAZORPAY_KEY_SECRET');
      return jsonError('Payment verification not configured', 503);
    }

    // 2. Validate Supabase JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonError('Missing authentication token', 401);
    }
    const jwt = authHeader.replace('Bearer ', '');

    const userClient = createClient(SUPABASE_URL, jwt, {
      auth: { persistSession: false }
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return jsonError('Invalid or expired authentication token', 401);
    }

    // 3. Parse request body
    const body = await req.json().catch(() => null);
    if (!body) return jsonError('Invalid request body', 400);

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return jsonError(
        'razorpay_order_id, razorpay_payment_id, and razorpay_signature are required',
        400
      );
    }

    // 4. Server-side HMAC-SHA256 signature verification
    // Razorpay signature = HMAC-SHA256(razorpay_order_id + "|" + razorpay_payment_id, key_secret)
    const signaturePayload = `${razorpay_order_id}|${razorpay_payment_id}`;

    const encoder = new TextEncoder();
    const keyData = encoder.encode(RAZORPAY_KEY_SECRET);
    const msgData = encoder.encode(signaturePayload);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
    const expectedSignature = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Constant-time comparison to prevent timing attacks
    if (!constantTimeEqual(expectedSignature, razorpay_signature)) {
      console.warn('[verify-razorpay-payment] Signature mismatch. Possible tampered payment.');
      return jsonError('Payment verification failed: invalid signature', 400);
    }

    // 5. Signature is valid — confirm payment in DB atomically
    // Use service-role client to call SECURITY DEFINER RPC
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });

    const { data: confirmResult, error: confirmError } = await adminClient.rpc(
      'confirm_payment_captured',
      {
        p_razorpay_order_id:   razorpay_order_id,
        p_razorpay_payment_id: razorpay_payment_id,
        p_razorpay_signature:  razorpay_signature,
        p_student_id:          user.id
      }
    );

    if (confirmError) {
      console.error('[verify-razorpay-payment] confirm_payment_captured error:', confirmError.message);
      return jsonError(`Payment confirmation failed: ${confirmError.message}`, 500);
    }

    // 6. Trigger email dispatch (fire-and-forget, non-blocking)
    // Email function will check idempotency to avoid duplicates
    const emailUrl = `${SUPABASE_URL}/functions/v1/send-order-email`;
    fetch(emailUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        order_id:   confirmResult.order_id,
        student_id: user.id,
        email_type: 'order_confirmed'
      })
    }).catch((err) => {
      // Non-fatal: email failure must NOT affect order status
      console.error('[verify-razorpay-payment] Email trigger failed (non-fatal):', err);
    });

    return jsonOk({
      success:       true,
      order_id:      confirmResult.order_id,
      payment_id:    confirmResult.payment_id,
      status:        confirmResult.status,
      pickup_token:  confirmResult.pickup_token,
      idempotent_replay: confirmResult.idempotent_replay
    });

  } catch (err) {
    console.error('[verify-razorpay-payment] Unexpected error:', err);
    return jsonError('Internal server error', 500);
  }
});

/**
 * Constant-time string comparison to prevent timing attacks.
 * Both strings must be compared in full regardless of early mismatch.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function jsonOk(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
