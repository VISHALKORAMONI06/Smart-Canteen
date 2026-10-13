/**
 * Generates realistic seed orders for viva demonstrations.
 * Includes today's orders across Placed, Preparing, Ready, Collected, and an older order to demonstrate expiry.
 */

import { getLocalDateKey } from './dates.js';

export function generateSampleOrders(todayKey = getLocalDateKey(), menu = []) {
  const now = new Date();
  const menuMap = {};
  for (const item of menu) {
    menuMap[item.name] = item;
  }

  const getItem = (name, qty = 1) => {
    const found = menuMap[name] || { id: 'custom', name, price: 50 };
    return {
      itemId: found.id,
      name: found.name,
      unitPrice: found.price,
      quantity: qty
    };
  };

  // Helper to construct order
  const createOrder = ({
    token,
    dateKey,
    minutesAgo,
    pickupMinutesAhead,
    items,
    status,
    collectedMinutesAgo = null,
    note = ''
  }) => {
    const createdAt = new Date(now.getTime() - minutesAgo * 60000).toISOString();
    const pickupAt = new Date(now.getTime() + pickupMinutesAhead * 60000).toISOString();
    const collectedAt = collectedMinutesAgo !== null
      ? new Date(now.getTime() - collectedMinutesAgo * 60000).toISOString()
      : null;

    const totalAmount = items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
    const totalPortions = items.reduce((sum, it) => sum + it.quantity, 0);

    return {
      id: `ord_${token.toLowerCase()}_${Date.now()}`,
      token,
      dateKey,
      createdAt,
      pickupAt,
      items,
      totalAmount,
      totalPortions,
      status,
      collectedAt,
      note
    };
  };

  // Yesterday date key to demonstrate stale order expiry
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

  return [
    // Today: Active Placed orders
    createOrder({
      token: 'SC-108',
      dateKey: todayKey,
      minutesAgo: 4,
      pickupMinutesAhead: 15,
      items: [
        getItem('Masala Dosa', 1),
        getItem('Veg Puff', 4),
        getItem('Masala Chai', 1)
      ],
      status: 'Placed',
      note: 'Extra crispy dosa please'
    }),
    createOrder({
      token: 'SC-107',
      dateKey: todayKey,
      minutesAgo: 10,
      pickupMinutesAhead: 10,
      items: [
        getItem('Veg Sandwich', 2),
        getItem('Cold Coffee', 2),
        getItem('Gulab Jamun (2 pcs)', 1)
      ],
      status: 'Placed'
    }),
    createOrder({
      token: 'SC-106',
      dateKey: todayKey,
      minutesAgo: 14,
      pickupMinutesAhead: 8,
      items: [
        getItem('Veg Thali', 3),
        getItem('Veg Puff', 2)
      ],
      status: 'Placed'
    }),

    // Today: Preparing orders
    createOrder({
      token: 'SC-105',
      dateKey: todayKey,
      minutesAgo: 18,
      pickupMinutesAhead: 4,
      items: [
        getItem('Veg Biryani', 2),
        getItem('Chocolate Brownie', 2)
      ],
      status: 'Preparing'
    }),
    createOrder({
      token: 'SC-104',
      dateKey: todayKey,
      minutesAgo: 22,
      pickupMinutesAhead: 2,
      items: [
        getItem('Veg Puff', 4),
        getItem('Samosa (2 pcs)', 2),
        getItem('Masala Chai', 3)
      ],
      status: 'Preparing'
    }),

    // Today: Ready order
    createOrder({
      token: 'SC-103',
      dateKey: todayKey,
      minutesAgo: 28,
      pickupMinutesAhead: 0,
      items: [
        getItem('Veg Thali', 1),
        getItem('Fresh Lime Soda', 1)
      ],
      status: 'Ready'
    }),

    // Today: Collected order
    createOrder({
      token: 'SC-102',
      dateKey: todayKey,
      minutesAgo: 45,
      pickupMinutesAhead: -20,
      items: [
        getItem('Masala Dosa', 1),
        getItem('Idli Sambar', 1)
      ],
      status: 'Collected',
      collectedMinutesAgo: 15
    }),

    // Yesterday order (will be expired or tested for expiry)
    createOrder({
      token: 'SC-101',
      dateKey: yesterdayKey,
      minutesAgo: 1440,
      pickupMinutesAhead: -1400,
      items: [
        getItem('Aloo Paratha', 2),
        getItem('Masala Chai', 2)
      ],
      status: 'Expired'
    })
  ];
}
