-- =============================================================================
-- SmartCanteen — Migration 005: Payments, Inventory, Pickup Tokens, Emails
-- Forward-only migration. Do NOT modify existing tables from migrations 001–004.
-- All monetary values: INTEGER paise (1 INR = 100 paise).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- EXTEND orders table: add payment_status and pickup_token columns
-- Orders now require payment before being confirmed.
-- New statuses: PendingPayment (awaiting Razorpay), Confirmed (paid).
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (payment_status IN ('not_required','pending','captured','failed','refunded')),
  ADD COLUMN IF NOT EXISTS payment_method TEXT CHECK (payment_method IN ('razorpay','counter','free')),
  ADD COLUMN IF NOT EXISTS confirmed_at   TIMESTAMPTZ;

-- Update status CHECK to allow PendingPayment and Confirmed
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'PendingPayment','Placed','Confirmed','Preparing','Ready','Collected','Cancelled','Expired'
  ));

COMMENT ON COLUMN public.orders.payment_status IS
  'Razorpay payment state. not_required = counter payment (legacy). captured = verified paid.';
COMMENT ON COLUMN public.orders.confirmed_at IS
  'Set when payment is captured and order transitions from PendingPayment to Confirmed.';

-- ---------------------------------------------------------------------------
-- PAYMENTS
-- One row per Razorpay payment attempt linked to one order.
-- Immutable once verified = TRUE.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              UUID NOT NULL REFERENCES public.orders(id),
  student_id            UUID NOT NULL REFERENCES public.profiles(id),

  -- Razorpay identifiers
  razorpay_order_id     TEXT UNIQUE,     -- rzp order: order_...
  razorpay_payment_id   TEXT UNIQUE,     -- rzp payment: pay_...
  razorpay_signature    TEXT,            -- HMAC stored after verification (not secret)

  -- Amount (always in paise, always from server — NEVER client-supplied)
  amount_paise          INTEGER NOT NULL CHECK (amount_paise > 0),
  currency              TEXT NOT NULL DEFAULT 'INR',

  -- Status lifecycle
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','authorized','captured','failed','refunded')),
  verified              BOOLEAN NOT NULL DEFAULT FALSE,

  -- Failure metadata (safe — no card/PIN data ever stored here)
  failure_code          TEXT,
  failure_description   TEXT,

  -- Idempotency: one payment record per unique checkout attempt
  idempotency_key       TEXT NOT NULL UNIQUE,

  -- Webhook event log (array of received event names for dedup)
  webhook_events        JSONB NOT NULL DEFAULT '[]'::JSONB,

  -- Timestamps
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at           TIMESTAMPTZ,
  captured_at           TIMESTAMPTZ,
  failed_at             TIMESTAMPTZ,
  refunded_at           TIMESTAMPTZ
);

COMMENT ON TABLE public.payments IS
  'Razorpay payment records. verified=TRUE means server-side signature check passed. '
  'NEVER store card numbers, CVVs, UPI PINs, or raw secrets here.';
COMMENT ON COLUMN public.payments.razorpay_signature IS
  'HMAC-SHA256 of razorpay_order_id|razorpay_payment_id. Stored for audit, not a secret.';
COMMENT ON COLUMN public.payments.idempotency_key IS
  'Client-generated UUID. Prevents duplicate Razorpay orders on retry.';

CREATE INDEX IF NOT EXISTS idx_payments_order_id       ON public.payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_student_id     ON public.payments(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_rzp_order_id   ON public.payments(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status         ON public.payments(status);

-- Auto-update updated_at (CREATE OR REPLACE = retry-safe)
CREATE OR REPLACE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- INVENTORY
-- One row per menu item. track_inventory=FALSE means unlimited stock.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory (
  menu_item_id          UUID PRIMARY KEY REFERENCES public.menu_items(id) ON DELETE CASCADE,
  stock_quantity        INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  low_stock_threshold   INTEGER NOT NULL DEFAULT 5  CHECK (low_stock_threshold >= 0),
  track_inventory       BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by            UUID REFERENCES public.profiles(id)
);

COMMENT ON TABLE public.inventory IS
  'Stock quantities per menu item. If track_inventory=FALSE, stock is treated as unlimited.';
COMMENT ON COLUMN public.inventory.stock_quantity IS
  'Available units. Cannot go below 0 (CHECK constraint). '
  'Decremented when payment captured, not at cart/order creation.';
COMMENT ON COLUMN public.inventory.low_stock_threshold IS
  'Display low-stock warning to students when stock_quantity <= this value.';

-- Seed inventory rows for existing menu items (unlimited by default)
INSERT INTO public.inventory (menu_item_id, track_inventory, stock_quantity)
SELECT id, FALSE, 0
FROM public.menu_items
WHERE active = TRUE AND archived_at IS NULL
ON CONFLICT (menu_item_id) DO NOTHING;

-- Auto-update updated_at (CREATE OR REPLACE = retry-safe)
CREATE OR REPLACE TRIGGER trg_inventory_updated_at
  BEFORE UPDATE ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- INVENTORY ADJUSTMENTS
-- Append-only audit trail for every stock change.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_adjustments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id    UUID NOT NULL REFERENCES public.menu_items(id),
  delta           INTEGER NOT NULL,       -- positive = stock added, negative = deducted
  reason          TEXT NOT NULL           -- 'order_fulfilled','order_cancelled','manual_set','manual_adjust'
                    CHECK (reason IN ('order_fulfilled','order_cancelled','manual_set','manual_adjust','initial')),
  order_id        UUID REFERENCES public.orders(id),
  actor_id        UUID REFERENCES public.profiles(id),
  note            TEXT,
  stock_before    INTEGER,
  stock_after     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.inventory_adjustments IS
  'Immutable stock change audit log. Every inventory.stock_quantity change must have a row here.';

CREATE INDEX IF NOT EXISTS idx_inv_adj_menu_item ON public.inventory_adjustments(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_inv_adj_order_id  ON public.inventory_adjustments(order_id);
CREATE INDEX IF NOT EXISTS idx_inv_adj_created   ON public.inventory_adjustments(created_at DESC);

-- ---------------------------------------------------------------------------
-- PICKUP TOKENS
-- One per order. Generated after payment captured (or immediately for counter orders).
-- Token is 16-byte random hex — never sequential IDs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pickup_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  used_at     TIMESTAMPTZ,
  used_by     UUID REFERENCES public.profiles(id),  -- staff who verified
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.pickup_tokens IS
  'Secure pickup verification tokens. Token is 32-char random hex, never sequential. '
  'used=TRUE is set atomically — duplicate scans are rejected.';
COMMENT ON COLUMN public.pickup_tokens.token IS
  '16 random bytes encoded as hex (32 chars). Unpredictable. Never expose order IDs as tokens.';

CREATE INDEX IF NOT EXISTS idx_pickup_tokens_order_id ON public.pickup_tokens(order_id);
CREATE INDEX IF NOT EXISTS idx_pickup_tokens_token    ON public.pickup_tokens(token);

-- ---------------------------------------------------------------------------
-- EMAIL NOTIFICATIONS
-- Delivery tracking per email. Prevents duplicate sends on webhook retry.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID REFERENCES public.orders(id),
  student_id    UUID NOT NULL REFERENCES public.profiles(id),
  email_type    TEXT NOT NULL
                  CHECK (email_type IN (
                    'order_confirmed','payment_receipt','order_ready',
                    'payment_failed','order_cancelled','order_ready_pickup'
                  )),
  recipient     TEXT NOT NULL,  -- email address; not PII beyond what user provided
  status        TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','sent','failed','skipped')),
  provider_id   TEXT,           -- Resend message ID for dedup
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique: one email of each type per order (prevents duplicate sends)
  CONSTRAINT email_notifications_order_type_unique
    UNIQUE NULLS NOT DISTINCT (order_id, email_type)
);

COMMENT ON TABLE public.email_notifications IS
  'Email delivery records. Unique on (order_id, email_type) prevents duplicate sends. '
  'Status sent/skipped = do not retry. failed + attempts < 3 = retry eligible.';

CREATE INDEX IF NOT EXISTS idx_email_notif_order_id   ON public.email_notifications(order_id);
CREATE INDEX IF NOT EXISTS idx_email_notif_student_id ON public.email_notifications(student_id);
CREATE INDEX IF NOT EXISTS idx_email_notif_status     ON public.email_notifications(status)
  WHERE status IN ('queued','failed');

-- Auto-update updated_at (CREATE OR REPLACE = retry-safe)
CREATE OR REPLACE TRIGGER trg_email_notif_updated_at
  BEFORE UPDATE ON public.email_notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Enable RLS on all new tables (policies in migration 006)
-- ---------------------------------------------------------------------------
ALTER TABLE public.payments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pickup_tokens         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_notifications   ENABLE ROW LEVEL SECURITY;
