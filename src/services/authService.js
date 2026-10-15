/**
 * Authentication service for SmartCanteen.
 * Wraps Supabase Auth calls with consistent error handling.
 */
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js';

/**
 * Sign up a new student account.
 * @param {string} email
 * @param {string} password
 * @param {string} displayName
 * @returns {{ data, error }}
 */
export async function signUp(email, password, displayName) {
  if (!isSupabaseConfigured || !supabase) {
    return { data: null, error: new Error('Supabase is not configured. Cannot create account in demo mode.') };
  }
  return supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName || email.split('@')[0] }
    }
  });
}

/**
 * Sign in an existing user.
 * @param {string} email
 * @param {string} password
 * @returns {{ data, error }}
 */
export async function signIn(email, password) {
  if (!isSupabaseConfigured || !supabase) {
    return { data: null, error: new Error('Supabase is not configured. Sign in is unavailable in demo mode.') };
  }
  return supabase.auth.signInWithPassword({ email, password });
}

/**
 * Sign out the current user.
 */
export async function signOut() {
  if (!isSupabaseConfigured || !supabase) return;
  return supabase.auth.signOut();
}

/**
 * Get the current session (restores from storage automatically).
 * @returns {{ data: { session }, error }}
 */
export async function getSession() {
  if (!isSupabaseConfigured || !supabase) return { data: { session: null }, error: null };
  return supabase.auth.getSession();
}

/**
 * Fetch the profile (including role) for a given user ID.
 * @param {string} userId
 * @returns {{ profile, error }}
 */
export async function fetchProfile(userId) {
  if (!isSupabaseConfigured || !supabase) return { profile: null, error: null };
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, role, created_at')
    .eq('id', userId)
    .single();
  return { profile: data, error };
}

/**
 * Subscribe to auth state changes (sign in, sign out, token refresh).
 * @param {function} callback - Called with (event, session)
 * @returns {function} unsubscribe
 */
export function onAuthStateChange(callback) {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const { data: { subscription } } = supabase.auth.onAuthStateChange(callback);
  return () => subscription.unsubscribe();
}
