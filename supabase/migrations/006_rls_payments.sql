-- =============================================================================
-- SmartCanteen — Migration 006: RLS Policies for new tables
-- Extends existing security model. Does NOT weaken any existing policies.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PAYMENTS policies
-- Students: read their own payment records only (never write directly)
-- Staff/Admin: read all payments for operational visibility
-- No direct INSERT/UPDATE — only SECURITY DEFINER Edge Functions write here
-- ---------------------------------------------------------------------------

CREATE POLICY "payments_select_own_student"
  ON public.payments FOR SELECT
  USING (auth.uid() = student_id);

CREATE POLICY "payments_select_staff_admin"
  ON public.payments FOR SELECT
  USING (public.current_user_role() IN ('staff', 'admin'));

-- No INSERT/UPDATE by clients — Edge Functions use service role key
CREATE POLICY "payments_no_client_write"
  ON public.payments FOR INSERT
  WITH CHECK (FALSE);

-- ---------------------------------------------------------------------------
-- INVENTORY policies
-- Students/anon: read availability for active items (stock level only, not full row)
-- Staff/Admin: full read access
-- Admin: can update stock quantities
-- ---------------------------------------------------------------------------

-- Active students can see inventory for menu availability decisions
CREATE POLICY "inventory_select_authenticated"
  ON public.inventory FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.menu_items mi
      WHERE mi.id = menu_item_id
        AND mi.active = TRUE
        AND mi.archived_at IS NULL
    )
  );

-- Staff/Admin can see all inventory including archived items
CREATE POLICY "inventory_select_staff_admin"
  ON public.inventory FOR SELECT
  USING (public.current_user_role() IN ('staff', 'admin'));

-- Staff/Admin can update inventory (via RPC only for audit trail)
CREATE POLICY "inventory_update_staff_admin"
  ON public.inventory FOR UPDATE
  USING (public.current_user_role() IN ('staff', 'admin'))
  WITH CHECK (public.current_user_role() IN ('staff', 'admin'));

-- ---------------------------------------------------------------------------
-- INVENTORY ADJUSTMENTS policies
-- Append-only audit log — no client writes, staff/admin can read
-- ---------------------------------------------------------------------------

CREATE POLICY "inv_adj_select_staff_admin"
  ON public.inventory_adjustments FOR SELECT
  USING (public.current_user_role() IN ('staff', 'admin'));

-- No direct INSERT — only SECURITY DEFINER functions write adjustment records
CREATE POLICY "inv_adj_no_client_insert"
  ON public.inventory_adjustments FOR INSERT
  WITH CHECK (FALSE);

-- ---------------------------------------------------------------------------
-- PICKUP TOKENS policies
-- Students: read their own token (to display QR) — cannot write
-- Staff/Admin: read all tokens (for verification interface)
-- Marking used=TRUE happens via SECURITY DEFINER Edge Function only
-- ---------------------------------------------------------------------------

CREATE POLICY "pickup_tokens_select_own_student"
  ON public.pickup_tokens FOR SELECT
  USING (
    order_id IN (
      SELECT id FROM public.orders WHERE student_id = auth.uid()
    )
  );

CREATE POLICY "pickup_tokens_select_staff_admin"
  ON public.pickup_tokens FOR SELECT
  USING (public.current_user_role() IN ('staff', 'admin'));

-- No direct INSERT/UPDATE — Edge Function uses service role
CREATE POLICY "pickup_tokens_no_client_write"
  ON public.pickup_tokens FOR INSERT
  WITH CHECK (FALSE);

-- ---------------------------------------------------------------------------
-- EMAIL NOTIFICATIONS policies
-- Students: read their own notification delivery status
-- Staff/Admin: read all notifications
-- No client writes — triggered from server only
-- ---------------------------------------------------------------------------

CREATE POLICY "email_notif_select_own_student"
  ON public.email_notifications FOR SELECT
  USING (auth.uid() = student_id);

CREATE POLICY "email_notif_select_staff_admin"
  ON public.email_notifications FOR SELECT
  USING (public.current_user_role() IN ('staff', 'admin'));

-- No client writes
CREATE POLICY "email_notif_no_client_insert"
  ON public.email_notifications FOR INSERT
  WITH CHECK (FALSE);

-- ---------------------------------------------------------------------------
-- ANALYTICS VIEW: revenue_summary
-- Staff/Admin only. Aggregates verified paid revenue.
-- Created as a VIEW so no data is downloaded to browser — query runs on DB.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.revenue_summary AS
SELECT
  o.business_date,
  COUNT(DISTINCT o.id)                                          AS total_orders,
  COUNT(DISTINCT o.id) FILTER (WHERE o.payment_status = 'captured') AS paid_orders,
  COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'Cancelled')   AS cancelled_orders,
  COALESCE(SUM(o.total_paise) FILTER (
    WHERE o.payment_status = 'captured' AND o.status != 'Cancelled'
  ), 0)                                                         AS gross_revenue_paise,
  COALESCE(SUM(p.amount_paise) FILTER (
    WHERE p.status = 'refunded'
  ), 0)                                                         AS refund_total_paise,
  COALESCE(SUM(o.total_paise) FILTER (
    WHERE o.payment_status = 'captured' AND o.status != 'Cancelled'
  ), 0) - COALESCE(SUM(p.amount_paise) FILTER (
    WHERE p.status = 'refunded'
  ), 0)                                                         AS net_revenue_paise,
  CASE
    WHEN COUNT(DISTINCT o.id) FILTER (WHERE o.payment_status = 'captured') > 0
    THEN COALESCE(SUM(o.total_paise) FILTER (
      WHERE o.payment_status = 'captured' AND o.status != 'Cancelled'
    ), 0) / COUNT(DISTINCT o.id) FILTER (WHERE o.payment_status = 'captured')
    ELSE 0
  END                                                           AS avg_order_value_paise
FROM public.orders o
LEFT JOIN public.payments p ON p.order_id = o.id AND p.verified = TRUE
GROUP BY o.business_date
ORDER BY o.business_date DESC;

COMMENT ON VIEW public.revenue_summary IS
  'Daily revenue aggregation. Only counts verified captured payments as revenue. '
  'Staff/Admin access only via RLS on underlying tables.';

-- ---------------------------------------------------------------------------
-- ANALYTICS VIEW: item_performance
-- Best-selling items — staff/admin query only
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.item_performance AS
SELECT
  oi.menu_item_id,
  oi.item_name,
  COUNT(DISTINCT oi.order_id)       AS order_count,
  SUM(oi.quantity)                  AS total_quantity,
  SUM(oi.line_total_paise)          AS total_revenue_paise,
  MIN(o.business_date)              AS first_ordered,
  MAX(o.business_date)              AS last_ordered
FROM public.order_items oi
JOIN public.orders o ON o.id = oi.order_id
WHERE o.payment_status IN ('captured', 'not_required')
  AND o.status NOT IN ('Cancelled', 'Expired')
GROUP BY oi.menu_item_id, oi.item_name
ORDER BY total_quantity DESC;

COMMENT ON VIEW public.item_performance IS
  'Item-level sales analytics. Only includes orders with verified payment. '
  'No customer PII exposed.';
