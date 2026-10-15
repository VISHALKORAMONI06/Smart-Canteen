-- =============================================================================
-- SmartCanteen — Migration 001: Full Schema
-- Business timezone: Asia/Kolkata (IST, UTC+5:30)
-- Monetary values: stored as INTEGER paise (1 rupee = 100 paise)
-- =============================================================================

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- PROFILES
-- One row per authenticated user. Linked to auth.users.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'staff', 'admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.profiles IS 'Extended user profile. Role is the authoritative role — never trust client-supplied role.';
COMMENT ON COLUMN public.profiles.role IS 'student | staff | admin. Assigned by admin only.';

-- ---------------------------------------------------------------------------
-- MENU CATEGORIES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.menu_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  display_order INTEGER NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.menu_categories (name, display_order) VALUES
  ('Breakfast', 1),
  ('Lunch',     2),
  ('Snacks',    3),
  ('Beverages', 4),
  ('Desserts',  5)
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- MENU ITEMS
-- price_paise: INTEGER — avoids floating-point issues
-- archived_at: soft-delete; historical order_items retain name/price snapshot
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.menu_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  category       TEXT NOT NULL REFERENCES public.menu_categories(name) ON UPDATE CASCADE,
  image_url      TEXT NOT NULL DEFAULT '',
  price_paise    INTEGER NOT NULL CHECK (price_paise > 0 AND price_paise <= 500000),
  prep_time_mins INTEGER NOT NULL CHECK (prep_time_mins >= 1 AND prep_time_mins <= 120),
  available      BOOLEAN NOT NULL DEFAULT TRUE,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  archived_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT menu_items_name_active_unique UNIQUE NULLS NOT DISTINCT (name, archived_at)
);

COMMENT ON COLUMN public.menu_items.price_paise IS 'Price in paise (1 INR = 100 paise). Always integer.';
COMMENT ON COLUMN public.menu_items.archived_at IS 'NULL = active item. Set to NOW() to soft-delete. Preserves historical order data.';

CREATE INDEX IF NOT EXISTS idx_menu_items_category   ON public.menu_items(category);
CREATE INDEX IF NOT EXISTS idx_menu_items_available  ON public.menu_items(available) WHERE active = TRUE AND archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- DAILY TOKEN COUNTERS
-- One row per business date. Used with SELECT FOR UPDATE for atomicity.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_token_counters (
  business_date DATE PRIMARY KEY,
  counter       INTEGER NOT NULL DEFAULT 100
);

COMMENT ON TABLE public.daily_token_counters IS 'One row per business date (Asia/Kolkata). Counter starts at 100; next token = counter+1 = SC-101.';

-- ---------------------------------------------------------------------------
-- ORDERS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        UUID NOT NULL REFERENCES public.profiles(id),
  token             TEXT NOT NULL,            -- e.g. SC-101
  business_date     DATE NOT NULL,
  status            TEXT NOT NULL DEFAULT 'Placed'
                      CHECK (status IN ('Placed','Preparing','Ready','Collected','Cancelled','Expired')),
  subtotal_paise    INTEGER NOT NULL CHECK (subtotal_paise >= 0),
  total_paise       INTEGER NOT NULL CHECK (total_paise >= 0),
  student_note      TEXT NOT NULL DEFAULT '' CHECK (char_length(student_note) <= 200),
  estimated_pickup  TIMESTAMPTZ,
  idempotency_key   TEXT NOT NULL UNIQUE,
  -- Transition timestamps
  preparing_at      TIMESTAMPTZ,
  ready_at          TIMESTAMPTZ,
  collected_at      TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  cancelled_by      UUID REFERENCES public.profiles(id),
  cancel_reason     TEXT,
  -- Staff who performed last status update
  updated_by        UUID REFERENCES public.profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT orders_token_date_unique UNIQUE (business_date, token)
);

COMMENT ON COLUMN public.orders.total_paise IS 'Server-calculated total. Never trust client-submitted total.';
COMMENT ON COLUMN public.orders.idempotency_key IS 'UUID generated by client. UNIQUE prevents duplicate order submission on retry.';
COMMENT ON COLUMN public.orders.token IS 'Human-readable daily token: SC-101, SC-102, etc.';

CREATE INDEX IF NOT EXISTS idx_orders_student_id    ON public.orders(student_id);
CREATE INDEX IF NOT EXISTS idx_orders_business_date ON public.orders(business_date);
CREATE INDEX IF NOT EXISTS idx_orders_status        ON public.orders(status);

-- ---------------------------------------------------------------------------
-- ORDER ITEMS
-- Snapshots name and price at order time — immutable after creation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  menu_item_id        UUID REFERENCES public.menu_items(id) ON DELETE SET NULL,
  -- Snapshot fields — preserved even if menu item is edited/deleted
  item_name           TEXT NOT NULL,
  unit_price_paise    INTEGER NOT NULL CHECK (unit_price_paise > 0),
  quantity            INTEGER NOT NULL CHECK (quantity >= 1 AND quantity <= 20),
  prep_time_mins      INTEGER NOT NULL DEFAULT 10,
  line_total_paise    INTEGER NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_items_line_total_check CHECK (line_total_paise = unit_price_paise * quantity)
);

COMMENT ON TABLE public.order_items IS 'Immutable snapshot of items at order time. item_name and unit_price_paise are preserved regardless of menu edits.';

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items(order_id);

-- ---------------------------------------------------------------------------
-- APP SETTINGS
-- Single-row operational configuration table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_settings (
  id                        INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- enforces single row
  canteen_name              TEXT NOT NULL DEFAULT 'SmartCanteen',
  buffer_rate               NUMERIC(4,2) NOT NULL DEFAULT 0.10
                              CHECK (buffer_rate >= 0 AND buffer_rate <= 0.5),
  ordering_open             BOOLEAN NOT NULL DEFAULT TRUE,
  max_qty_per_item          INTEGER NOT NULL DEFAULT 10,
  max_items_per_order       INTEGER NOT NULL DEFAULT 20,
  business_timezone         TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  opening_time              TIME NOT NULL DEFAULT '07:00:00',
  closing_time              TIME NOT NULL DEFAULT '20:00:00',
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                UUID REFERENCES public.profiles(id)
);

-- Insert default settings row (singleton)
INSERT INTO public.app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- AUDIT LOGS
-- Append-only log of administrative and staff actions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID REFERENCES public.profiles(id),
  action      TEXT NOT NULL,               -- e.g. 'order.status_changed', 'menu.item_updated'
  entity_type TEXT NOT NULL,               -- e.g. 'order', 'menu_item', 'settings'
  entity_id   TEXT,                        -- UUID or other identifier
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id    ON public.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON public.audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at  ON public.audit_logs(created_at DESC);

-- ---------------------------------------------------------------------------
-- AUTO-UPDATE updated_at via trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_menu_items_updated_at
  BEFORE UPDATE ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- AUTO-CREATE PROFILE on auth.users INSERT
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    'student'  -- All new registrations default to 'student' role
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
