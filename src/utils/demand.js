/**
 * Pure calculation utilities for the SmartCanteen Demand Dashboard.
 */

import { getLocalDateKey } from './dates.js';

export const DEFAULT_BUFFER_RATE = 0.10; // 10% walk-in buffer

/**
 * Calculates all demand metrics for today's orders.
 * 
 * Rules:
 * - Total demand today: orders with dateKey === today and status !== 'Expired' (Collected orders stay included).
 * - Active orders: today's orders with status in ['Placed', 'Preparing', 'Ready'].
 * - Still to cook (pending): quantities from today's orders with status === 'Placed' only.
 * - Per item:
 *     ordered = total demand today (or pending, we track both for kitchen prep vs day total)
 *     buffer = Math.ceil(ordered * bufferRate)
 *     recommended = ordered + buffer
 * 
 * @param {Array} orders - All orders from store
 * @param {Array} menuItems - Current menu
 * @param {number} [bufferRate=DEFAULT_BUFFER_RATE] - E.g. 0.10
 * @param {string} [todayKey=getLocalDateKey()]
 * @returns {object} Calculated demand statistics
 */
export function calculateDemandMetrics(orders = [], menuItems = [], bufferRate = DEFAULT_BUFFER_RATE, todayKey = getLocalDateKey()) {
  const menuMap = new Map();
  for (const item of menuItems) {
    menuMap.set(item.id, item);
  }

  // Filter today's valid orders
  const todayOrders = orders.filter((o) => o.dateKey === todayKey && o.status !== 'Expired');

  // Active orders: Placed, Preparing, Ready
  const activeOrders = todayOrders.filter((o) =>
    o.status === 'Placed' || o.status === 'Preparing' || o.status === 'Ready'
  );

  // Revenue today: sum of non-expired orders today
  const revenueToday = todayOrders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);

  // Items demand aggregation
  // Key: itemId
  const itemStatsMap = new Map();

  for (const order of todayOrders) {
    const isPlaced = order.status === 'Placed';
    if (!Array.isArray(order.items)) continue;

    for (const line of order.items) {
      const qty = Number(line.quantity) || 0;
      if (qty <= 0) continue;

      const itemId = line.itemId || line.name;
      const existing = itemStatsMap.get(itemId) || {
        itemId,
        name: line.name,
        category: 'Other',
        totalOrdered: 0,
        pendingToCook: 0
      };

      // Lookup category from live menu, or fallback to 'Other'
      const menuItem = menuMap.get(itemId);
      if (menuItem && menuItem.category) {
        existing.category = menuItem.category;
      }

      existing.totalOrdered += qty;
      if (isPlaced) {
        existing.pendingToCook += qty;
      }

      itemStatsMap.set(itemId, existing);
    }
  }

  // Convert to array and compute buffer & recommended units
  const itemDemandList = Array.from(itemStatsMap.values()).map((stat) => {
    // Recommendation based on total ordered for day
    const buffer = Math.ceil(stat.totalOrdered * bufferRate);
    const recommended = stat.totalOrdered + buffer;

    // Also calculate pending prep recommendation for kitchen prep list
    const pendingBuffer = Math.ceil(stat.pendingToCook * bufferRate);
    const pendingRecommended = stat.pendingToCook + pendingBuffer;

    return {
      ...stat,
      buffer,
      recommended,
      pendingBuffer,
      pendingRecommended
    };
  });

  // Sort by highest demand first
  itemDemandList.sort((a, b) => b.totalOrdered - a.totalOrdered);

  // Summary units to prepare (sum of recommended prep for the day)
  const unitsToPrepare = itemDemandList.reduce((sum, item) => sum + item.recommended, 0);

  // Still to cook overall (units pending in Placed status)
  const unitsStillToCook = itemDemandList.reduce((sum, item) => sum + item.pendingToCook, 0);

  // Group demand by category
  const categoryDemandMap = {};
  for (const item of itemDemandList) {
    const cat = item.category || 'Other';
    categoryDemandMap[cat] = (categoryDemandMap[cat] || 0) + item.totalOrdered;
  }

  return {
    todayOrdersCount: todayOrders.length,
    activeOrdersCount: activeOrders.length,
    revenueToday,
    unitsToPrepare,
    unitsStillToCook,
    itemDemandList,
    categoryDemandMap
  };
}
