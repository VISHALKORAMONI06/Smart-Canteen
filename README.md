# SmartCanteen 🍽️

**College Canteen Pre-Ordering & Food Demand Management Web Application**

A production-grade, real-time web app for college canteens. Built with **React 18, Vite, and Supabase**. Supports both an offline **demo mode** (LocalStorage, zero backend) and a **live mode** (Supabase — PostgreSQL, Auth, and Realtime).

---

## 🌟 Key Features

### For Students
- **Visual Dish Menu**: High-contrast, editorial layout with category filters and search.
- **Cart & Tray Review**: Real-time portion tallying, automatic estimated pickup time, kitchen notes.
- **Secure Pre-Ordering**: Order placed via an atomic RPC — server validates availability and price. Client-supplied prices are never trusted.
- **Order Tracking**: Visual 4-stage timeline (*Placed → Preparing → Ready → Collected*) with token hero banners. Updated in real time.

### For Staff & Kitchen Counter
- **Kitchen Queue**: Live pre-order cards updated in real time across all devices. Status filter chips, token search.
- **Status Lifecycle**: Single-click linear progression (*Mark Preparing → Mark Ready → Mark Collected*). Validated server-side.
- **History Accordion**: Completed and expired orders with exact timestamps.
- **Menu Management**: Add/edit dishes, toggle availability, soft-delete (preserves history).

### Demand Management Dashboard
- **Preparation Target Engine**: Live cooking requirements from pre-orders with adjustable walk-in buffer (0–50%).
- **Pure CSS Bar Charts**: Pre-orders vs recommended batch sizes per item.
- **Printable Kitchen Prep Sheet**: Built-in `window.print()` styling.

---

## 🚀 Quick Start

### Demo Mode (No backend, zero setup)
```bash
npm install
npm run dev
# Open http://localhost:3000
```
The app runs fully in LocalStorage. Use the Student/Staff role switcher in the header. Load sample orders from the footer to populate the demand dashboard.

### Live Mode (Supabase backend)
See **[SETUP.md](./SETUP.md)** for the full step-by-step guide.

```bash
cp .env.example .env
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

---

## 🏗️ Architecture

```
SmartCanteen
│
├─ Frontend (React 18 + Vite)
│   ├─ src/App.jsx              — Root: auth routing + layout
│   ├─ src/context/AppContext.jsx — Unified context (composed from hooks)
│   ├─ src/hooks/
│   │   ├─ useAuth.js           — Session, profile, role
│   │   ├─ useMenu.js           — Menu + realtime subscription
│   │   ├─ useOrders.js         — Orders + realtime subscription
│   │   └─ useSettings.js       — Buffer rate, canteen open/close
│   ├─ src/services/
│   │   ├─ authService.js       — signIn / signUp / signOut
│   │   ├─ menuService.js       — fetchMenu / addItem / toggleAvailability
│   │   ├─ orderService.js      — placeOrder (RPC) / fetchOrders / subscribe
│   │   └─ settingsService.js   — fetchSettings / updateBufferRate
│   ├─ src/lib/supabaseClient.js — Singleton client + isSupabaseConfigured flag
│   └─ src/components/          — 13 UI components (UI unchanged)
│
├─ Backend (Supabase — optional)
│   └─ supabase/migrations/
│       ├─ 001_schema.sql       — 8 tables, triggers, auto-profile creation
│       ├─ 002_rls.sql          — Row-Level Security policies
│       ├─ 003_functions.sql    — Secure RPCs (place_order, transition_order_status, ...)
│       └─ 004_seed.sql         — 15 default menu items
│
└─ Tests
    ├─ scratch/test_supabase_rls.mjs       — RLS policy verification
    └─ scratch/test_token_allocation.mjs   — Token concurrency & idempotency
```

---

## 📐 Business Rules

### Token Allocation (`SC-101`, `SC-102`, ...)

**Demo mode**: Sequential counter in LocalStorage. Day-reconciled to prevent gaps.

**Live mode**: Atomic PostgreSQL sequence using `SELECT FOR UPDATE` on the `daily_token_counters` table. Race conditions are impossible — the row is locked for the duration of each token allocation.

### Order Placement Security

The `place_order()` RPC (SECURITY DEFINER) enforces:
1. User must be authenticated as `student` role
2. Canteen must be open (`ordering_open = TRUE`)
3. Current time must be within operating hours
4. Each cart item is validated against live server prices
5. Unavailable items are rejected
6. Token allocated atomically
7. `idempotency_key` prevents duplicate submissions on retry

### Demand & Buffer Calculation

$$\text{Buffer} = \lceil \text{TotalOrdered} \times \text{BufferRate} \rceil$$
$$\text{Recommended Prep} = \text{TotalOrdered} + \text{Buffer}$$

Default `bufferRate = 0.10` (10%). Adjustable by staff/admin in real time via the Demand Dashboard slider.

### Estimated Pickup Time

$$\text{Pickup} = \text{Order Time} + \max(\text{prep times}) + 5\text{ min queue buffer}$$

Rounded up to the nearest 5 minutes.

---

## 📁 Project Structure

```
Smart Canteen final/
├── index.html                     # Google Fonts (Playfair Display + DM Sans)
├── vite.config.js                 # Vite — port 3000
├── package.json                   # React 18 + Supabase JS + Vite
├── .env.example                   # Copy to .env and fill in credentials
├── .gitignore
├── SETUP.md                       # Full Supabase setup guide
├── supabase/migrations/
│   ├── 001_schema.sql             # Tables, indexes, triggers
│   ├── 002_rls.sql                # Row-Level Security policies
│   ├── 003_functions.sql          # RPCs: place_order, transition_order_status, ...
│   └── 004_seed.sql               # Default 15-item menu data
├── scratch/
│   ├── test_supabase_rls.mjs      # RLS tests (npm run test:rls)
│   └── test_token_allocation.mjs  # Token concurrency tests (npm run test:tokens)
└── src/
    ├── main.jsx
    ├── App.jsx                    # Auth routing + view switcher
    ├── App.css                    # Full design system (cream/beige palette)
    ├── lib/
    │   └── supabaseClient.js      # Supabase singleton + isSupabaseConfigured flag
    ├── context/
    │   └── AppContext.jsx         # Unified context composing all hooks
    ├── hooks/
    │   ├── useAuth.js             # Auth session + profile + role
    │   ├── useMenu.js             # Menu CRUD + realtime
    │   ├── useOrders.js           # Order placement + status + realtime
    │   └── useSettings.js        # Settings sync
    ├── services/
    │   ├── authService.js
    │   ├── menuService.js
    │   ├── orderService.js
    │   └── settingsService.js
    ├── components/
    │   ├── AuthPage.jsx           # Sign in / Sign up UI
    │   ├── Header.jsx             # Auth-aware navigation
    │   ├── Footer.jsx             # Demo/live mode indicator
    │   ├── FoodCard.jsx
    │   ├── FoodImage.jsx
    │   ├── StudentMenu.jsx
    │   ├── Cart.jsx
    │   ├── OrdersPage.jsx
    │   ├── StaffOrders.jsx
    │   ├── DemandDashboard.jsx
    │   ├── MenuManagement.jsx
    │   ├── StatusBadge.jsx
    │   ├── Toast.jsx
    │   └── ConfirmDialog.jsx
    └── utils/
        ├── dates.js               # Date keys, pickup time calc, order expiry
        ├── demand.js              # Pure demand + buffer math
        ├── sampleOrders.js        # Demo orders for viva
        ├── seedMenu.js            # 15 canteen dishes
        ├── storage.js             # safeLoad / safeSave wrappers
        └── tokens.js             # Demo-mode token allocator
```

---

## 🔐 Security Model

| Concern | Solution |
|---------|----------|
| Price tampering | `place_order()` fetches server prices — client totals ignored |
| Token races | `SELECT FOR UPDATE` row lock on `daily_token_counters` |
| Duplicate orders | `idempotency_key UNIQUE` constraint + replay detection |
| Cross-user data access | RLS: student can only SELECT own `orders` |
| Role escalation | RLS `WITH CHECK` prevents self-promotion; only admin can set roles |
| Secret keys | Only anon key in frontend; service_role key never exposed |
| Audit trail | All staff actions written to `audit_logs` (append-only) |

---

## 🎬 2-Minute Viva Demonstration Script

### Demo Mode (no Supabase configured)

1. **Introduction (15s)** — Show header, explain Student/Staff role switcher. Note demo mode footer indicator.
2. **Student Order (30s)** — Filter "Beverages", add 2 Masala Dosas + 3 Chais. Show cart badge (5), estimated pickup, sold-out guard on Chole Bhature.
3. **Place Order (25s)** — Place pre-order. Show token (`SC-109`), toast, and My Orders tracking timeline.
4. **Kitchen Lifecycle (25s)** — Switch to Staff. Mark Preparing → Ready → Collected. Switch back to Student to show live status update.
5. **Demand Dashboard (25s)** — Show demand KPIs, adjust buffer slider from 10% → 20%, watch recommendations recalculate. Show the CSS bar chart and print prep sheet.

### Live Mode (Supabase configured)

Same flow, but:
- Sign in/sign up with email + password
- All data persists across devices and browser refreshes
- Kitchen staff on a different device see new orders instantly

---

## 📦 npm Scripts

```bash
npm run dev          # Start Vite dev server on port 3000
npm run build        # Production build to /dist
npm run preview      # Preview production build

npm run test:rls     # RLS policy verification tests
npm run test:tokens  # Token concurrency + idempotency tests
npm run test:all     # Run all tests
```
