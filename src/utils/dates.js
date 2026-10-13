/**
 * Date and time utility functions for SmartCanteen.
 * Note: Never use toISOString() for date keys to avoid UTC timezone offsets.
 */

/**
 * Returns the current local date key in YYYY-MM-DD format.
 * @param {Date} [d=new Date()]
 * @returns {string} YYYY-MM-DD
 */
export function getLocalDateKey(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Formats an ISO string or Date into a human-readable 12-hour time (e.g. "12:05 PM").
 * @param {string|Date} dateVal
 * @returns {string}
 */
export function formatTime(dateVal) {
  if (!dateVal) return '';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Formats an ISO string into date and time (e.g. "10 Oct, 11:40 AM").
 * @param {string|Date} dateVal
 * @returns {string}
 */
export function formatDateTime(dateVal) {
  if (!dateVal) return '';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '';
  const day = d.getDate();
  const month = d.toLocaleDateString('en-IN', { month: 'short' });
  const time = formatTime(d);
  return `${day} ${month}, ${time}`;
}

/**
 * Returns a relative friendly time string (e.g. "just now", "5m ago", "today").
 * @param {string|Date} dateVal
 * @returns {string}
 */
export function formatRelativeTime(dateVal) {
  if (!dateVal) return '';
  const d = new Date(dateVal);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  return formatDateTime(dateVal);
}

/**
 * Calculates estimated pickup time:
 * Order time + (longest prep time among items) + 5 min queue allowance.
 * Rounds up to the next 5 minutes.
 * 
 * @param {Array<{ prepTime?: number }>} items
 * @param {Date} [baseDate=new Date()]
 * @returns {string} ISO String of calculated pickup time
 */
export function calculateEstimatedPickupTime(items = [], baseDate = new Date()) {
  const maxPrepMinutes = items.reduce((max, item) => {
    const prep = Number(item.prepTime) || 5;
    return Math.max(max, prep);
  }, 5);

  const totalAddedMinutes = maxPrepMinutes + 5; // + 5 min canteen queue allowance
  const targetDate = new Date(baseDate.getTime() + totalAddedMinutes * 60000);

  // Round up to next 5 minutes
  const minutes = targetDate.getMinutes();
  const remainder = minutes % 5;
  if (remainder !== 0) {
    targetDate.setMinutes(minutes + (5 - remainder));
  }
  targetDate.setSeconds(0);
  targetDate.setMilliseconds(0);

  return targetDate.toISOString();
}

/**
 * Marks any order whose dateKey is before today and status is not Collected/Expired as 'Expired'.
 * @param {Array} orders
 * @param {string} [todayKey=getLocalDateKey()]
 * @returns {{ updatedOrders: Array, expiredCount: number }}
 */
export function expireStaleOrders(orders = [], todayKey = getLocalDateKey()) {
  let expiredCount = 0;
  const updatedOrders = orders.map((order) => {
    if (order.dateKey < todayKey && order.status !== 'Collected' && order.status !== 'Expired') {
      expiredCount++;
      return { ...order, status: 'Expired' };
    }
    return order;
  });

  return { updatedOrders, expiredCount };
}
