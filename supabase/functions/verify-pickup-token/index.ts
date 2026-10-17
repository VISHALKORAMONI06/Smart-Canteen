// =============================================================================
// Supabase Edge Function: verify-pickup-token
// Staff interface: verifies a QR/pickup token and marks order as Collected.
//
// Security:
//   - Validates Supabase JWT (staff/admin only)
//   - Role check is performed inside the DB function (SECURITY DEFINER)
//   - Token marked used atomically — duplicate scans rejected
//   - Never exposes other students' order info
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
    // 1. Validate staff JWT
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

    // 2. Parse request body
    const body = await req.json().catch(() => null);
    if (!body?.token || typeof body.token !== 'string') {
      return jsonError('token (pickup token string) is required', 400);
    }

    const pickupToken = body.token.trim().toLowerCase();
    if (!pickupToken) {
      return jsonError('token cannot be empty', 400);
    }

    // 3. Call verify_pickup_token RPC via service-role client
    // The RPC does: role check, token validation, order transition, audit log
    // Passing p_staff_id from verified JWT — not trusting client-sent ID
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });

    const { data: result, error: verifyError } = await adminClient.rpc('verify_pickup_token', {
      p_token:    pickupToken,
      p_staff_id: user.id  // verified from JWT, not from request body
    });

    if (verifyError) {
      const msg = verifyError.message || '';
      console.warn('[verify-pickup-token] RPC error:', msg);

      // Map RPC error codes to HTTP responses
      if (msg.includes('UNAUTHENTICATED'))    return jsonError('Authentication required', 401);
      if (msg.includes('FORBIDDEN'))          return jsonError('Only staff can verify pickup tokens', 403);
      if (msg.includes('TOKEN_INVALID'))      return jsonError('Invalid pickup token', 404);
      if (msg.includes('TOKEN_EXPIRED'))      return jsonError('This pickup token has expired', 410);
      if (msg.includes('TOKEN_USED'))         return jsonError('This order has already been collected', 409);
      if (msg.includes('ORDER_NOT_READY'))    return jsonError('This order is not ready for pickup yet', 422);

      return jsonError(`Verification failed: ${msg}`, 400);
    }

    // Note: no collection email is sent here.
    // The 'order_ready' email (sent when staff mark status = Ready) is the
    // correct and sufficient pickup notification. Sending another email at
    // collection time would confuse students ("order_cancelled" was the
    // previous incorrect type; no "order_collected" type exists in the schema).



    return jsonOk({
      success:       true,
      order_id:      result.order_id,
      token:         result.token,
      total_paise:   result.total_paise,
      collected_at:  result.collected_at,
      message:       `Order ${result.token} collected successfully`
    });

  } catch (err) {
    console.error('[verify-pickup-token] Unexpected error:', err);
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
