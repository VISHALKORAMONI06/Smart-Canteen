/**
 * useAuth — Authentication and role management hook.
 * Manages Supabase session, profile, and role state.
 * Falls back gracefully when Supabase is not configured (demo mode).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js';
import {
  signIn as authSignIn,
  signUp as authSignUp,
  signOut as authSignOut,
  fetchProfile,
  onAuthStateChange
} from '../services/authService.js';

export function useAuth() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [role, setRole] = useState('student');  // demo default
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const profileFetchedRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Load profile for a given user
  // ---------------------------------------------------------------------------

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null);
      setRole('student');
      return;
    }

    const { profile: p, error } = await fetchProfile(userId);

    if (error) {
      console.error(
        '[SmartCanteen] Failed to load profile:',
        error.message
      );
      setProfile(null);
      setRole('student');
      return;
    }

    if (!p) {
      console.error(
        '[SmartCanteen] No profile found for user:',
        userId
      );
      setProfile(null);
      setRole('student');
      return;
    }

    console.log('[SmartCanteen] Loaded profile:', {
      id: p.id,
      role: p.role
    });

    setProfile(p);
    setRole(p.role || 'student');
  }, []);


  // ---------------------------------------------------------------------------
  // Initialize: restore session from storage
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setAuthLoading(false);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s?.user?.id && !profileFetchedRef.current) {
        profileFetchedRef.current = true;
        loadProfile(s.user.id).finally(() => setAuthLoading(false));
      } else {
        setAuthLoading(false);
      }
    });

    // Subscribe to auth changes
    const unsubscribe = onAuthStateChange(async (event, newSession) => {
      setSession(newSession);
      if (event === 'SIGNED_IN' && newSession?.user?.id) {
        profileFetchedRef.current = true;
        await loadProfile(newSession.user.id);
      }
      if (event === 'SIGNED_OUT') {
        setProfile(null);
        setRole('student');
        profileFetchedRef.current = false;
      }
    });

    return unsubscribe;
  }, [loadProfile]);

  // ---------------------------------------------------------------------------
  // Sign In
  // ---------------------------------------------------------------------------
  const signIn = useCallback(async (email, password) => {
    setAuthError(null);
    const { data, error } = await authSignIn(email, password);
    if (error) {
      setAuthError(error.message);
      return { error };
    }
    return { data };
  }, []);

  // ---------------------------------------------------------------------------
  // Sign Up
  // ---------------------------------------------------------------------------
  const signUp = useCallback(async (email, password, displayName) => {
    setAuthError(null);
    const { data, error } = await authSignUp(email, password, displayName);
    if (error) {
      setAuthError(error.message);
      return { error };
    }
    return { data };
  }, []);

  // ---------------------------------------------------------------------------
  // Sign Out
  // ---------------------------------------------------------------------------
  const signOut = useCallback(async () => {
    await authSignOut();
    setSession(null);
    setProfile(null);
    setRole('student');
    profileFetchedRef.current = false;
  }, []);

  // ---------------------------------------------------------------------------
  // Demo-mode role switcher (used when Supabase is not configured)
  // ---------------------------------------------------------------------------
  const setDemoRole = useCallback((newRole) => {
    if (!isSupabaseConfigured) {
      setRole(newRole);
    }
  }, []);

  return {
    session,
    profile,
    user: session?.user || null,
    userId: session?.user?.id || null,
    role,
    isAuthenticated: Boolean(session?.user),
    isStudent: role === 'student',
    isStaff: role === 'staff' || role === 'admin',
    isAdmin: role === 'admin',
    authLoading,
    authError,
    setAuthError,
    signIn,
    signUp,
    signOut,
    setDemoRole,   // only works in demo mode
    isDemoMode: !isSupabaseConfigured
  };
}
