-- =============================================================================
-- SmartCanteen — Migration 002: Row-Level Security (RLS) Policies
-- =============================================================================

-- Enable RLS on all public-facing tables
ALTER TABLE public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_token_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs        ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- HELPER: get the current user's role from profiles
-- Used inside RLS policies. SECURITY DEFINER to bypass RLS on profiles.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- PROFILES policies
-- ---------------------------------------------------------------------------

-- Any authenticated user can read their own profile
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Staff/admin can read all profiles (for display names on orders)
CREATE POLICY "profiles_select_staff_admin"
  ON public.profiles FOR SELECT
  USING (public.current_user_role() IN ('staff', 'admin'));

-- User can update only their own non-role fields
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
    -- Students cannot change their own role
  );

-- Admin can update any profile (including role assignment)
CREATE POLICY "profiles_update_admin"
  ON public.profiles FOR UPDATE
  USING (public.current_user_role() = 'admin');

-- No direct INSERT (handled by handle_new_user trigger)
-- No DELETE allowed via RLS

-- ---------------------------------------------------------------------------
-- MENU CATEGORIES policies
-- ---------------------------------------------------------------------------

-- Everyone (including anon) can read active categories
CREATE POLICY "menu_categories_select_all"
  ON public.menu_categories FOR SELECT
  USING (active = TRUE);

-- Admin can manage categories
CREATE POLICY "menu_categories_all_admin"
  ON public.menu_categories FOR ALL
  USING (public.current_user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- MENU ITEMS policies
-- ---------------------------------------------------------------------------

-- Authenticated students and anon can read active, non-archived items
CREATE POLICY "menu_items_select_active"
  ON public.menu_items FOR SELECT
  USING (active = TRUE AND archived_at IS NULL);

-- Staff and admin can also see inactive/archived items (for management)
CREATE POLICY "menu_items_select_staff_admin"
  ON public.menu_items FOR SELECT
  USING (public.current_user_role() IN ('staff', 'admin'));

-- Staff can toggle availability
CREATE POLICY "menu_items_update_availability_staff"
  ON public.menu_items FOR UPDATE
  USING (public.current_user_role() IN ('staff', 'admin'))
  WITH CHECK (public.current_user_role() IN ('staff', 'admin'));

-- Admin can insert/update/delete menu items
CREATE POLICY "menu_items_insert_admin"
  ON public.menu_items FOR INSERT
  WITH CHECK (public.current_user_role() IN ('admin', 'staff'));

-- Admin can archive items (soft delete)
CREATE POLICY "menu_items_delete_admin"
  ON public.menu_items FOR DELETE
  USING (public.current_user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- ORDERS policies
-- ---------------------------------------------------------------------------

-- Students can read only their own orders
CREATE POLICY "orders_select_own_student"
  ON public.orders FOR SELECT
  USING (auth.uid() = student_id);

-- Staff and admin can read all orders
CREATE POLICY "orders_select_staff_admin"
  ON public.orders FOR SELECT
  USING (public.current_user_role() IN ('staff', 'admin'));

-- Students CANNOT insert orders directly — must go through place_order() RPC
-- Staff CANNOT insert orders directly either
-- (INSERT via RPC with SECURITY DEFINER only)

-- Staff can update order status (via transition_order_status() RPC)
-- Direct UPDATE is not allowed — only via RPC
-- This ensures all transitions are validated server-side

-- ---------------------------------------------------------------------------
-- ORDER ITEMS policies
-- ---------------------------------------------------------------------------

-- Students can read order items belonging to their own orders
CREATE POLICY "order_items_select_own"
  ON public.order_items FOR SELECT
  USING (
    order_id IN (
      SELECT id FROM public.orders WHERE student_id = auth.uid()
    )
  );

-- Staff/admin can read all order items
CREATE POLICY "order_items_select_staff_admin"
  ON public.order_items FOR SELECT
  USING (public.current_user_role() IN ('staff', 'admin'));

-- No direct INSERT/UPDATE/DELETE by clients — handled by RPCs only

-- ---------------------------------------------------------------------------
-- DAILY TOKEN COUNTERS
-- No client access — managed by place_order() RPC only
-- ---------------------------------------------------------------------------

CREATE POLICY "daily_token_counters_no_access"
  ON public.daily_token_counters FOR ALL
  USING (FALSE); -- Nobody can access directly; only SECURITY DEFINER functions

-- ---------------------------------------------------------------------------
-- APP SETTINGS policies
-- ---------------------------------------------------------------------------

-- Everyone authenticated can read settings (canteen open/close, buffer rate)
CREATE POLICY "app_settings_select_authenticated"
  ON public.app_settings FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Unauthenticated users can also read ordering_open status
CREATE POLICY "app_settings_select_anon"
  ON public.app_settings FOR SELECT
  USING (TRUE);

-- Admin can update settings
CREATE POLICY "app_settings_update_admin"
  ON public.app_settings FOR UPDATE
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- AUDIT LOGS policies
-- ---------------------------------------------------------------------------

-- Admin can read all audit logs
CREATE POLICY "audit_logs_select_admin"
  ON public.audit_logs FOR SELECT
  USING (public.current_user_role() = 'admin');

-- Staff can read audit logs related to their actions
CREATE POLICY "audit_logs_select_own_staff"
  ON public.audit_logs FOR SELECT
  USING (
    public.current_user_role() = 'staff'
    AND actor_id = auth.uid()
  );

-- No client INSERT — only SECURITY DEFINER RPCs write audit logs
CREATE POLICY "audit_logs_insert_rpc_only"
  ON public.audit_logs FOR INSERT
  WITH CHECK (FALSE); -- Only SECURITY DEFINER functions can insert

-- No UPDATE or DELETE allowed on audit logs by anyone
