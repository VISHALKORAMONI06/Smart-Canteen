-- =============================================================================
-- SmartCanteen — Migration 007: Server-side Payment & Inventory Functions
-- All functions: SECURITY DEFINER, explicit search_path.
-- These are called by Edge Functions via the service-role client — NOT directly
-- by the browser. The Edge Functions own the Razorpay API calls.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- RPC: create_payment_record
-- Called by the create-razorpay-order Edge Function AFTER creating the Razorpay
-- order on their API. Atomically creates an order + payment record.
-- Returns the internal payment UUID and confirms the amount to charge.
--
-- Security: Edge Function passes verified server-calculated amount.
--           Client cannot call this directly (Edge Function holds service key).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_payment_record(
  p_order_id          UUID,
  p_student_id        UUID,
  p_razorpay_order_id TEXT,
  p_amount_paise      INTEGER,
  p_idempotency_key   TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id UUID;
  v_existing   RECORD;
  v_order      RECORD;
BEGIN
  -- 1. Check idempotency: return existing payment if key already used
  SELECT * INTO v_existing FROM public.payments
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'payment_id',         v_existing.id,
      'razorpay_order_id',  v_existing.razorpay_order_id,
      'amount_paise',       v_existing.amount_paise,
      'status',             v_existing.status,
      'idempotent_replay',  TRUE
    );
  END IF;

  -- 2. Verify order exists and belongs to this student
  SELECT * INTO v_order FROM public.orders
  WHERE id = p_order_id AND student_id = p_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: Order % not found for student %.', p_order_id, p_student_id;
  END IF;

  -- 3. Verify amount matches order total (authoritative check)
  IF v_order.total_paise != p_amount_paise THEN
    RAISE EXCEPTION 'AMOUNT_MISMATCH: Server total % paise does not match requested % paise.',
      v_order.total_paise, p_amount_paise;
  END IF;

  -- 4. Create payment record
  v_payment_id := gen_random_uuid();

  INSERT INTO public.payments (
    id, order_id, student_id, razorpay_order_id,
    amount_paise, currency, status, verified, idempotency_key
  ) VALUES (
    v_payment_id, p_order_id, p_student_id, p_razorpay_order_id,
    p_amount_paise, 'INR', 'pending', FALSE, p_idempotency_key
  );

  -- 5. Update order payment_status to pending
  UPDATE public.orders
  SET payment_status = 'pending', payment_method = 'razorpay'
  WHERE id = p_order_id;

  -- 6. Write audit log
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_student_id,
    'payment.created',
    'payment',
    v_payment_id::TEXT,
    jsonb_build_object(
      'order_id',          p_order_id,
      'razorpay_order_id', p_razorpay_order_id,
      'amount_paise',      p_amount_paise
    )
  );

  RETURN jsonb_build_object(
    'payment_id',         v_payment_id,
    'razorpay_order_id',  p_razorpay_order_id,
    'amount_paise',       p_amount_paise,
    'status',             'pending',
    'idempotent_replay',  FALSE
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: confirm_payment_captured
-- Called by verify-razorpay-payment Edge Function AFTER successful HMAC verification.
-- Atomically: marks payment verified, updates order to Confirmed,
--             deducts inventory, generates pickup token, queues email.
--
-- Security: signature verification happens in the Edge Function using
--           RAZORPAY_KEY_SECRET (never touches DB). This function only records
--           the result. Idempotent via razorpay_payment_id UNIQUE constraint.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_payment_captured(
  p_razorpay_order_id   TEXT,
  p_razorpay_payment_id TEXT,
  p_razorpay_signature  TEXT,
  p_student_id          UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment      RECORD;
  v_order        RECORD;
  v_pickup_token TEXT;
  v_student_email TEXT;
BEGIN
  -- 1. Find the payment record by Razorpay order ID (with row lock)
  SELECT p.*, o.student_id AS o_student_id, o.total_paise
  INTO v_payment
  FROM public.payments p
  JOIN public.orders o ON o.id = p.order_id
  WHERE p.razorpay_order_id = p_razorpay_order_id
  FOR UPDATE OF p;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND: No payment found for Razorpay order %.', p_razorpay_order_id;
  END IF;

  -- 2. Verify payment belongs to this student (prevent cross-user confirmation)
  IF v_payment.o_student_id != p_student_id THEN
    RAISE EXCEPTION 'FORBIDDEN: Payment does not belong to authenticated user.';
  END IF;

  -- 3. Idempotency: if already captured, return existing state
  IF v_payment.status = 'captured' AND v_payment.verified = TRUE THEN
    SELECT token INTO v_pickup_token
    FROM public.pickup_tokens WHERE order_id = v_payment.order_id;

    RETURN jsonb_build_object(
      'order_id',          v_payment.order_id,
      'payment_id',        v_payment.id,
      'status',            'captured',
      'pickup_token',      v_pickup_token,
      'idempotent_replay', TRUE
    );
  END IF;

  -- 4. Update payment record as captured and verified
  UPDATE public.payments
  SET
    status               = 'captured',
    verified             = TRUE,
    razorpay_payment_id  = p_razorpay_payment_id,
    razorpay_signature   = p_razorpay_signature,
    captured_at          = NOW(),
    verified_at          = NOW()
  WHERE id = v_payment.id;

  -- 5. Update order: payment_status=captured, status=Confirmed
  UPDATE public.orders
  SET
    payment_status = 'captured',
    status         = 'Confirmed',
    confirmed_at   = NOW()
  WHERE id = v_payment.order_id;

  -- 6. Deduct inventory for each order item (only when track_inventory=TRUE)
  PERFORM public.deduct_inventory_for_order(v_payment.order_id, p_student_id);

  -- 7. Generate pickup token (unique per order)
  v_pickup_token := encode(gen_random_bytes(16), 'hex');

  INSERT INTO public.pickup_tokens (order_id, token, expires_at)
  VALUES (v_payment.order_id, v_pickup_token, NOW() + INTERVAL '24 hours')
  ON CONFLICT (order_id) DO NOTHING;  -- preserve existing token; never overwrite a live QR code


  -- 8. Queue confirmation email (idempotent insert)
  SELECT u.email INTO v_student_email
  FROM auth.users u WHERE u.id = p_student_id;

  IF v_student_email IS NOT NULL THEN
    INSERT INTO public.email_notifications (
      order_id, student_id, email_type, recipient, status
    ) VALUES (
      v_payment.order_id, p_student_id, 'order_confirmed', v_student_email, 'queued'
    )
    ON CONFLICT (order_id, email_type) DO NOTHING;

    INSERT INTO public.email_notifications (
      order_id, student_id, email_type, recipient, status
    ) VALUES (
      v_payment.order_id, p_student_id, 'payment_receipt', v_student_email, 'queued'
    )
    ON CONFLICT (order_id, email_type) DO NOTHING;
  END IF;

  -- 9. Audit log
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_student_id,
    'payment.captured',
    'payment',
    v_payment.id::TEXT,
    jsonb_build_object(
      'order_id',            v_payment.order_id,
      'razorpay_order_id',   p_razorpay_order_id,
      'razorpay_payment_id', p_razorpay_payment_id,
      'amount_paise',        v_payment.amount_paise
    )
  );

  RETURN jsonb_build_object(
    'order_id',          v_payment.order_id,
    'payment_id',        v_payment.id,
    'status',            'captured',
    'pickup_token',      v_pickup_token,
    'idempotent_replay', FALSE
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- HELPER: deduct_inventory_for_order
-- Called from confirm_payment_captured. Uses SELECT FOR UPDATE to prevent
-- concurrent checkouts from overselling the same stock.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deduct_inventory_for_order(
  p_order_id   UUID,
  p_actor_id   UUID
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item         RECORD;
  v_inv          RECORD;
  v_stock_before INTEGER;
  v_stock_after  INTEGER;
BEGIN
  FOR v_item IN
    SELECT menu_item_id, quantity FROM public.order_items
    WHERE order_id = p_order_id
  LOOP
    -- Only deduct if this item has tracked inventory
    SELECT * INTO v_inv FROM public.inventory
    WHERE menu_item_id = v_item.menu_item_id
      AND track_inventory = TRUE
    FOR UPDATE;  -- row-level lock prevents concurrent oversell

    IF FOUND THEN
      -- Guard: prevent stock going negative
      IF v_inv.stock_quantity < v_item.quantity THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: Item % has only % units left, % requested.',
          v_item.menu_item_id, v_inv.stock_quantity, v_item.quantity;
      END IF;

      v_stock_before := v_inv.stock_quantity;
      v_stock_after  := v_inv.stock_quantity - v_item.quantity;

      -- Deduct stock
      UPDATE public.inventory
      SET stock_quantity = v_stock_after
      WHERE menu_item_id = v_item.menu_item_id;

      -- If stock hit zero, mark item unavailable automatically
      IF v_stock_after = 0 THEN
        UPDATE public.menu_items
        SET available = FALSE
        WHERE id = v_item.menu_item_id;
      END IF;

      -- Audit trail
      INSERT INTO public.inventory_adjustments (
        menu_item_id, delta, reason, order_id, actor_id, stock_before, stock_after
      ) VALUES (
        v_item.menu_item_id, -v_item.quantity, 'order_fulfilled',
        p_order_id, p_actor_id, v_stock_before, v_stock_after
      );
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: record_payment_failed
-- Called by webhook Edge Function when payment.failed event received.
-- Idempotent — safe to call multiple times.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_payment_failed(
  p_razorpay_order_id   TEXT,
  p_razorpay_payment_id TEXT,
  p_failure_code        TEXT,
  p_failure_description TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment RECORD;
BEGIN
  SELECT * INTO v_payment FROM public.payments
  WHERE razorpay_order_id = p_razorpay_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Payment not found');
  END IF;

  -- Idempotent: if already marked failed, skip
  IF v_payment.status = 'failed' THEN
    RETURN jsonb_build_object('order_id', v_payment.order_id, 'idempotent_replay', TRUE);
  END IF;

  -- Don't override a captured payment with failure (out-of-order webhooks)
  IF v_payment.status = 'captured' AND v_payment.verified = TRUE THEN
    RETURN jsonb_build_object('order_id', v_payment.order_id, 'skipped', 'already_captured');
  END IF;

  UPDATE public.payments
  SET
    status               = 'failed',
    razorpay_payment_id  = p_razorpay_payment_id,
    failure_code         = p_failure_code,
    failure_description  = p_failure_description,
    failed_at            = NOW()
  WHERE id = v_payment.id;

  -- Update order back to Placed (student can retry)
  UPDATE public.orders
  SET payment_status = 'failed', status = 'Placed'
  WHERE id = v_payment.order_id AND status = 'PendingPayment';

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_payment.student_id,
    'payment.failed',
    'payment',
    v_payment.id::TEXT,
    jsonb_build_object(
      'razorpay_order_id',   p_razorpay_order_id,
      'razorpay_payment_id', p_razorpay_payment_id,
      'failure_code',        p_failure_code,
      'failure_description', p_failure_description
    )
  );

  RETURN jsonb_build_object('order_id', v_payment.order_id, 'status', 'failed');
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: verify_pickup_token
-- Staff-only. Atomically marks a pickup token as used.
-- Prevents double-collection via transaction lock.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_pickup_token(
  p_token      TEXT,
  p_staff_id   UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id   UUID;
  v_actor_role TEXT;
  v_token_row  RECORD;
  v_order      RECORD;
BEGIN
  -- 1. Use p_staff_id if provided (from Edge Function), else auth.uid()
  v_actor_id := COALESCE(p_staff_id, auth.uid());
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Staff authentication required.';
  END IF;

  -- 2. Role check
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id;
  IF v_actor_role NOT IN ('staff', 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: Only staff can verify pickup tokens.';
  END IF;

  -- 3. Find and lock the token row
  SELECT * INTO v_token_row FROM public.pickup_tokens
  WHERE token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TOKEN_INVALID: Pickup token not found.';
  END IF;

  -- 4. Expiry check
  IF v_token_row.expires_at < NOW() THEN
    RAISE EXCEPTION 'TOKEN_EXPIRED: This pickup token has expired.';
  END IF;

  -- 5. Already used check (prevents double scan)
  IF v_token_row.used THEN
    RAISE EXCEPTION 'TOKEN_USED: This order has already been collected at %.', v_token_row.used_at;
  END IF;

  -- 6. Fetch order and validate it's in Ready status
  SELECT * INTO v_order FROM public.orders WHERE id = v_token_row.order_id;

  IF v_order.status NOT IN ('Ready', 'Confirmed', 'Preparing') THEN
    RAISE EXCEPTION 'ORDER_NOT_READY: Order % is in status %. Cannot collect yet.',
      v_order.token, v_order.status;
  END IF;

  -- 7. Mark token as used
  UPDATE public.pickup_tokens
  SET used = TRUE, used_at = NOW(), used_by = v_actor_id
  WHERE id = v_token_row.id;

  -- 8. Transition order to Collected
  UPDATE public.orders
  SET
    status       = 'Collected',
    collected_at = NOW(),
    updated_by   = v_actor_id
  WHERE id = v_token_row.order_id;

  -- 9. Audit log
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_actor_id,
    'order.collected_via_qr',
    'order',
    v_token_row.order_id::TEXT,
    jsonb_build_object(
      'token',         v_order.token,
      'pickup_token',  p_token,
      'staff_id',      v_actor_id
    )
  );

  RETURN jsonb_build_object(
    'order_id',    v_token_row.order_id,
    'token',       v_order.token,
    'student_id',  v_order.student_id,
    'total_paise', v_order.total_paise,
    'collected_at', NOW()
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: set_inventory (admin/staff — sets stock for a menu item)
-- Creates inventory row if not exists. Writes audit record.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_inventory(
  p_menu_item_id       UUID,
  p_stock_quantity     INTEGER,
  p_track_inventory    BOOLEAN,
  p_low_stock_threshold INTEGER DEFAULT 5
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id    UUID;
  v_actor_role  TEXT;
  v_old_stock   INTEGER := 0;
  v_item_name   TEXT;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;

  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id;
  IF v_actor_role NOT IN ('staff', 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: Only staff or admin can manage inventory.';
  END IF;

  -- Verify item exists
  SELECT name INTO v_item_name FROM public.menu_items
  WHERE id = p_menu_item_id AND active = TRUE AND archived_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND: Menu item not found.';
  END IF;

  -- Get current stock for audit delta
  SELECT stock_quantity INTO v_old_stock FROM public.inventory
  WHERE menu_item_id = p_menu_item_id;
  v_old_stock := COALESCE(v_old_stock, 0);

  -- Upsert inventory row
  INSERT INTO public.inventory (
    menu_item_id, stock_quantity, track_inventory, low_stock_threshold, updated_by
  ) VALUES (
    p_menu_item_id, p_stock_quantity, p_track_inventory, p_low_stock_threshold, v_actor_id
  )
  ON CONFLICT (menu_item_id) DO UPDATE
    SET stock_quantity      = EXCLUDED.stock_quantity,
        track_inventory     = EXCLUDED.track_inventory,
        low_stock_threshold = EXCLUDED.low_stock_threshold,
        updated_by          = EXCLUDED.updated_by;

  -- If track_inventory=TRUE and stock hits 0, auto-mark unavailable
  IF p_track_inventory AND p_stock_quantity = 0 THEN
    UPDATE public.menu_items SET available = FALSE WHERE id = p_menu_item_id;
  ELSIF p_track_inventory AND p_stock_quantity > 0 THEN
    -- Re-enable if stock was restored
    UPDATE public.menu_items SET available = TRUE
    WHERE id = p_menu_item_id AND available = FALSE;
  END IF;

  -- Write audit
  INSERT INTO public.inventory_adjustments (
    menu_item_id, delta, reason, actor_id, stock_before, stock_after, note
  ) VALUES (
    p_menu_item_id,
    p_stock_quantity - v_old_stock,
    'manual_set',
    v_actor_id,
    v_old_stock,
    p_stock_quantity,
    'Manual stock update'
  );

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_actor_id, 'inventory.updated', 'menu_item', p_menu_item_id::TEXT,
    jsonb_build_object(
      'item_name',       v_item_name,
      'stock_before',    v_old_stock,
      'stock_after',     p_stock_quantity,
      'track_inventory', p_track_inventory
    )
  );

  RETURN jsonb_build_object(
    'menu_item_id',      p_menu_item_id,
    'stock_quantity',    p_stock_quantity,
    'track_inventory',   p_track_inventory,
    'low_stock_threshold', p_low_stock_threshold
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: get_analytics (staff/admin — financial analytics dashboard)
-- Returns aggregated revenue data for a date range.
-- Efficient: runs on DB, never downloads all orders to browser.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_analytics(
  p_from_date  DATE DEFAULT NULL,
  p_to_date    DATE DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id   UUID;
  v_actor_role TEXT;
  v_from       DATE;
  v_to         DATE;
  v_result     JSONB;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;

  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id;
  IF v_actor_role NOT IN ('staff', 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: Only staff or admin can view analytics.';
  END IF;

  v_from := COALESCE(p_from_date, (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE - INTERVAL '30 days');
  v_to   := COALESCE(p_to_date,   (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE);

  SELECT jsonb_build_object(
    'period_from', v_from,
    'period_to',   v_to,

    -- Revenue
    'gross_revenue_paise', COALESCE(SUM(o.total_paise) FILTER (
      WHERE o.payment_status = 'captured' AND o.status != 'Cancelled'
    ), 0),
    'refund_total_paise', COALESCE(SUM(p.amount_paise) FILTER (
      WHERE p.status = 'refunded'
    ), 0),
    'paid_orders',    COUNT(DISTINCT o.id) FILTER (WHERE o.payment_status = 'captured'),
    'total_orders',   COUNT(DISTINCT o.id),
    'cancelled_orders', COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'Cancelled'),
    'failed_payments',  COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'failed'),

    -- Average order value (paise)
    'avg_order_value_paise', CASE
      WHEN COUNT(DISTINCT o.id) FILTER (WHERE o.payment_status = 'captured') > 0
      THEN COALESCE(SUM(o.total_paise) FILTER (
        WHERE o.payment_status = 'captured' AND o.status != 'Cancelled'
      ), 0) / COUNT(DISTINCT o.id) FILTER (WHERE o.payment_status = 'captured')
      ELSE 0
    END,

    -- Daily series
    'daily_revenue', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'date',              rs.business_date,
          'gross_paise',       rs.gross_revenue_paise,
          'paid_orders',       rs.paid_orders,
          'cancelled_orders',  rs.cancelled_orders
        )
        ORDER BY rs.business_date
      )
      FROM public.revenue_summary rs
      WHERE rs.business_date BETWEEN v_from AND v_to
    ),

    -- Top 10 items
    'top_items', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'item_name',      ip.item_name,
          'total_quantity', ip.total_quantity,
          'order_count',    ip.order_count,
          'revenue_paise',  ip.total_revenue_paise
        )
      )
      FROM (
        SELECT * FROM public.item_performance LIMIT 10
      ) ip
    ),

    -- Peak hours (IST)
    'peak_hours', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'hour',        EXTRACT(HOUR FROM (o2.created_at AT TIME ZONE 'Asia/Kolkata'))::INTEGER,
          'order_count', COUNT(*)
        )
        ORDER BY order_count DESC
      )
      FROM public.orders o2
      WHERE o2.business_date BETWEEN v_from AND v_to
        AND o2.payment_status = 'captured'
      GROUP BY EXTRACT(HOUR FROM (o2.created_at AT TIME ZONE 'Asia/Kolkata'))
    ),

    -- Low stock alerts
    'low_stock_items', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'menu_item_id', mi.id,
          'item_name',    mi.name,
          'stock',        inv.stock_quantity,
          'threshold',    inv.low_stock_threshold
        )
      )
      FROM public.inventory inv
      JOIN public.menu_items mi ON mi.id = inv.menu_item_id
      WHERE inv.track_inventory = TRUE
        AND inv.stock_quantity <= inv.low_stock_threshold
        AND mi.active = TRUE AND mi.archived_at IS NULL
    )
  )
  INTO v_result
  FROM public.orders o
  LEFT JOIN public.payments p ON p.order_id = o.id AND p.verified = TRUE
  WHERE o.business_date BETWEEN v_from AND v_to;

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Update existing place_order to check inventory atomically
-- Replace the function with inventory-aware version.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_order(
  p_cart_items      JSONB,
  p_student_note    TEXT DEFAULT '',
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id       UUID;
  v_student_role     TEXT;
  v_settings         RECORD;
  v_business_date    DATE;
  v_canteen_now_time TIME;
  v_cart_item        JSONB;
  v_menu_item        RECORD;
  v_inv              RECORD;
  v_items_data       JSONB := '[]'::JSONB;
  v_subtotal_paise   INTEGER := 0;
  v_max_prep_mins    INTEGER := 5;
  v_token            TEXT;
  v_order_id         UUID;
  v_estimated_pickup TIMESTAMPTZ;
  v_idem_key         TEXT;
  v_existing_order   RECORD;
  v_quantity         INTEGER;
  v_item_id          UUID;
  v_line_total       INTEGER;
BEGIN
  -- 1. Validate authenticated user
  v_student_id := auth.uid();
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: You must be signed in to place an order.';
  END IF;

  -- 2. Check student role
  SELECT role INTO v_student_role FROM public.profiles WHERE id = v_student_id;
  IF v_student_role NOT IN ('student', 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: Only students can place orders.';
  END IF;

  -- 3. Load operational settings
  SELECT * INTO v_settings FROM public.app_settings WHERE id = 1;

  -- 4. Check canteen is accepting orders
  IF NOT v_settings.ordering_open THEN
    RAISE EXCEPTION 'CANTEEN_CLOSED: The canteen is not accepting orders at this time.';
  END IF;

  -- 5. Check business hours
  v_canteen_now_time := (NOW() AT TIME ZONE v_settings.business_timezone)::TIME;
  v_business_date    := (NOW() AT TIME ZONE v_settings.business_timezone)::DATE;

  IF v_canteen_now_time < v_settings.opening_time OR v_canteen_now_time > v_settings.closing_time THEN
    RAISE EXCEPTION 'OUTSIDE_HOURS: Canteen ordering is only available between % and %.',
      v_settings.opening_time, v_settings.closing_time;
  END IF;

  -- 6. Validate cart is not empty
  IF p_cart_items IS NULL OR jsonb_array_length(p_cart_items) = 0 THEN
    RAISE EXCEPTION 'EMPTY_CART: Cannot place an order with an empty cart.';
  END IF;

  -- 7. Validate cart size
  IF jsonb_array_length(p_cart_items) > v_settings.max_items_per_order THEN
    RAISE EXCEPTION 'TOO_MANY_ITEMS: Cart exceeds maximum of % distinct items.', v_settings.max_items_per_order;
  END IF;

  -- 8. Handle idempotency
  v_idem_key := COALESCE(p_idempotency_key, gen_random_uuid()::TEXT);

  SELECT * INTO v_existing_order FROM public.orders WHERE idempotency_key = v_idem_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'order_id',          v_existing_order.id,
      'token',             v_existing_order.token,
      'status',            v_existing_order.status,
      'total_paise',       v_existing_order.total_paise,
      'estimated_pickup',  v_existing_order.estimated_pickup,
      'created_at',        v_existing_order.created_at,
      'idempotent_replay', TRUE
    );
  END IF;

  -- 9. Validate each cart item, check inventory, fetch authoritative prices
  FOR v_cart_item IN SELECT * FROM jsonb_array_elements(p_cart_items)
  LOOP
    v_item_id  := (v_cart_item->>'menu_item_id')::UUID;
    v_quantity := (v_cart_item->>'quantity')::INTEGER;

    IF v_quantity IS NULL OR v_quantity < 1 THEN
      RAISE EXCEPTION 'INVALID_QUANTITY: Quantity must be at least 1 for each item.';
    END IF;
    IF v_quantity > v_settings.max_qty_per_item THEN
      RAISE EXCEPTION 'QTY_EXCEEDED: Quantity % exceeds maximum of % per item.', v_quantity, v_settings.max_qty_per_item;
    END IF;

    -- Fetch menu item (authoritative)
    SELECT * INTO v_menu_item FROM public.menu_items
    WHERE id = v_item_id AND active = TRUE AND archived_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_NOT_FOUND: Menu item % does not exist or has been removed.', v_item_id;
    END IF;
    IF NOT v_menu_item.available THEN
      RAISE EXCEPTION 'ITEM_UNAVAILABLE: "%" is currently sold out.', v_menu_item.name;
    END IF;

    -- Check inventory stock (if tracked) — SELECT FOR UPDATE to prevent race conditions
    SELECT * INTO v_inv FROM public.inventory
    WHERE menu_item_id = v_item_id AND track_inventory = TRUE
    FOR UPDATE;

    IF FOUND AND v_inv.stock_quantity < v_quantity THEN
      RAISE EXCEPTION 'OUT_OF_STOCK: "%" only has % units available, % requested.',
        v_menu_item.name, v_inv.stock_quantity, v_quantity;
    END IF;

    -- Compute line total using SERVER price (never trust client price)
    v_line_total     := v_menu_item.price_paise * v_quantity;
    v_subtotal_paise := v_subtotal_paise + v_line_total;

    IF v_menu_item.prep_time_mins > v_max_prep_mins THEN
      v_max_prep_mins := v_menu_item.prep_time_mins;
    END IF;

    v_items_data := v_items_data || jsonb_build_object(
      'menu_item_id',     v_item_id,
      'item_name',        v_menu_item.name,
      'unit_price_paise', v_menu_item.price_paise,
      'quantity',         v_quantity,
      'prep_time_mins',   v_menu_item.prep_time_mins,
      'line_total_paise', v_line_total
    );
  END LOOP;

  -- 10. Calculate estimated pickup time
  v_estimated_pickup := date_trunc('minute', NOW())
    + ((v_max_prep_mins + 5) || ' minutes')::INTERVAL;
  v_estimated_pickup := date_trunc('minute', v_estimated_pickup)
    + CASE
        WHEN EXTRACT(MINUTE FROM v_estimated_pickup)::INTEGER % 5 = 0 THEN '0 minutes'::INTERVAL
        ELSE ((5 - EXTRACT(MINUTE FROM v_estimated_pickup)::INTEGER % 5) || ' minutes')::INTERVAL
      END;

  -- 11. Allocate unique daily token
  v_token := public.allocate_daily_token(v_business_date);

  -- 12. Create the order record (status = Placed; payment happens next)
  v_order_id := gen_random_uuid();

  INSERT INTO public.orders (
    id, student_id, token, business_date, status,
    subtotal_paise, total_paise, student_note,
    estimated_pickup, idempotency_key, payment_status, payment_method,
    created_at, updated_at
  ) VALUES (
    v_order_id, v_student_id, v_token, v_business_date, 'Placed',
    v_subtotal_paise, v_subtotal_paise,
    LEFT(COALESCE(p_student_note, ''), 200),
    v_estimated_pickup, v_idem_key, 'pending', 'razorpay',
    NOW(), NOW()
  );

  -- 13. Create order item snapshots
  INSERT INTO public.order_items (
    id, order_id, menu_item_id, item_name,
    unit_price_paise, quantity, prep_time_mins, line_total_paise
  )
  SELECT
    gen_random_uuid(), v_order_id,
    (item->>'menu_item_id')::UUID,
    item->>'item_name',
    (item->>'unit_price_paise')::INTEGER,
    (item->>'quantity')::INTEGER,
    (item->>'prep_time_mins')::INTEGER,
    (item->>'line_total_paise')::INTEGER
  FROM jsonb_array_elements(v_items_data) AS item;

  -- 14. Write audit log
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_student_id, 'order.placed', 'order', v_order_id::TEXT,
    jsonb_build_object(
      'token',       v_token,
      'total_paise', v_subtotal_paise,
      'item_count',  jsonb_array_length(v_items_data)
    )
  );

  -- 15. Return order details (frontend uses total_paise to create Razorpay order)
  RETURN jsonb_build_object(
    'order_id',          v_order_id,
    'token',             v_token,
    'status',            'Placed',
    'total_paise',       v_subtotal_paise,
    'estimated_pickup',  v_estimated_pickup,
    'created_at',        NOW(),
    'business_date',     v_business_date,
    'idempotent_replay', FALSE
  );

EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'DUPLICATE_ORDER: An order with this idempotency key already exists.';
END;
$$;

-- Update transition_order_status to include Confirmed in allowed transitions
CREATE OR REPLACE FUNCTION public.transition_order_status(
  p_order_id   UUID,
  p_new_status TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id   UUID;
  v_actor_role TEXT;
  v_order      RECORD;
  v_allowed    TEXT[];
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED: You must be signed in.'; END IF;

  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id;
  IF v_actor_role NOT IN ('staff', 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: Only staff can update order status.';
  END IF;

  IF p_new_status NOT IN ('Preparing', 'Ready', 'Collected', 'Cancelled') THEN
    RAISE EXCEPTION 'INVALID_STATUS: "%" is not a valid target status.', p_new_status;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND: Order % does not exist.', p_order_id; END IF;

  -- Updated state machine: Confirmed is the paid-and-accepted state (replaces old Placed flow)
  v_allowed := CASE v_order.status
    WHEN 'Placed'     THEN ARRAY['Preparing', 'Cancelled']  -- legacy counter orders
    WHEN 'Confirmed'  THEN ARRAY['Preparing', 'Cancelled']  -- paid online orders
    WHEN 'Preparing'  THEN ARRAY['Ready']
    WHEN 'Ready'      THEN ARRAY['Collected']
    ELSE ARRAY[]::TEXT[]
  END;

  IF NOT (p_new_status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: Cannot move order from % to %.', v_order.status, p_new_status;
  END IF;

  UPDATE public.orders
  SET
    status       = p_new_status,
    updated_by   = v_actor_id,
    preparing_at = CASE WHEN p_new_status = 'Preparing' THEN NOW() ELSE preparing_at END,
    ready_at     = CASE WHEN p_new_status = 'Ready'     THEN NOW() ELSE ready_at     END,
    collected_at = CASE WHEN p_new_status = 'Collected' THEN NOW() ELSE collected_at END,
    cancelled_at = CASE WHEN p_new_status = 'Cancelled' THEN NOW() ELSE cancelled_at END,
    cancelled_by = CASE WHEN p_new_status = 'Cancelled' THEN v_actor_id ELSE cancelled_by END
  WHERE id = p_order_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_actor_id, 'order.status_changed', 'order', p_order_id::TEXT,
    jsonb_build_object('from_status', v_order.status, 'to_status', p_new_status, 'token', v_order.token)
  );

  -- Queue "ready for pickup" email when staff marks order Ready
  IF p_new_status = 'Ready' THEN
    DECLARE v_student_email TEXT;
    BEGIN
      SELECT u.email INTO v_student_email FROM auth.users u WHERE u.id = v_order.student_id;
      IF v_student_email IS NOT NULL THEN
        INSERT INTO public.email_notifications (
          order_id, student_id, email_type, recipient, status
        ) VALUES (
          p_order_id, v_order.student_id, 'order_ready', v_student_email, 'queued'
        )
        ON CONFLICT (order_id, email_type) DO NOTHING;
      END IF;
    END;
  END IF;

  RETURN jsonb_build_object(
    'order_id',   p_order_id,
    'old_status', v_order.status,
    'new_status', p_new_status,
    'updated_by', v_actor_id,
    'updated_at', NOW()
  );
END;
$$;
