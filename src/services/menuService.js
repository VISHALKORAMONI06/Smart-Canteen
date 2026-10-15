/**
 * Menu service for SmartCanteen.
 * All price conversions: DB stores paise (INT), frontend uses rupees (INT).
 * price_paise / 100 = price_rupees (always integer, no fractions)
 */
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js';

// ---------------------------------------------------------------------------
// Data shape conversion helpers
// ---------------------------------------------------------------------------

/**
 * Convert a Supabase menu_item row to the frontend item shape.
 * Frontend always works in RUPEES (integer).
 */
export function dbItemToFrontend(row) {
  if (!row) return null;
  return {
    id:          row.id,
    name:        row.name,
    description: row.description || '',
    category:    row.category,
    imageUrl:    row.image_url || '',
    price:       Math.round((row.price_paise || 0) / 100), // paise -> rupees
    prepTime:    row.prep_time_mins,
    available:   row.available,
    active:      row.active,
    archivedAt:  row.archived_at || null,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at
  };
}

/**
 * Convert frontend item shape to DB column names.
 */
export function frontendItemToDb(item) {
  return {
    name:          item.name?.trim(),
    description:   item.description?.trim() || '',
    category:      item.category,
    image_url:     item.imageUrl?.trim() || '',
    price_paise:   Math.round(Number(item.price) * 100), // rupees -> paise
    prep_time_mins: Number(item.prepTime),
    available:     Boolean(item.available)
  };
}

// ---------------------------------------------------------------------------
// Fetch all active menu items
// ---------------------------------------------------------------------------
export async function fetchMenu() {
  if (!isSupabaseConfigured || !supabase) return { items: [], error: null };

  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .eq('active', true)
    .is('archived_at', null)
    .order('category')
    .order('name');

  return {
    items: (data || []).map(dbItemToFrontend),
    error
  };
}

// ---------------------------------------------------------------------------
// Fetch ALL menu items (staff/admin — includes inactive)
// ---------------------------------------------------------------------------
export async function fetchMenuAdmin() {
  if (!isSupabaseConfigured || !supabase) return { items: [], error: null };

  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .is('archived_at', null) // still show active=false items
    .order('category')
    .order('name');

  return {
    items: (data || []).map(dbItemToFrontend),
    error
  };
}

// ---------------------------------------------------------------------------
// Add a new menu item (staff/admin)
// ---------------------------------------------------------------------------
export async function addMenuItem(item) {
  if (!isSupabaseConfigured || !supabase) return { item: null, error: new Error('Supabase not configured') };

  const { data, error } = await supabase
    .from('menu_items')
    .insert([{ ...frontendItemToDb(item), active: true }])
    .select()
    .single();

  return { item: dbItemToFrontend(data), error };
}

// ---------------------------------------------------------------------------
// Update an existing menu item (staff/admin)
// ---------------------------------------------------------------------------
export async function updateMenuItem(item) {
  if (!isSupabaseConfigured || !supabase) return { item: null, error: new Error('Supabase not configured') };

  const { data, error } = await supabase
    .from('menu_items')
    .update(frontendItemToDb(item))
    .eq('id', item.id)
    .is('archived_at', null)
    .select()
    .single();

  return { item: dbItemToFrontend(data), error };
}

// ---------------------------------------------------------------------------
// Toggle item availability via secure RPC (validates role server-side)
// ---------------------------------------------------------------------------
export async function toggleItemAvailability(itemId, available) {
  if (!isSupabaseConfigured || !supabase) return { error: new Error('Supabase not configured') };

  const { data, error } = await supabase.rpc('update_item_availability', {
    p_item_id:   itemId,
    p_available: available
  });

  return { data, error };
}

// ---------------------------------------------------------------------------
// Soft-delete (archive) a menu item — historical orders retain snapshot
// ---------------------------------------------------------------------------
export async function archiveMenuItem(itemId) {
  if (!isSupabaseConfigured || !supabase) return { error: new Error('Supabase not configured') };

  const { error } = await supabase
    .from('menu_items')
    .update({ archived_at: new Date().toISOString(), active: false })
    .eq('id', itemId);

  return { error };
}

// ---------------------------------------------------------------------------
// Subscribe to real-time menu changes
// Returns { channel, unsubscribe }
// ---------------------------------------------------------------------------
export function subscribeToMenuChanges(onInsert, onUpdate, onDelete) {
  if (!isSupabaseConfigured || !supabase) {
    return { channel: null, unsubscribe: () => {} };
  }

  const channel = supabase
    .channel('public:menu_items')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'menu_items' },
      (payload) => onInsert && onInsert(dbItemToFrontend(payload.new))
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'menu_items' },
      (payload) => onUpdate && onUpdate(dbItemToFrontend(payload.new))
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'menu_items' },
      (payload) => onDelete && onDelete(payload.old?.id)
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        console.error('[SmartCanteen] Menu realtime subscription error');
      }
    });

  return {
    channel,
    unsubscribe: () => supabase.removeChannel(channel)
  };
}
