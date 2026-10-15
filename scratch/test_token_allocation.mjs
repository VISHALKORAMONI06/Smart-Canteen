/**
 * SmartCanteen — Token Allocation Concurrency Test
 * Tests that the daily token allocation RPC is atomic under concurrent load.
 *
 * Requirements:
 *   - VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be in .env
 *   - You must have at least 2 student test accounts created in Supabase Auth
 *   - Run: node --env-file=.env scratch/test_token_allocation.mjs
 *
 * Or run from package.json script:
 *   npm run test:tokens
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY  = process.env.VITE_SUPABASE_ANON_KEY;
const TEST_EMAIL_1  = process.env.TEST_EMAIL_1 || 'student1@test.smartcanteen.local';
const TEST_EMAIL_2  = process.env.TEST_EMAIL_2 || 'student2@test.smartcanteen.local';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'TestPass123!';
const TEST_ITEM_ID  = process.env.TEST_MENU_ITEM_ID; // UUID of an active menu item

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment.');
  process.exit(1);
}

if (!TEST_ITEM_ID) {
  console.warn('⚠️  TEST_MENU_ITEM_ID not set. Skipping order placement tests.');
}

const client1 = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const client2 = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;

function assert(condition, label, details = '') {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}${details ? ': ' + details : ''}`);
    failed++;
  }
}

async function signInClient(client, email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return data.session;
}

async function placeConcurrentOrders() {
  if (!TEST_ITEM_ID) {
    console.log('\n⚠️  Skipping concurrent order test (no TEST_MENU_ITEM_ID).');
    return;
  }

  console.log('\n📦 Test: Concurrent order placement — token uniqueness');

  // Place 2 orders simultaneously from 2 different sessions
  const cart = [{ menu_item_id: TEST_ITEM_ID, quantity: 1 }];
  const ikey1 = randomUUID();
  const ikey2 = randomUUID();

  const [result1, result2] = await Promise.all([
    client1.rpc('place_order', {
      p_cart_items: cart,
      p_student_note: 'Concurrent test order A',
      p_idempotency_key: ikey1
    }),
    client2.rpc('place_order', {
      p_cart_items: cart,
      p_student_note: 'Concurrent test order B',
      p_idempotency_key: ikey2
    })
  ]);

  const token1 = result1.data?.token;
  const token2 = result2.data?.token;

  assert(!result1.error, 'Order 1 placed without error', result1.error?.message);
  assert(!result2.error, 'Order 2 placed without error', result2.error?.message);

  if (token1 && token2) {
    assert(token1 !== token2, `Tokens are unique (${token1} vs ${token2})`);

    // Both should match SC-NNN format
    assert(/^SC-\d+$/.test(token1), `Token 1 format correct: ${token1}`);
    assert(/^SC-\d+$/.test(token2), `Token 2 format correct: ${token2}`);

    // Token numbers should differ by exactly 1
    const num1 = parseInt(token1.replace('SC-', ''), 10);
    const num2 = parseInt(token2.replace('SC-', ''), 10);
    assert(Math.abs(num1 - num2) === 1, `Tokens are sequential (${num1}, ${num2})`);
  }
}

async function testIdempotency() {
  if (!TEST_ITEM_ID) return;

  console.log('\n🔄 Test: Idempotent order replay');

  const cart = [{ menu_item_id: TEST_ITEM_ID, quantity: 1 }];
  const ikey = randomUUID();

  // Place the order twice with the same idempotency key
  const result1 = await client1.rpc('place_order', {
    p_cart_items: cart,
    p_student_note: 'Idempotency test',
    p_idempotency_key: ikey
  });

  const result2 = await client1.rpc('place_order', {
    p_cart_items: cart,
    p_student_note: 'Idempotency test (retry)',
    p_idempotency_key: ikey
  });

  assert(!result1.error, 'First order placed');
  assert(!result2.error, 'Second (retry) order returned without error');

  if (result1.data && result2.data) {
    assert(result1.data.token === result2.data.token, 'Same token returned on retry');
    assert(result2.data.idempotent_replay === true, 'Replay flagged correctly');
  }
}

async function testUnauthorizedOrderTransition() {
  if (!TEST_ITEM_ID) return;

  console.log('\n🔐 Test: Student cannot transition own order status');

  // Student placing an order
  const cart = [{ menu_item_id: TEST_ITEM_ID, quantity: 1 }];
  const { data: orderData, error: placeError } = await client1.rpc('place_order', {
    p_cart_items: cart,
    p_idempotency_key: randomUUID()
  });

  if (placeError || !orderData) {
    console.log('  ⚠️  Could not place test order — skipping transition test');
    return;
  }

  // Student tries to transition own order to Preparing (should be FORBIDDEN)
  const { error: transError } = await client1.rpc('transition_order_status', {
    p_order_id: orderData.order_id,
    p_new_status: 'Preparing'
  });

  assert(
    transError && transError.message.includes('FORBIDDEN'),
    'Student blocked from transitioning order status'
  );
}

async function testRLSOrderVisibility() {
  console.log('\n👁️  Test: Student RLS — cannot see other student\'s orders');

  // Client 2 tries to SELECT client 1's orders directly
  const { data: orders, error } = await client2
    .from('orders')
    .select('id, student_id, token')
    .eq('student_id', (await client1.auth.getUser()).data.user?.id);

  assert(
    !orders || orders.length === 0,
    'Student 2 cannot read Student 1\'s orders via direct query'
  );
}

async function run() {
  console.log('🧪 SmartCanteen — Token & Order Concurrency Tests');
  console.log('====================================================\n');

  try {
    console.log('🔑 Signing in test users...');
    await Promise.all([
      signInClient(client1, TEST_EMAIL_1, TEST_PASSWORD),
      signInClient(client2, TEST_EMAIL_2, TEST_PASSWORD)
    ]);
    console.log('  ✅ Both test users signed in\n');
  } catch (err) {
    console.error(`❌ Auth failed: ${err.message}`);
    console.error('   Ensure TEST_EMAIL_1 and TEST_EMAIL_2 accounts exist in Supabase Auth.');
    process.exit(1);
  }

  await placeConcurrentOrders();
  await testIdempotency();
  await testUnauthorizedOrderTransition();
  await testRLSOrderVisibility();

  console.log(`\n====================================================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('====================================================');

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
