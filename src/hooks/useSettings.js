/**
 * useSettings — Application settings hook.
 * Fetches from Supabase and subscribes to real-time updates.
 * Falls back to defaults when Supabase is not configured.
 */
import { useState, useEffect, useCallback } from 'react';
import { isSupabaseConfigured } from '../lib/supabaseClient.js';
import { fetchSettings, updateBufferRateRpc, updateOrderingOpen, subscribeToSettings } from '../services/settingsService.js';
import { safeLoad, safeSave, STORAGE_KEYS } from '../utils/storage.js';
import { DEFAULT_BUFFER_RATE } from '../utils/demand.js';

const DEFAULT_SETTINGS = {
  canteenName:      'SmartCanteen',
  bufferRate:       DEFAULT_BUFFER_RATE,
  orderingOpen:     true,
  maxQtyPerItem:    10,
  maxItemsPerOrder: 20,
  businessTimezone: 'Asia/Kolkata',
  openingTime:      '07:00:00',
  closingTime:      '20:00:00'
};

export function useSettings() {
  const [settings, setSettings] = useState(() => {
    if (isSupabaseConfigured) return DEFAULT_SETTINGS;
    // Demo mode: load from LocalStorage
    return safeLoad(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS, (d) =>
      Boolean(d && typeof d.bufferRate === 'number')
    );
  });
  const [settingsLoading, setSettingsLoading] = useState(false);

  // ---------------------------------------------------------------------------
  // Load from Supabase
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    setSettingsLoading(true);
    fetchSettings().then(({ settings: s, error }) => {
      if (!error && s) setSettings(s);
    }).finally(() => setSettingsLoading(false));

    // Subscribe to real-time settings updates
    const { unsubscribe } = subscribeToSettings((newSettings) => {
      setSettings(newSettings);
    });

    return unsubscribe;
  }, []);

  // ---------------------------------------------------------------------------
  // Persist demo-mode settings to LocalStorage
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isSupabaseConfigured) {
      safeSave(STORAGE_KEYS.SETTINGS, settings);
    }
  }, [settings]);

  // ---------------------------------------------------------------------------
  // Update buffer rate
  // ---------------------------------------------------------------------------
  const updateBufferRate = useCallback(async (rate) => {
    const bounded = Math.max(0, Math.min(0.5, Number(rate) || 0));
    if (!isSupabaseConfigured) {
      setSettings((prev) => ({ ...prev, bufferRate: bounded }));
      return { error: null };
    }
    const { error } = await updateBufferRateRpc(bounded);
    if (!error) {
      setSettings((prev) => ({ ...prev, bufferRate: bounded }));
    }
    return { error };
  }, []);

  // ---------------------------------------------------------------------------
  // Toggle canteen ordering open/closed (admin only)
  // ---------------------------------------------------------------------------
  const toggleOrderingOpen = useCallback(async () => {
    const newOpen = !settings.orderingOpen;
    if (!isSupabaseConfigured) {
      setSettings((prev) => ({ ...prev, orderingOpen: newOpen }));
      return { error: null };
    }
    const { error } = await updateOrderingOpen(newOpen);
    if (!error) {
      setSettings((prev) => ({ ...prev, orderingOpen: newOpen }));
    }
    return { error };
  }, [settings.orderingOpen]);

  return {
    settings,
    settingsLoading,
    updateBufferRate,
    toggleOrderingOpen
  };
}
