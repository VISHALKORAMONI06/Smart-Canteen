/**
 * Token Allocator for SmartCanteen.
 * 
 * NOTE: This is a single-browser demonstration allocator using LocalStorage.
 * In a real production deployment with multiple concurrent devices and physical counters,
 * token generation MUST be coordinated atomically via a backend database sequence
 * to guarantee uniqueness across devices and avoid race conditions.
 */

import { getLocalDateKey } from './dates.js';

export const INITIAL_TOKEN_COUNTER = 100;

/**
 * Parses the numeric counter from a token string like "SC-101" -> 101
 * @param {string} tokenStr
 * @returns {number|null}
 */
export function parseTokenNumber(tokenStr) {
  if (!tokenStr || typeof tokenStr !== 'string') return null;
  const match = tokenStr.match(/^SC-(\d+)$/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Finds the highest token number for the given dateKey among existing orders.
 * @param {Array} orders
 * @param {string} dateKey
 * @returns {number}
 */
export function getHighestTokenNumberForDate(orders = [], dateKey) {
  let maxNum = INITIAL_TOKEN_COUNTER;
  for (const order of orders) {
    if (order.dateKey === dateKey && order.token) {
      const num = parseTokenNumber(order.token);
      if (num !== null && num > maxNum) {
        maxNum = num;
      }
    }
  }
  return maxNum;
}

/**
 * Allocates the next sequential pickup token.
 * Must only be called inside an order submission event handler, never during render!
 * 
 * Rules:
 * 1. If stored tokenState.dateKey !== today, reset counter to 100.
 * 2. Reconcile: counter = Math.max(counter, highest same-day token number found in orders).
 * 3. Next counter = counter + 1.
 * 4. Next token string = `SC-${nextCounter}`.
 * 5. Returns new token string and updated tokenState.
 * 
 * @param {{ dateKey?: string, counter?: number }|null} currentTokenState
 * @param {Array} existingOrders
 * @param {string} [todayKey=getLocalDateKey()]
 * @returns {{ nextToken: string, nextTokenState: { dateKey: string, counter: number } }}
 */
export function allocateNextToken(currentTokenState, existingOrders = [], todayKey = getLocalDateKey()) {
  let counter = INITIAL_TOKEN_COUNTER;

  if (currentTokenState && currentTokenState.dateKey === todayKey && typeof currentTokenState.counter === 'number') {
    counter = currentTokenState.counter;
  } else {
    // New day or first initialization: reset counter to base 100
    counter = INITIAL_TOKEN_COUNTER;
  }

  // Reconcile against any existing orders with today's dateKey to avoid collisions
  const highestExisting = getHighestTokenNumberForDate(existingOrders, todayKey);
  counter = Math.max(counter, highestExisting);

  const nextCounter = counter + 1;
  const nextToken = `SC-${nextCounter}`;

  const nextTokenState = {
    dateKey: todayKey,
    counter: nextCounter
  };

  return { nextToken, nextTokenState };
}
