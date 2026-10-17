// =============================================================================
// Supabase Edge Function: send-order-email
// Sends transactional emails via Resend.
//
// Security:
//   - Called only from trusted backend code (webhook, verify-payment functions)
//   - Uses service-role client for DB access
//   - Idempotent: checks email_notifications table before sending
//   - Never called from browser directly (no CORS user-facing exposure needed)
//   - RESEND_API_KEY stays server-side only
//
// Required secrets:
//   RESEND_API_KEY        — from resend.com
//   RESEND_FROM_EMAIL     — verified sender address e.g. noreply@yourdomain.com
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY    = Deno.env.get('RESEND_API_KEY');
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'SmartCanteen <noreply@smartcanteen.app>';
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface EmailRequest {
  order_id:   string;
  student_id: string;
  email_type: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonError('Method not allowed', 405);
  }

  try {
    // 1. Parse request
    const body: EmailRequest = await req.json().catch(() => null);
    if (!body?.order_id || !body?.student_id || !body?.email_type) {
      return jsonError('order_id, student_id, and email_type are required', 400);
    }

    const { order_id, student_id, email_type } = body;

    // 2. Admin client
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });

    // 3. Idempotency check: has this email already been sent/queued successfully?
    const { data: existingNotif } = await adminClient
      .from('email_notifications')
      .select('id, status, attempts')
      .eq('order_id', order_id)
      .eq('email_type', email_type)
      .single();

    if (existingNotif?.status === 'sent' || existingNotif?.status === 'skipped') {
      console.log(`[send-order-email] Email already ${existingNotif.status} for order ${order_id}, type ${email_type}`);
      return jsonOk({ skipped: true, reason: `already_${existingNotif.status}` });
    }

    // Check retry limit
    if (existingNotif?.status === 'failed' && (existingNotif.attempts || 0) >= 3) {
      console.warn(`[send-order-email] Max retries reached for order ${order_id}, type ${email_type}`);
      return jsonOk({ skipped: true, reason: 'max_retries' });
    }

    // 4. Fetch order details for email content
    const { data: order, error: orderError } = await adminClient
      .from('orders')
      .select(`
        id, token, status, total_paise, student_note,
        created_at, estimated_pickup, payment_status,
        order_items (item_name, quantity, unit_price_paise, line_total_paise),
        profiles!orders_student_id_fkey (display_name)
      `)
      .eq('id', order_id)
      .single();

    if (orderError || !order) {
      console.error('[send-order-email] Order not found:', order_id);
      return jsonError('Order not found', 404);
    }

    // 5. Get student email from auth.users (single-user lookup — never fetches all users)
    const { data: { user: studentUser } } = await adminClient.auth.admin.getUserById(student_id);
    const recipientEmail = studentUser?.email;

    if (!recipientEmail) {
      console.error('[send-order-email] No email for student:', student_id);
      await markEmailStatus(adminClient, order_id, student_id, email_type, recipientEmail || '', 'skipped', 'no_email');
      return jsonOk({ skipped: true, reason: 'no_student_email' });
    }

    // 6. Build email content
    const displayName = (order.profiles as Record<string, unknown>)?.display_name as string || 'Student';
    const emailContent = buildEmailContent(email_type, order, displayName);

    if (!emailContent) {
      console.warn('[send-order-email] Unhandled email type:', email_type);
      return jsonOk({ skipped: true, reason: 'unknown_email_type' });
    }

    // Ensure notification record exists (upsert — no return value needed)
    await upsertEmailNotification(
      adminClient, order_id, student_id, email_type, recipientEmail
    );

    // 8. Send via Resend (or log if API key not configured)
    if (!RESEND_API_KEY) {
      console.warn('[send-order-email] RESEND_API_KEY not set. Email not sent (test mode).');
      await markEmailStatus(adminClient, order_id, student_id, email_type, recipientEmail, 'skipped', 'no_api_key');
      return jsonOk({ skipped: true, reason: 'no_resend_api_key', email_content: emailContent.subject });
    }

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        from:    RESEND_FROM_EMAIL,
        to:      [recipientEmail],
        subject: emailContent.subject,
        html:    emailContent.html
      })
    });

    if (!resendResponse.ok) {
      const resendError = await resendResponse.json().catch(() => ({}));
      console.error('[send-order-email] Resend API error:', resendError);
      await incrementEmailAttempts(adminClient, order_id, email_type, String(resendError?.message || 'Resend error'));
      return jsonError('Email provider error', 502);
    }

    const resendResult = await resendResponse.json();
    const providerId = resendResult?.id;

    // 9. Mark as sent
    await adminClient
      .from('email_notifications')
      .update({
        status:      'sent',
        provider_id: providerId,
        sent_at:     new Date().toISOString()
      })
      .eq('order_id', order_id)
      .eq('email_type', email_type);

    console.log(`[send-order-email] Email sent for order ${order_id}, type ${email_type}, resend ID: ${providerId}`);
    return jsonOk({ success: true, provider_id: providerId });

  } catch (err) {
    console.error('[send-order-email] Unexpected error:', err);
    return jsonError('Internal server error', 500);
  }
});

// ---------------------------------------------------------------------------
// Email content builder
// ---------------------------------------------------------------------------
function buildEmailContent(
  emailType: string,
  order: Record<string, unknown>,
  displayName: string
): { subject: string; html: string } | null {
  const items = (order.order_items as Array<Record<string, number | string>>) || [];
  const totalINR = formatRupees(order.total_paise as number);
  const token = order.token as string;
  const createdAt = formatIST(order.created_at as string);
  const pickupAt = order.estimated_pickup
    ? formatIST(order.estimated_pickup as string)
    : 'As informed at the counter';

  const itemsHtml = items.map((item) => `
    <tr>
      <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${item.item_name}</td>
      <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; text-align: center;">${item.quantity}</td>
      <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; text-align: right;">${formatRupees(item.line_total_paise as number)}</td>
    </tr>
  `).join('');

  const baseStyle = `
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    max-width: 520px; margin: 0 auto; background: #fff;
    border-radius: 12px; overflow: hidden; border: 1px solid #e8e8e8;
  `;
  const headerStyle = `background: #ff6b35; padding: 32px 24px; text-align: center;`;
  const bodyStyle = `padding: 24px;`;

  switch (emailType) {
    case 'order_confirmed':
    case 'payment_receipt':
      return {
        subject: `✅ Order Confirmed — Token ${token} | SmartCanteen`,
        html: `
          <div style="${baseStyle}">
            <div style="${headerStyle}">
              <h1 style="color:#fff;margin:0;font-size:24px;">Order Confirmed! 🎉</h1>
              <p style="color:#ffe0d4;margin:8px 0 0;">SmartCanteen</p>
            </div>
            <div style="${bodyStyle}">
              <p>Hi <strong>${displayName}</strong>,</p>
              <p>Your order has been confirmed and is being prepared.</p>
              <div style="background:#fff7f4;border:2px solid #ff6b35;border-radius:8px;padding:16px;text-align:center;margin:16px 0;">
                <div style="font-size:12px;color:#888;letter-spacing:1px;">YOUR TOKEN</div>
                <div style="font-size:36px;font-weight:bold;color:#ff6b35;">${token}</div>
                <div style="font-size:14px;color:#666;margin-top:8px;">Show this at the counter when collecting</div>
              </div>
              <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                <thead>
                  <tr style="background:#f8f8f8;">
                    <th style="padding:8px;text-align:left;font-size:12px;color:#888;">ITEM</th>
                    <th style="padding:8px;text-align:center;font-size:12px;color:#888;">QTY</th>
                    <th style="padding:8px;text-align:right;font-size:12px;color:#888;">AMOUNT</th>
                  </tr>
                </thead>
                <tbody>${itemsHtml}</tbody>
              </table>
              <div style="text-align:right;font-size:18px;font-weight:bold;border-top:2px solid #f0f0f0;padding-top:12px;">
                Total: ${totalINR}
              </div>
              <div style="background:#f0f9ff;border-radius:8px;padding:12px;margin-top:16px;">
                <strong>📍 Estimated Pickup:</strong> ${pickupAt}
              </div>
              ${order.student_note ? `<p style="color:#888;font-size:14px;margin-top:12px;">📝 Your note: "${order.student_note}"</p>` : ''}
              <p style="color:#888;font-size:12px;margin-top:24px;">Ordered at: ${createdAt}</p>
            </div>
          </div>
        `
      };

    case 'order_ready':
    case 'order_ready_pickup':
      return {
        subject: `🔔 Ready for Pickup — Token ${token} | SmartCanteen`,
        html: `
          <div style="${baseStyle}">
            <div style="${headerStyle}">
              <h1 style="color:#fff;margin:0;font-size:24px;">Your Order is Ready! 🍽️</h1>
              <p style="color:#ffe0d4;margin:8px 0 0;">Come collect it now!</p>
            </div>
            <div style="${bodyStyle}">
              <p>Hi <strong>${displayName}</strong>,</p>
              <p>Your order <strong>${token}</strong> is ready for pickup. Please come to the counter now!</p>
              <div style="background:#f0fff4;border:2px solid #22c55e;border-radius:8px;padding:16px;text-align:center;margin:16px 0;">
                <div style="font-size:36px;font-weight:bold;color:#16a34a;">${token}</div>
                <div style="font-size:14px;color:#666;margin-top:8px;">Show this at the counter</div>
              </div>
              <p style="color:#888;font-size:12px;">Total: ${totalINR}</p>
            </div>
          </div>
        `
      };

    case 'payment_failed':
      return {
        subject: `❌ Payment Failed — SmartCanteen`,
        html: `
          <div style="${baseStyle}">
            <div style="${headerStyle}">
              <h1 style="color:#fff;margin:0;font-size:24px;">Payment Not Completed</h1>
            </div>
            <div style="${bodyStyle}">
              <p>Hi <strong>${displayName}</strong>,</p>
              <p>Unfortunately, your payment was not completed. Your order for <strong>${totalINR}</strong> was not placed.</p>
              <p>Please try again from the app. If amount was debited, it will be refunded within 5-7 business days.</p>
            </div>
          </div>
        `
      };

    case 'order_cancelled':
      return {
        subject: `Order Cancelled — Token ${token} | SmartCanteen`,
        html: `
          <div style="${baseStyle}">
            <div style="${headerStyle}">
              <h1 style="color:#fff;margin:0;font-size:24px;">Order Cancelled</h1>
            </div>
            <div style="${bodyStyle}">
              <p>Hi <strong>${displayName}</strong>,</p>
              <p>Your order <strong>${token}</strong> (${totalINR}) has been cancelled.</p>
              <p>If you were charged, a refund will be initiated within 5-7 business days.</p>
            </div>
          </div>
        `
      };

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function upsertEmailNotification(adminClient: any, orderId: string, studentId: string, emailType: string, recipient: string): Promise<void> {
  await adminClient.from('email_notifications').upsert({
    order_id:   orderId,
    student_id: studentId,
    email_type: emailType,
    recipient:  recipient,
    status:     'queued'
  }, {
    onConflict: 'order_id,email_type',
    ignoreDuplicates: true
  });
}

// deno-lint-ignore no-explicit-any
async function markEmailStatus(adminClient: any, orderId: string, studentId: string, emailType: string, recipient: string, status: string, errorMsg?: string): Promise<void> {
  await adminClient.from('email_notifications').upsert({
    order_id:   orderId,
    student_id: studentId,
    email_type: emailType,
    recipient:  recipient,
    status,
    last_error: errorMsg || null
  }, { onConflict: 'order_id,email_type' });
}

// deno-lint-ignore no-explicit-any
async function incrementEmailAttempts(adminClient: any, orderId: string, emailType: string, errorMsg: string): Promise<void> {
  const { data } = await adminClient
    .from('email_notifications')
    .select('attempts')
    .eq('order_id', orderId)
    .eq('email_type', emailType)
    .single();

  await adminClient.from('email_notifications').update({
    status:     'failed',
    attempts:   ((data?.attempts) || 0) + 1,
    last_error: errorMsg
  }).eq('order_id', orderId).eq('email_type', emailType);
}

function formatRupees(paise: number): string {
  return '₹' + Math.round(paise / 100).toLocaleString('en-IN');
}

function formatIST(isoStr: string): string {
  try {
    return new Date(isoStr).toLocaleString('en-IN', {
      timeZone:     'Asia/Kolkata',
      dateStyle:    'medium',
      timeStyle:    'short'
    });
  } catch {
    return isoStr;
  }
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
