/**
 * Supabase client singleton for SmartCanteen.
 *
 * Uses the publishable/anon key — safe for browser use.
 * All data access is protected by Row-Level Security on the database.
 * The service-role key is NEVER used here.
 *
 * Required environment variables (.env):
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Graceful degradation: if env vars are missing, warn clearly instead of crashing
if (!supabaseUrl || !supabaseKey) {
  console.warn(
    '[SmartCanteen] ⚠️ Supabase environment variables are not configured.\n' +
    'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.\n' +
    'The app will run in offline/demo mode using LocalStorage only.'
  );
}

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession:      true,
        autoRefreshToken:    true,
        detectSessionInUrl:  true,
        storageKey:          'smartcanteen:auth'
      },
      realtime: {
        params: {
          eventsPerSecond: 10
        }
      }
    })
  : null;

export default supabase;
