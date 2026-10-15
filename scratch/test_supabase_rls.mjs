/**
 * SmartCanteen — RLS Policy Verification Tests
 * Tests that Row-Level Security policies are correctly enforced.
 *
 * Run: node --env-file=.env scratch/test_supabase_rls.mjs
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY  = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing environment variables. See .env.example');
  process.exit(1);
}

const anonClient  = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const TEST_EMAIL  = process.env.TEST_EMAIL_1 || 'student1@test.smartcanteen.local';
const TEST_PASS   = process.env.TEST_PASSWORD || 'TestPass123!';

let passed = 0;
let failed = 0;

function assert(condition, label, detail = '') {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else           { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}

async function testAnonAccess() {
  console.log('\n🔒 Test: Anonymous access restrictions');

  // Anon can read active menu items
  const { data: menuData, error: menuErr } = await anonClient
    .from('menu_items')
    .select('id, name, available')
    .limit(5);
  assert(!menuErr && Array.isArray(menuData), 'Anon can read active menu items');

  // Anon cannot read orders
  const { data: orderData } = await anonClient.from('orders').select('*').limit(1);
  assert(!orderData || orderData.length === 0, 'Anon cannot read orders');

  // Anon cannot read profiles
  const { data: profileData } = await anonClient.from('profiles').select('*').limit(1);
  assert(!profileData || profileData.length === 0, 'Anon cannot read profiles');

  // Anon cannot read daily_token_counters
  const { data: tokenData } = await anonClient.from('daily_token_counters').select('*').limit(1);
  assert(!tokenData || tokenData.length === 0, 'Anon cannot read token counters');

  // Anon cannot place orders via RPC (should fail with UNAUTHENTICATED)
  const { error: rpcErr } = await anonClient.rpc('place_order', {
    p_cart_items: [],
    p_idempotency_key: 'anon_test'
  });
  assert(
    rpcErr && rpcErr.message.includes('UNAUTHENTICATED'),
    'Anon place_order returns UNAUTHENTICATED'
  );
}

async function testStudentAccess() {
  console.log('\n🎓 Test: Student access controls');

  const studentClient = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const { data: authData, error: authErr } = await studentClient.auth.signInWithPassword({
    email: TEST_EMAIL, password: TEST_PASS
  });
  if (authErr) {
    console.log('  ⚠️  Cannot sign in test student — skipping student tests');
    return;
  }

  const studentId = authData.user.id;

  // Student can read own profile
  const { data: ownProfile, error: profileErr } = await studentClient
    .from('profiles')
    .select('*')
    .eq('id', studentId)
    .single();
  assert(!profileErr && ownProfile?.id === studentId, 'Student can read own profile');

  // Student cannot change own role
  const { error: roleChangeErr } = await studentClient
    .from('profiles')
    .update({ role: 'admin' })
    .eq('id', studentId);
  // The update either errors or silently does nothing due to RLS WITH CHECK
  const { data: profileAfter } = await studentClient
    .from('profiles')
    .select('role')
    .eq('id', studentId)
    .single();
  assert(
    profileAfter?.role === 'student',
    'Student cannot escalate own role to admin'
  );

  // Student can read active menu items
  const { data: menu } = await studentClient
    .from('menu_items')
    .select('id, name')
    .limit(5);
  assert(Array.isArray(menu) && menu.length > 0, 'Student can read menu items');

  // Student cannot insert menu items directly
  const { error: menuInsertErr } = await studentClient
    .from('menu_items')
    .insert([{ name: 'Hacked Item', price_paise: 100, prep_time_mins: 5, category: 'Snacks', description: '' }]);
  assert(
    menuInsertErr !== null,
    'Student cannot insert menu items directly'
  );

  // Student cannot read other users' orders
  const { data: allOrders } = await studentClient
    .from('orders')
    .select('student_id')
    .neq('student_id', studentId)
    .limit(1);
  assert(!allOrders || allOrders.length === 0, 'Student cannot read other students\' orders');

  // Student cannot read audit logs
  const { data: auditData } = await studentClient
    .from('audit_logs')
    .select('*')
    .limit(1);
  assert(!auditData || auditData.length === 0, 'Student cannot read audit logs');

  // Student cannot read daily_token_counters
  const { data: tokenData } = await studentClient
    .from('daily_token_counters')
    .select('*')
    .limit(1);
  assert(!tokenData || tokenData.length === 0, 'Student cannot read daily token counters');

  // Student can read app_settings
  const { data: settings } = await studentClient
    .from('app_settings')
    .select('ordering_open')
    .eq('id', 1)
    .single();
  assert(settings?.ordering_open !== undefined, 'Student can read app settings (ordering_open)');

  await studentClient.auth.signOut();
}

async function run() {
  console.log('🔐 SmartCanteen — RLS Policy Verification Tests');
  console.log('================================================');

  await testAnonAccess();
  await testStudentAccess();

  console.log('\n================================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('================================================');

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
