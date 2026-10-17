-- =============================================================================
-- SmartCanteen — Migration 008: Supplemental Schema Additions
-- Adds columns that were missing from 005 or needed by new Edge Functions.
-- Safe to run multiple times (IF NOT EXISTS / DO NOTHING guards throughout).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ADD cancelled_at to orders (missing from 005)
-- Used by OrdersPage to display cancellation timestamp
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

COMMENT ON COLUMN public.orders.cancelled_at IS
  'Set when an order transitions to Cancelled status.';

-- ---------------------------------------------------------------------------
-- ADD provider_id to email_notifications (for Resend message ID)
-- ---------------------------------------------------------------------------
ALTER TABLE public.email_notifications
  ADD COLUMN IF NOT EXISTS provider_id TEXT;

COMMENT ON COLUMN public.email_notifications.provider_id IS
  'Resend message ID for delivery tracking.';

-- ---------------------------------------------------------------------------
-- ADD last_error to email_notifications (for retry diagnostics)
-- ---------------------------------------------------------------------------
ALTER TABLE public.email_notifications
  ADD COLUMN IF NOT EXISTS last_error TEXT;

COMMENT ON COLUMN public.email_notifications.last_error IS
  'Last error message from email provider, for debugging failed sends.';

-- ---------------------------------------------------------------------------
-- ADD attempts to email_notifications (for retry cap)
-- ---------------------------------------------------------------------------
ALTER TABLE public.email_notifications
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.email_notifications.attempts IS
  'Number of delivery attempts. Capped at 3 by send-order-email function.';

-- NOTE: The unique constraint on (order_id, email_type) is already created
-- in migration 005 as 'email_notifications_order_type_unique'.
-- No second constraint is needed here.



-- ---------------------------------------------------------------------------
-- ADD refunded_at to payments (used by webhook refund handler)
-- ---------------------------------------------------------------------------
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

COMMENT ON COLUMN public.payments.refunded_at IS
  'Set when a refund is initiated. Populated by razorpay-webhook refund.created event.';

-- ---------------------------------------------------------------------------
-- ANALYTICS VIEWS — idempotent CREATE OR REPLACE
-- These enrich the get_analytics() RPC's data sources.
-- ---------------------------------------------------------------------------

-- Daily revenue summary view
CREATE OR REPLACE VIEW public.daily_revenue_summary AS
SELECT
  o.business_date                                          AS date,
  COUNT(*) FILTER (WHERE o.status NOT IN ('Cancelled','Expired') AND p.status = 'captured') AS paid_orders,
  COALESCE(SUM(p.amount_paise) FILTER (WHERE p.status = 'captured'), 0)                     AS gross_paise,
  COALESCE(SUM(p.amount_paise) FILTER (WHERE p.status = 'refunded'), 0)                     AS refund_paise
FROM public.orders o
LEFT JOIN public.payments p ON p.order_id = o.id
GROUP BY o.business_date
ORDER BY o.business_date DESC;

COMMENT ON VIEW public.daily_revenue_summary IS
  'Aggregate daily revenue from verified captured payments only.';

-- Peak order hours view (Asia/Kolkata timezone)
CREATE OR REPLACE VIEW public.peak_order_hours AS
SELECT
  EXTRACT(HOUR FROM o.created_at AT TIME ZONE 'Asia/Kolkata')::INTEGER AS hour,
  COUNT(*) AS order_count
FROM public.orders o
WHERE o.status NOT IN ('Cancelled', 'PendingPayment')
GROUP BY 1
ORDER BY 2 DESC;

COMMENT ON VIEW public.peak_order_hours IS
  'Order volume by hour of day in IST timezone.';

-- Low stock items view
CREATE OR REPLACE VIEW public.low_stock_items AS
SELECT
  mi.id            AS menu_item_id,
  mi.name          AS item_name,
  i.stock_quantity AS stock,
  i.low_stock_threshold AS threshold
FROM public.inventory i
JOIN public.menu_items mi ON mi.id = i.menu_item_id
WHERE i.track_inventory = TRUE
  AND i.stock_quantity <= i.low_stock_threshold
  AND mi.archived_at IS NULL
ORDER BY i.stock_quantity ASC;

COMMENT ON VIEW public.low_stock_items IS
  'Menu items at or below their stock threshold, for get_analytics() low_stock_items.';

-- Restrict direct access to analytics views.
ALTER VIEW public.daily_revenue_summary
  SET (security_invoker = true);

ALTER VIEW public.peak_order_hours
  SET (security_invoker = true);

ALTER VIEW public.low_stock_items
  SET (security_invoker = true);

REVOKE ALL ON public.daily_revenue_summary FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.peak_order_hours FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.low_stock_items FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- UPDATE get_analytics() RPC to include daily_revenue and peak_hours
-- Adds the richer data used by AnalyticsDashboard.jsx
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_analytics(
  p_from_date DATE DEFAULT NULL,
  p_to_date   DATE DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from         DATE;
  v_to           DATE;
  v_result       JSONB;
  v_top_items    JSONB;
  v_daily        JSONB;
  v_peak_hours   JSONB;
  v_low_stock    JSONB;
BEGIN
  -- Default to last 30 days if no range supplied
  v_from := COALESCE(p_from_date, (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE - INTERVAL '30 days');
  v_to   := COALESCE(p_to_date,   (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE);

  -- Only authenticated staff and admins may access analytics.
  IF auth.uid() IS NULL
     OR public.current_user_role() NOT IN ('staff', 'admin') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Top-selling items in period
  SELECT COALESCE(jsonb_agg(t ORDER BY t.total_quantity DESC), '[]'::JSONB)
  INTO v_top_items
  FROM (
    SELECT
      oi.item_name,
      SUM(oi.quantity)::INTEGER             AS total_quantity,
      COUNT(DISTINCT oi.order_id)::INTEGER  AS order_count,
      COALESCE(SUM(oi.line_total_paise), 0)::INTEGER AS revenue_paise
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.payments p ON p.order_id = o.id AND p.status = 'captured'
    WHERE o.business_date BETWEEN v_from AND v_to
    GROUP BY oi.item_name
    ORDER BY total_quantity DESC
    LIMIT 10
  ) t;

  -- Daily revenue breakdown
  SELECT COALESCE(jsonb_agg(d ORDER BY d.date ASC), '[]'::JSONB)
  INTO v_daily
  FROM (
    SELECT
      drs.date::TEXT,
      drs.paid_orders::INTEGER,
      drs.gross_paise::INTEGER,
      drs.refund_paise::INTEGER
    FROM public.daily_revenue_summary drs
    WHERE drs.date BETWEEN v_from AND v_to
  ) d;

  -- Peak hours in period
  SELECT COALESCE(jsonb_agg(h ORDER BY h.order_count DESC), '[]'::JSONB)
  INTO v_peak_hours
  FROM (
    SELECT
      EXTRACT(HOUR FROM o.created_at AT TIME ZONE 'Asia/Kolkata')::INTEGER AS hour,
      COUNT(*)::INTEGER AS order_count
    FROM public.orders o
    WHERE o.business_date BETWEEN v_from AND v_to
      AND o.status NOT IN ('Cancelled', 'PendingPayment')
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 12
  ) h;

  -- Low stock items (not date-filtered — current snapshot)
  SELECT COALESCE(jsonb_agg(ls), '[]'::JSONB)
  INTO v_low_stock
  FROM (
    SELECT item_name, stock, threshold
    FROM public.low_stock_items
  ) ls;

  -- Main summary aggregation
  SELECT jsonb_build_object(
    -- Revenue metrics (only captured payments)
    'gross_revenue_paise',
    COALESCE((
      SELECT SUM(p.amount_paise)
      FROM public.payments p
      JOIN public.orders o ON o.id = p.order_id
      WHERE p.status = 'captured'
        AND o.business_date BETWEEN v_from AND v_to
    ), 0)::INTEGER,

    'refund_total_paise',
    COALESCE((
      SELECT SUM(p.amount_paise)
      FROM public.payments p
      JOIN public.orders o ON o.id = p.order_id
      WHERE p.status = 'refunded'
        AND o.business_date BETWEEN v_from AND v_to
    ), 0)::INTEGER,

    'avg_order_value_paise',
    COALESCE((
      SELECT AVG(p.amount_paise)::INTEGER
      FROM public.payments p
      JOIN public.orders o ON o.id = p.order_id
      WHERE p.status = 'captured'
        AND o.business_date BETWEEN v_from AND v_to
    ), 0)::INTEGER,

    -- Order volume
    'total_orders',
    COALESCE((
      SELECT COUNT(*)
      FROM public.orders
      WHERE business_date BETWEEN v_from AND v_to
    ), 0)::INTEGER,

    'paid_orders',
    COALESCE((
      SELECT COUNT(DISTINCT p.order_id)
      FROM public.payments p
      JOIN public.orders o ON o.id = p.order_id
      WHERE p.status = 'captured'
        AND o.business_date BETWEEN v_from AND v_to
    ), 0)::INTEGER,

    'cancelled_orders',
    COALESCE((
      SELECT COUNT(*)
      FROM public.orders
      WHERE status = 'Cancelled'
        AND business_date BETWEEN v_from AND v_to
    ), 0)::INTEGER,

    'failed_payments',
    COALESCE((
      SELECT COUNT(*)
      FROM public.payments p
      JOIN public.orders o ON o.id = p.order_id
      WHERE p.status = 'failed'
        AND o.business_date BETWEEN v_from AND v_to
    ), 0)::INTEGER,

    -- Drill-down data
    'top_items',    v_top_items,
    'daily_revenue', v_daily,
    'peak_hours',   v_peak_hours,
    'low_stock_items', v_low_stock,

    -- Period metadata
    'period_from', v_from::TEXT,
    'period_to',   v_to::TEXT
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Grant execute to authenticated users (RLS on underlying tables restricts data)
GRANT EXECUTE ON FUNCTION public.get_analytics(DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_analytics(DATE, DATE) IS
  'Aggregated analytics for authenticated staff/admin. Role checked inside function. Only counts captured payments as revenue.';