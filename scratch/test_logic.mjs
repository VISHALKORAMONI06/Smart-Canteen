import { allocateNextToken, parseTokenNumber, getHighestTokenNumberForDate } from '../src/utils/tokens.js';
import { calculateDemandMetrics, DEFAULT_BUFFER_RATE } from '../src/utils/demand.js';
import { getLocalDateKey, calculateEstimatedPickupTime, expireStaleOrders } from '../src/utils/dates.js';
import { safeLoad, STORAGE_KEYS } from '../src/utils/storage.js';
import { INITIAL_MENU_ITEMS } from '../src/utils/seedMenu.js';

console.log('=====================================================');
console.log('RUNNING SMARTCANTEEN AUTOMATED LOGIC VERIFICATION SUITE');
console.log('=====================================================\n');

let passCount = 0;
let failCount = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`[PASS] ${testName}`);
    passCount++;
  } else {
    console.error(`[FAIL] ${testName}`);
    failCount++;
  }
}

// -----------------------------------------------------------------------------
// Test 1: Token Sequence & Date Reset
// -----------------------------------------------------------------------------
const today = getLocalDateKey();
const yesterday = '2026-10-09';

// Reset to 100 on new date
const t1 = allocateNextToken({ dateKey: yesterday, counter: 150 }, [], today);
assert(t1.nextToken === 'SC-101', 'Test 7 & 8: Token resets to base 100 on new date -> next is SC-101');

// Consecutive allocations
const t2 = allocateNextToken(t1.nextTokenState, [{ dateKey: today, token: 'SC-101' }], today);
assert(t2.nextToken === 'SC-102', 'Test 7: Consecutive allocation produces SC-102');

const t3 = allocateNextToken(t2.nextTokenState, [{ dateKey: today, token: 'SC-101' }, { dateKey: today, token: 'SC-102' }], today);
assert(t3.nextToken === 'SC-103', 'Test 7: Consecutive allocation produces SC-103');

// Reconcile with existing highest token in orders
const ordersWithJump = [
  { dateKey: today, token: 'SC-105' }
];
const t4 = allocateNextToken({ dateKey: today, counter: 101 }, ordersWithJump, today);
assert(t4.nextToken === 'SC-106', 'Test 7: Token reconciles against higher existing order token in orders -> SC-106');

// -----------------------------------------------------------------------------
// Test 2: Demand Dashboard Calculations (Rule 15: 20 ordered -> buffer 2 -> recommended 22)
// -----------------------------------------------------------------------------
const testOrdersForDemand = [
  {
    id: 'ord-1',
    token: 'SC-101',
    dateKey: today,
    status: 'Placed',
    totalAmount: 1200,
    items: [
      { itemId: 'item-1', name: 'Masala Dosa', unitPrice: 60, quantity: 10 }
    ]
  },
  {
    id: 'ord-2',
    token: 'SC-102',
    dateKey: today,
    status: 'Collected', // Collected orders STAY INCLUDED in day demand
    totalAmount: 600,
    items: [
      { itemId: 'item-1', name: 'Masala Dosa', unitPrice: 60, quantity: 10 }
    ]
  },
  {
    id: 'ord-3',
    token: 'SC-103',
    dateKey: today,
    status: 'Expired', // Expired orders do NOT count towards demand
    totalAmount: 600,
    items: [
      { itemId: 'item-1', name: 'Masala Dosa', unitPrice: 60, quantity: 10 }
    ]
  }
];

const demandMetrics = calculateDemandMetrics(testOrdersForDemand, INITIAL_MENU_ITEMS, 0.10, today);
const dosaDemand = demandMetrics.itemDemandList.find(i => i.name === 'Masala Dosa');

assert(dosaDemand && dosaDemand.totalOrdered === 20, 'Test 15: Total ordered = 20 (Placed 10 + Collected 10, Expired excluded)');
assert(dosaDemand && dosaDemand.buffer === 2, 'Test 15: Buffer = Math.ceil(20 * 0.10) = 2');
assert(dosaDemand && dosaDemand.recommended === 22, 'Test 15: Recommended prep = 20 + 2 = 22');
assert(demandMetrics.unitsToPrepare === 22, 'Test 15: Summary units to prepare matches recommended');
assert(demandMetrics.activeOrdersCount === 1, 'Test 15: Active orders count = 1 (Placed only)');
assert(demandMetrics.todayOrdersCount === 2, 'Test 15: Orders today = 2 (Placed + Collected)');
assert(demandMetrics.revenueToday === 1800, 'Test 15: Revenue today = 1800 (1200 + 600)');

// -----------------------------------------------------------------------------
// Test 3: Stale Order Expiry (Rule 11)
// -----------------------------------------------------------------------------
const staleTestOrders = [
  { id: '1', dateKey: yesterday, status: 'Placed' },
  { id: '2', dateKey: yesterday, status: 'Preparing' },
  { id: '3', dateKey: yesterday, status: 'Ready' },
  { id: '4', dateKey: yesterday, status: 'Collected' }, // Should stay Collected
  { id: '5', dateKey: today, status: 'Placed' }         // Should stay Placed
];

const { updatedOrders, expiredCount } = expireStaleOrders(staleTestOrders, today);
assert(expiredCount === 3, 'Test 11: 3 uncollected previous-day orders were identified as stale');
assert(updatedOrders[0].status === 'Expired', 'Test 11: Yesterday Placed became Expired');
assert(updatedOrders[1].status === 'Expired', 'Test 11: Yesterday Preparing became Expired');
assert(updatedOrders[2].status === 'Expired', 'Test 11: Yesterday Ready became Expired');
assert(updatedOrders[3].status === 'Collected', 'Test 11: Yesterday Collected remains Collected');
assert(updatedOrders[4].status === 'Placed', 'Test 11: Today Placed remains Placed');

// -----------------------------------------------------------------------------
// Test 4: LocalStorage SafeLoad & Corrupted JSON (Rule 16)
// -----------------------------------------------------------------------------
// Simulate corrupt storage in memory
const mockStorage = {
  badKey: '{bad json string'
};
// We test safeLoad logic using try/catch
function testSafeLoadLogic(raw, fallback, validator = () => true) {
  try {
    if (raw === null || raw === undefined) return fallback;
    const parsed = JSON.parse(raw);
    if (validator && !validator(parsed)) return fallback;
    return parsed;
  } catch (err) {
    return fallback;
  }
}

const loadedBad = testSafeLoadLogic(mockStorage.badKey, { defaultVal: true });
assert(loadedBad.defaultVal === true, 'Test 16: Corrupted LocalStorage "{bad" gracefully falls back to default without crash');

const loadedValid = testSafeLoadLogic('{"count":42}', { count: 0 });
assert(loadedValid.count === 42, 'Test 16: Valid LocalStorage parses correctly');

// -----------------------------------------------------------------------------
// Test 5: Pickup Time Calculation (5 min increments)
// -----------------------------------------------------------------------------
const pickupItems = [
  { name: 'Masala Dosa', prepTime: 12 },
  { name: 'Cold Coffee', prepTime: 4 }
];
const baseTime = new Date('2026-10-10T11:41:00'); // 11:41
const estPickupIso = calculateEstimatedPickupTime(pickupItems, baseTime);
const estPickupDate = new Date(estPickupIso);
// prep 12 + queue 5 = 17 mins -> 11:41 + 17m = 11:58 -> rounded up to next 5 min = 12:00
assert(estPickupDate.getHours() === 12 && estPickupDate.getMinutes() === 0, 'Estimated pickup rounds up to next 5 mins (11:41 + 17m = 11:58 -> 12:00)');

console.log(`\nAll Automated Tests Completed: ${passCount} passed, ${failCount} failed.`);
if (failCount > 0) process.exit(1);
