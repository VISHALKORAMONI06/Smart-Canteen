/**
 * Settings service for SmartCanteen.
 */
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js';
import { DEFAULT_BUFFER_RATE } from '../utils/demand.js';

const DEFAULT_SETTINGS = {
  canteenName:       'SmartCanteen',
  bufferRate:        DEFAULT_BUFFER_RATE,
  orderingOpen:      true,
  maxQtyPerItem:     10,
  maxItemsPerOrder:  20,
  businessTimezone:  'Asia/Kolkata',
  openingTime:       '07:00:00',
  closingTime:       '20:00:00'
};

function dbSettingsToFrontend(row) {
  if (!row) return DEFAULT_SETTINGS;
  return {
    canteenName:      row.canteen_name || 'SmartCanteen',
    bufferRate:       Number(row.buffer_rate) || DEFAULT_BUFFER_RATE,
    orderingOpen:     Boolean(row.ordering_open),
    maxQtyPerItem:    row.max_qty_per_item || 10,
    maxItemsPerOrder: row.max_items_per_order || 20,
    businessTimezone: row.business_timezone || 'Asia/Kolkata',
    openingTime:      row.opening_time || '07:00:00',
    closingTime:      row.closing_time || '20:00:00'
  };
}

export async function fetchSettings() {
  if (!isSupabaseConfigured || !supabase) return { settings: DEFAULT_SETTINGS, error: null };

  const { data, error } = await supabase
    .from('app_settings')
    .select('*')
    .eq('id', 1)
    .single();

  return { settings: dbSettingsToFrontend(data), error };
}

export async function updateBufferRateRpc(rate) {
  if (!isSupabaseConfigured || !supabase) {
    return { error: null }; // demo mode: silently succeed
  }
  const { data, error } = await supabase.rpc('update_buffer_rate', { p_rate: rate });
  return { data, error };
}

export async function updateOrderingOpen(open) {
  if (!isSupabaseConfigured || !supabase) {
    return { error: null };
  }
  const { data, error } = await supabase.rpc('update_ordering_open', { p_open: open });
  return { data, error };
}

export function subscribeToSettings(onChange) {
  if (!isSupabaseConfigured || !supabase) return { unsubscribe: () => {} };

  const channel = supabase
    .channel('public:app_settings')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'app_settings', filter: 'id=eq.1' },
      (payload) => onChange && onChange(dbSettingsToFrontend(payload.new))
    )
    .subscribe();

  return { channel, unsubscribe: () => supabase.removeChannel(channel) };
}
