# SmartCanteen — Supabase Setup Guide

> **Complete step-by-step instructions for connecting SmartCanteen to Supabase.**
> Estimated time: 10–15 minutes.

---

## Overview

SmartCanteen works in **two modes**:

| Mode | Description |
|------|-------------|
| **Demo Mode** (default) | No backend needed. All data in LocalStorage. Single-device only. Perfect for viva/demo. |
| **Live Mode** | Supabase backend. Real-time multi-device sync, persistent data, secure auth. |

The app **automatically detects** which mode to use based on whether `VITE_SUPABASE_URL` is set in `.env`.

---

## Step 1 — Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in (or create a free account).
2. Click **"New project"**.
3. Fill in:
   - **Project name**: `SmartCanteen`
   - **Database password**: choose a strong password and **save it** — you'll need it for DB access.
   - **Region**: choose the closest one to your location (e.g., `ap-south-1` for India).
4. Click **"Create new project"** and wait ~2 minutes for provisioning.

---

## Step 2 — Get Your API Keys

1. In your Supabase project dashboard, go to **Settings → API**.
2. Copy:
   - **Project URL**: looks like `https://xxxxxxxxxxxx.supabase.co`
   - **anon / public key**: a long JWT string beginning with `eyJ...`

> ⚠️ **NEVER copy the `service_role` key** — it bypasses all security. It must never go in frontend code.

---

## Step 3 — Configure Environment Variables

In the project root, copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Then edit `.env` with your actual values:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

> `.env` is already in `.gitignore` — it will **never be committed**.

---

## Step 4 — Run the Database Migrations

Go to your Supabase project → **SQL Editor** → click **"New query"**.

Run each migration file **in order** by pasting and executing:

### Migration 1 — Schema (Tables, Indexes, Triggers)

Paste contents of: `supabase/migrations/001_schema.sql`

Click **"Run"** → should complete with no errors.

---

### Migration 2 — Row-Level Security Policies

Paste contents of: `supabase/migrations/002_rls.sql`

Click **"Run"** → should complete with no errors.

---

### Migration 3 — Secure Database Functions (RPCs)

Paste contents of: `supabase/migrations/003_functions.sql`

Click **"Run"** → should complete with no errors.

---

### Migration 4 — Seed Data (Default Menu)

Paste contents of: `supabase/migrations/004_seed.sql`

Click **"Run"** → inserts the 15 default dishes.

---

## Step 5 — Enable Realtime

In your Supabase project → **Database → Replication**:

1. Click on the `supabase_realtime` publication.
2. Under **"Tables in publication"**, enable:
   - ✅ `menu_items`
   - ✅ `orders`
   - ✅ `order_items`
   - ✅ `app_settings`

This enables real-time push for all connected browsers.

Alternatively, run in SQL Editor:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.menu_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings;
```

---

## Step 6 — Configure Auth Settings

In Supabase → **Authentication → Settings**:

1. **Email confirmations**: For development/viva, you may want to **disable** email confirmation so users can sign in immediately after signup. (Toggle off "Confirm email".)
2. **Site URL**: Set to `http://localhost:3000` (for development) or your deployed URL.
3. **Redirect URLs**: Add `http://localhost:3000` and your production URL.

---

## Step 7 — Create Staff / Admin Accounts

All new sign-ups automatically get the `student` role. To promote a user to `staff` or `admin`:

1. First, have the user create an account via the SmartCanteen app.
2. In Supabase → **Table Editor → `profiles`**, find the user's row.
3. Edit the `role` column: change `student` → `staff` or `admin`.

> Only the `admin` role can change canteen open/close status, modify other roles, and view audit logs.

---

## Step 8 — Run the App

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you should see the **Sign In** page if Supabase is configured correctly.

---

## Step 9 — Run Tests (Optional)

After setting up test accounts in Supabase Auth:

```bash
# Set these additional env vars in .env:
TEST_EMAIL_1=student1@test.local
TEST_EMAIL_2=student2@test.local
TEST_PASSWORD=TestPass123!
TEST_MENU_ITEM_ID=<UUID of any active menu item from Supabase>

# Run RLS policy tests:
npm run test:rls

# Run token concurrency tests:
npm run test:tokens
```

---

## Database Schema Reference

```
auth.users                        ← Managed by Supabase Auth
public.profiles                   ← id, display_name, role
public.menu_categories            ← name, display_order
public.menu_items                 ← name, category, price_paise, prep_time_mins, available
public.orders                     ← token (SC-101), status, total_paise, idempotency_key
public.order_items                ← snapshot of name + price at order time
public.daily_token_counters       ← business_date, counter (atomic)
public.app_settings               ← buffer_rate, ordering_open (singleton row)
public.audit_logs                 ← append-only action log
```

---

## Business Rules Enforced Server-Side

| Rule | Where enforced |
|------|---------------|
| Server-calculated prices (never trust client) | `place_order()` RPC |
| Atomic daily token allocation (no duplicates) | `allocate_daily_token()` with `SELECT FOR UPDATE` |
| Idempotent order submission (safe retries) | `idempotency_key UNIQUE` constraint |
| Only student role can place orders | `place_order()` SECURITY DEFINER |
| Only staff/admin can transition order status | `transition_order_status()` SECURITY DEFINER |
| Student can only see own orders | RLS policy on `orders` table |
| Menu prices immutable after order | `order_items` snapshot fields |

---

## Troubleshooting

### App shows demo mode even after setting .env
- Ensure you **restarted** the dev server (`npm run dev`) after editing `.env`.
- Vite only reads `.env` at startup.

### "Invalid API key" error in browser
- Check that `VITE_SUPABASE_ANON_KEY` is the **anon/public** key, not the `service_role` key.

### Sign in doesn't work after sign up
- Email confirmation might be on. Disable it in Supabase Auth settings (see Step 6).

### Orders not appearing in real time
- Ensure Realtime is enabled for `orders` and `order_items` tables (see Step 5).

### RPC returns "UNAUTHENTICATED"
- The user session has expired. They need to sign in again.

### Menu shows wrong data
- In live mode, data comes from Supabase — not LocalStorage. Run migration 004 to seed data.

---

## Deployment Checklist (Production)

- [ ] `.env` is **not** committed to git
- [ ] Email confirmation is **enabled** for real users
- [ ] `Site URL` and `Redirect URLs` updated in Supabase Auth settings to production domain
- [ ] All 4 migrations run successfully
- [ ] Realtime enabled for `menu_items`, `orders`, `order_items`, `app_settings`
- [ ] At least one `admin` account created
- [ ] Run `npm run build` without errors
- [ ] `npm run test:rls` passes
