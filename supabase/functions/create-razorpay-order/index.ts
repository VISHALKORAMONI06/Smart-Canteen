// =============================================================================
// Supabase Edge Function: create-razorpay-order
// Creates a Razorpay order server-side and records the pending payment.
//
// Security:
//   - Validates the Supabase JWT before doing anything
//   - Calls place_order RPC to get server-authoritative total (never trusts client amount)
//   - RAZORPAY_KEY_SECRET stays server-side only
//   - Only returns key_id (public) to the frontend — never the secret
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RAZORPAY_KEY_ID     = Deno.env.get('RAZORPAY_KEY_ID')!;
const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET')!;
const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    // 1. Validate secrets are configured
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      console.error('[create-razorpay-order] Missing Razorpay secrets');
      return jsonError('Payment gateway not configured', 503);
    }

    // 2. Extract and verify the Supabase JWT from Authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonError('Missing authentication token', 401);
    }
    const jwt = authHeader.replace('Bearer ', '');

    // Create user-scoped client to verify JWT
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

    const { cart_items, student_note, idempotency_key } = body;

    if (!cart_items || !Array.isArray(cart_items) || cart_items.length === 0) {
      return jsonError('cart_items must be a non-empty array', 400);
    }
    if (!idempotency_key || typeof idempotency_key !== 'string') {
      return jsonError('idempotency_key is required', 400);
    }

    // Validate each cart item shape (no price — server calculates)
    for (const item of cart_items) {
      if (!item.menu_item_id || typeof item.quantity !== 'number' || item.quantity < 1) {
        return jsonError('Each cart item must have menu_item_id and quantity >= 1', 400);
      }
    }

    // 4. Use service-role client for privileged DB operations
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });

    // 5. Call place_order RPC with user-scoped client (RLS enforced, auth.uid() works)
    const rpcClient = createClient(SUPABASE_URL, jwt, {
      auth: { persistSession: false }
    });

    const { data: orderData, error: orderError } = await rpcClient.rpc('place_order', {
      p_cart_items:       cart_items,
      p_student_note:     student_note || '',
      p_idempotency_key:  idempotency_key
    });

    if (orderError) {
      console.error('[create-razorpay-order] place_order error:', orderError.message);
      return jsonError(orderError.message, 400);
    }

    const { order_id, total_paise, idempotent_replay } = orderData;

    // 6. If replaying idempotent order, check if payment already exists
    if (idempotent_replay) {
      const { data: existingPayment } = await adminClient
        .from('payments')
        .select('razorpay_order_id, status, id')
        .eq('order_id', order_id)
        .single();

      if (existingPayment && existingPayment.status !== 'failed') {
        // Return existing Razorpay order for the checkout to resume
        return jsonOk({
          order_id,
          razorpay_order_id: existingPayment.razorpay_order_id,
          payment_id:        existingPayment.id,
          amount_paise:      total_paise,
          key_id:            RAZORPAY_KEY_ID,
          currency:          'INR',
          idempotent_replay: true
        });
      }
    }

    // 7. Create Razorpay order via server-side API
    // Amount MUST come from server (order.total_paise) — never client-supplied
    const rzpOrderPayload = {
      amount:   total_paise,  // authoritative server amount in paise
      currency: 'INR',
      receipt:  `sc_${order_id.substring(0, 8)}`,
      notes: {
        order_id,
        student_id: user.id
      }
    };

    const rzpAuth = btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`);
    const rzpResponse = await fetch('https://api.razorpay.com/v1/orders', {
      method:  'POST',
      headers: {
        'Authorization': `Basic ${rzpAuth}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify(rzpOrderPayload)
    });

    if (!rzpResponse.ok) {
      const rzpError = await rzpResponse.json().catch(() => ({}));
      console.error('[create-razorpay-order] Razorpay API error:', rzpError);
      return jsonError(`Payment gateway error: ${rzpError?.error?.description || 'Unknown error'}`, 502);
    }

    const rzpOrder = await rzpResponse.json();

    // 8. Record payment in DB (via SECURITY DEFINER RPC, service role client)
    const { data: paymentData, error: paymentError } = await adminClient.rpc('create_payment_record', {
      p_order_id:          order_id,
      p_student_id:        user.id,
      p_razorpay_order_id: rzpOrder.id,
      p_amount_paise:      total_paise,
      p_idempotency_key:   `pay_${idempotency_key}`
    });

    if (paymentError) {
      console.error('[create-razorpay-order] create_payment_record error:', paymentError.message);
      // Payment record failed but Razorpay order was created — log for reconciliation
      return jsonError('Payment record creation failed. Please contact support.', 500);
    }

    // 9. Return only public information to the frontend
    // NEVER return RAZORPAY_KEY_SECRET — only key_id is safe for browser use
    return jsonOk({
      order_id,
      razorpay_order_id: rzpOrder.id,
      payment_id:        paymentData.payment_id,
      amount_paise:      total_paise,
      key_id:            RAZORPAY_KEY_ID,  // public key — safe in browser
      currency:          'INR',
      idempotent_replay: false
    });

  } catch (err) {
    console.error('[create-razorpay-order] Unexpected error:', err);
    return jsonError('Internal server error', 500);
  }
});

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
