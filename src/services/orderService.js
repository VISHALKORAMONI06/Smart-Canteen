/**
 * Order service for SmartCanteen.
 * Converts DB paise to frontend rupees consistently.
 */
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js';

// ---------------------------------------------------------------------------
// Data conversion helpers
// ---------------------------------------------------------------------------
function dbOrderToFrontend(row) {
  if (!row) return null;
  return {
    id:             row.id,
    studentId:      row.student_id,
    token:          row.token,
    dateKey:        row.business_date,        // YYYY-MM-DD
    status:         row.status,
    // Payment fields (migration 005)
    paymentStatus:  row.payment_status || 'not_required',
    paymentMethod:  row.payment_method || null,
    confirmedAt:    row.confirmed_at   || null,
    totalAmount:    Math.round((row.total_paise || 0) / 100),   // paise -> rupees
    subtotalAmount: Math.round((row.subtotal_paise || 0) / 100),
    note:           row.student_note || '',
    pickupAt:       row.estimated_pickup,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
    preparingAt:    row.preparing_at,
    readyAt:        row.ready_at,
    collectedAt:    row.collected_at,
    cancelledAt:    row.cancelled_at,
    items:          (row.order_items || []).map(dbOrderItemToFrontend)
  };
}

function dbOrderItemToFrontend(row) {
  if (!row) return null;
  return {
    id:         row.id,
    itemId:     row.menu_item_id,
    name:       row.item_name,
    unitPrice:  Math.round((row.unit_price_paise || 0) / 100),
    quantity:   row.quantity,
    prepTime:   row.prep_time_mins,
    rowTotal:   Math.round((row.line_total_paise || 0) / 100)
  };
}

// ---------------------------------------------------------------------------
// Place an order via the secure RPC
// ---------------------------------------------------------------------------
export async function placeOrder({ cartItems, studentNote, idempotencyKey }) {
  if (!isSupabaseConfigured || !supabase) {
    return { data: null, error: new Error('Supabase not configured. Order placement unavailable in demo mode.') };
  }

  // Convert frontend cart (rupees) to RPC format (uses menu_item_id only; server fetches prices)
  const cartPayload = cartItems.map((item) => ({
    menu_item_id: item.itemId,
    quantity:     item.quantity
  }));

  const { data, error } = await supabase.rpc('place_order', {
    p_cart_items:       cartPayload,
    p_student_note:     studentNote || '',
    p_idempotency_key:  idempotencyKey
  });

  if (error) return { data: null, error };

  return { data, error: null };
}

// ---------------------------------------------------------------------------
// Fetch the current student's orders (with order_items joined)
// ---------------------------------------------------------------------------
export async function fetchMyOrders(studentId) {
  if (!isSupabaseConfigured || !supabase) return { orders: [], error: null };

  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      order_items (*)
    `)
    .eq('student_id', studentId)
    .order('created_at', { ascending: false });

  return {
    orders: (data || []).map(dbOrderToFrontend),
    error
  };
}

// ---------------------------------------------------------------------------
// Fetch all orders (staff/admin — uses RLS policy)
// ---------------------------------------------------------------------------
export async function fetchAllOrders(businessDate) {
  if (!isSupabaseConfigured || !supabase) return { orders: [], error: null };

  let query = supabase
    .from('orders')
    .select(`
      *,
      order_items (*)
    `)
    .order('created_at', { ascending: false });

  if (businessDate) {
    query = query.eq('business_date', businessDate);
  }

  const { data, error } = await query;

  return {
    orders: (data || []).map(dbOrderToFrontend),
    error
  };
}

// ---------------------------------------------------------------------------
// Transition order status via secure RPC
// ---------------------------------------------------------------------------
export async function transitionOrderStatus(orderId, newStatus) {
  if (!isSupabaseConfigured || !supabase) {
    return { data: null, error: new Error('Supabase not configured') };
  }

  const { data, error } = await supabase.rpc('transition_order_status', {
    p_order_id:   orderId,
    p_new_status: newStatus
  });

  return { data, error };
}

// ---------------------------------------------------------------------------
// Subscribe to order changes for a student (filtered by student_id)
// ---------------------------------------------------------------------------
export function subscribeToStudentOrders(studentId, onOrderChange) {
  if (!isSupabaseConfigured || !supabase || !studentId) {
    return { channel: null, unsubscribe: () => {} };
  }

  const channel = supabase
    .channel(`student_orders:${studentId}`)
    .on(
      'postgres_changes',
      {
        event:  '*',
        schema: 'public',
        table:  'orders',
        filter: `student_id=eq.${studentId}`
      },
      async (payload) => {
        // Fetch full order with items on any change
        if (payload.eventType === 'DELETE') {
          onOrderChange && onOrderChange({ type: 'DELETED', id: payload.old?.id });
          return;
        }
        // For INSERT/UPDATE, fetch the complete order with items
        const orderId = payload.new?.id;
        if (!orderId) return;
        const { data } = await supabase
          .from('orders')
          .select('*, order_items(*)')
          .eq('id', orderId)
          .single();
        if (data) {
          onOrderChange && onOrderChange({
            type:  payload.eventType,
            order: dbOrderToFrontend(data)
          });
        }
      }
    )
    .subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR') {
        console.error('[SmartCanteen] Student orders subscription error:', err);
      }
    });

  return {
    channel,
    unsubscribe: () => supabase.removeChannel(channel)
  };
}

// ---------------------------------------------------------------------------
// Subscribe to ALL order changes (staff/admin queue)
// ---------------------------------------------------------------------------
export function subscribeToAllOrders(onOrderChange) {
  if (!isSupabaseConfigured || !supabase) {
    return { channel: null, unsubscribe: () => {} };
  }

  const channel = supabase
    .channel('staff_orders_queue')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders' },
      async (payload) => {
        if (payload.eventType === 'DELETE') {
          onOrderChange && onOrderChange({ type: 'DELETED', id: payload.old?.id });
          return;
        }
        const orderId = payload.new?.id;
        if (!orderId) return;
        const { data } = await supabase
          .from('orders')
          .select('*, order_items(*)')
          .eq('id', orderId)
          .single();
        if (data) {
          onOrderChange && onOrderChange({
            type:  payload.eventType,
            order: dbOrderToFrontend(data)
          });
        }
      }
    )
    .subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR') {
        console.error('[SmartCanteen] Staff orders subscription error:', err);
      }
    });

  return {
    channel,
    unsubscribe: () => supabase.removeChannel(channel)
  };
}
