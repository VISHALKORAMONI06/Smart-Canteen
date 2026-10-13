# SmartCanteen 🍽️

**College Canteen Pre-Ordering & Food Demand Management Web Application**

A self-contained, high-performance web app designed for college canteens. Built with pure React and Vite, featuring zero third-party UI kits or backend dependencies. Created to be simple, robust, and crystal-clear for college viva defense and academic demonstration.

---

## 🌟 Key Features

### For Students
- **Visual Dish Menu**: High-contrast, editorial layout with Google Fonts (*Playfair Display* & *DM Sans*), dish descriptions, preparation times, and instant category filters (*Breakfast, Lunch, Snacks, Beverages, Desserts*).
- **Graceful Network Fallbacks**: Automatically falls back to styled serif initial badges if offline or if images fail to load.
- **Cart & Tray Review**: Real-time portion tallying, automatic estimated pickup calculation, kitchen notes input, and sold-out dish safety guards.
- **Single-Click Pre-Ordering**: In-app modal confirmation with double-submit debouncing.
- **Order Tracking**: Visual 4-stage order stepper (*Placed → Preparing → Ready → Collected*) with prominent token hero banners.

### For Staff & Kitchen Counter
- **Kitchen Counter Queue**: Live pre-order cards sorted by urgency, real-time status filter chips with order counts, and single-click linear stage progression (*Mark Preparing → Mark Ready → Mark Collected*).
- **History Accordion**: Instant log of completed and expired orders with exact timestamps.
- **Menu Management**: In-line category grouping, instant availability toggle switches, and an inline-validated modal to add or edit dishes (price bounds, prep times, name uniqueness).

### Demand Management Dashboard
- **Preparation Target Engine**: Automatically computes live cooking requirements from incoming orders with an adjustable walk-in student buffer rate (0% to 50%, default +10%).
- **Interactive Visualizations**: Pure CSS horizontal bar charts comparing pre-orders vs recommended batch sizes, plus category demand breakdowns.
- **Printable Kitchen Prep Sheet**: Built-in printer-friendly styles (`window.print()`) for kitchen prep sheets.

---

## 🚀 How to Run Locally

### Prerequisites
- Node.js (v18+ recommended)
- npm (v9+ recommended)

### Quick Start
```bash
# 1. Install dependencies
npm install

# 2. Start the Vite development server
npm run dev

# 3. Open in your browser
http://localhost:3000/
```

To build for production verification:
```bash
npm run build
npm run preview
```

---

## 📐 Business Rules Explained (For Viva Defense)

### 1. The Token Allocation Rule (`src/utils/tokens.js`)
- Tokens follow the sequential pattern `SC-101`, `SC-102`, `SC-103`, etc.
- **Allocator Logic**: On order submission, the allocator checks if the stored `dateKey` matches today's date (`YYYY-MM-DD`).
  - If a new day has started, the counter resets to base **100**.
  - **Reconciliation**: To prevent token duplication, the counter is reconciled against the highest existing token number found in saved orders for that day:
    $$\text{counter} = \max(\text{storedCounter}, \text{highestTokenFound})$$
  - The next assigned token is `SC-${counter + 1}`.
- *Viva Note*: In this demo, the allocator uses LocalStorage. In a production multi-device environment, this would be an atomic database sequence to prevent race conditions.

### 2. The Demand & Buffer Calculation Rule (`src/utils/demand.js`)
- **Total Demand Today**: The sum of all ordered dish quantities where `dateKey === today` and `status !== 'Expired'`. (Note: **Collected orders remain included**, so demand reflects the full day's consumption).
- **Active Orders**: Orders with status `Placed`, `Preparing`, or `Ready`.
- **Still to Cook (Pending)**: Quantities from orders currently in `Placed` status only (`Preparing` and `Ready` items are already on the stove/counter).
- **Heuristic Buffer Formula**:
  $$\text{Buffer} = \lceil \text{Ordered} \times \text{Buffer Rate} \rceil$$
  $$\text{Recommended Prep} = \text{Ordered} + \text{Buffer}$$
  *Example*: If 20 portions of Masala Dosa are ordered with a 10% buffer rate ($0.10$):
  $$\text{Buffer} = \lceil 20 \times 0.10 \rceil = 2$$
  $$\text{Recommended} = 20 + 2 = 22 \text{ units}$$
- *Viva Note*: The buffer is explicitly labeled in the UI as a simple heuristic rule for walk-in students, not an opaque AI prediction.

### 3. Estimated Pickup Time (`src/utils/dates.js`)
- Calculated as:
  $$\text{Pickup Time} = \text{Order Time} + \max(\text{prep times of items}) + 5 \text{ min queue buffer}$$
- Rounded up to the nearest **5 minutes** (e.g., 11:41 AM + 17 min = 11:58 AM → rounded to 12:00 PM).

### 4. LocalStorage & Offline Resilience (`src/utils/storage.js`)
- All application state is stored locally under keys prefixed with `smartcanteen:`:
  - `smartcanteen:menu`
  - `smartcanteen:cart`
  - `smartcanteen:orders`
  - `smartcanteen:tokenState`
  - `smartcanteen:settings`
- Reads use `safeLoad(key, fallback, validator)` with `try/catch` and schema validation. Even if storage is corrupted (e.g. invalid JSON `"{bad"`), the application recovers smoothly with defaults instead of crashing.

---

## 🎬 2-Minute Viva Demonstration Script

When presenting to your viva examiner, follow this seamless 2-minute walkthrough:

1. **Step 1: Introduction (15s)**
   - Show the header: point out the **Student / Staff** segmented role switcher and the editorial palette.
   - Mention that data is completely self-contained in the browser via LocalStorage with zero backend required.

2. **Step 2: Student Menu & Cart (30s)**
   - Filter by `Beverages` or search for *"Dosa"*.
   - Add **2 Masala Dosas** and **3 Masala Chais**. Show how the **Cart Badge** in the header immediately updates to **5**.
   - Navigate to the **Cart**: show the calculated items count (5), total (₹165), estimated pickup time (e.g., 12:05 PM), and queue buffer.
   - Point out the sold-out guard: Chole Bhature is marked "SOLD OUT" and cannot be added.

3. **Step 3: Pre-Order Confirmation & Token Generation (25s)**
   - Click **Place Pre-Order**. Show the in-app confirmation modal with double-submit protection.
   - Confirm the order: show the toast notification announcing **Token SC-109** (or next sequential token).
   - Show the **My Orders** tracking screen with the dark hero banner and the visual 4-step progress timeline (*Placed*).

4. **Step 4: Kitchen Counter Lifecycle (25s)**
   - Switch role to **Staff**.
   - Show the **Incoming pre-orders** queue: point out token **SC-109** at the top.
   - Click `Mark Preparing →`: show the card status transition to amber *Preparing*.
   - Click `Mark Ready →`: transition to green *Ready*.
   - Click `Mark Collected →`: show the order moving from Active into the **History** accordion with a recorded `collectedAt` timestamp.
   - Switch back to **Student** to prove that **My Orders** reflects the updated status live.

5. **Step 5: Demand Dashboard (25s)**
   - Switch to **Staff → Demand**.
   - Show the **Units to Prepare** KPI and the **Prep List** table.
   - Adjust the **Walk-in Buffer slider** from 10% to 20% and show how the preparation targets recalculate dynamically in real time.
   - Show the pure CSS **Demand per item** horizontal bar chart comparing pre-ordered quantities against recommended kitchen prep batches.
   - Point to the **Footer** for the "↺ Reset Demo Data" button to cleanly reset the app back to initial token SC-101.

---

## 📁 Project Structure

```
Smart Canteen final/
├── index.html                   # HTML template with Google Fonts (Playfair & DM Sans)
├── package.json                 # Minimal React 18 + Vite configuration
├── vite.config.js               # Vite config on port 3000
├── src/
│   ├── main.jsx                 # React root mount
│   ├── App.jsx                  # Main view switcher & provider layout
│   ├── App.css                  # Design system tokens, responsive grid & print rules
│   ├── context/
│   │   └── AppContext.jsx       # Single source of truth (menu, cart, orders, tokens)
│   ├── components/
│   │   ├── Header.jsx           # Brand, role switcher, live navigation badge
│   │   ├── FoodCard.jsx         # Card with 4:3 media, price, prep, steppers
│   │   ├── FoodImage.jsx        # Image loader with graceful serif letter fallback
│   │   ├── Cart.jsx             # Tray review, pickup estimation & checkout modal
│   │   ├── OrdersPage.jsx       # Student tracking, hero banner & progress timeline
│   │   ├── StaffOrders.jsx      # Kitchen queue, status filters & history accordion
│   │   ├── DemandDashboard.jsx  # Cooking targets, buffer slider & CSS bar charts
│   │   ├── MenuManagement.jsx   # Dish table, availability switches & Add/Edit modal
│   │   ├── StatusBadge.jsx      # Accessible color + text state indicators
│   │   ├── Toast.jsx            # Non-blocking auto-dismiss notifications
│   │   ├── ConfirmDialog.jsx    # Accessible modal with Escape key handling
│   │   └── Footer.jsx           # LocalStorage disclaimer & demo data reset
│   └── utils/
│       ├── dates.js             # Local YYYY-MM-DD keys, time formatting & expiry
│       ├── demand.js            # Pure demand math & buffer calculations
│       ├── sampleOrders.js      # Realistic demo orders for viva presentation
│       ├── seedMenu.js          # 15 canteen dishes across 5 categories
│       ├── storage.js           # safeLoad & safeSave wrapper
│       └── tokens.js            # Sequential SC-101 allocator & reconciliation
```
