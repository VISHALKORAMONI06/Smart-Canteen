/**
 * useMenu — Menu data fetching and real-time subscription hook.
 * Falls back to LocalStorage seed data when Supabase is not configured.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { isSupabaseConfigured } from '../lib/supabaseClient.js';
import { fetchMenu, fetchMenuAdmin, addMenuItem, updateMenuItem, archiveMenuItem, subscribeToMenuChanges, toggleItemAvailability } from '../services/menuService.js';
import { INITIAL_MENU_ITEMS } from '../utils/seedMenu.js';
import { safeLoad, safeSave, STORAGE_KEYS } from '../utils/storage.js';

export function useMenu(role = 'student') {
  const [menu, setMenu]               = useState([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError]     = useState(null);
  const channelRef = useRef(null);

  // ---------------------------------------------------------------------------
  // Derive local demo menu (when Supabase not configured)
  // ---------------------------------------------------------------------------
  const getDemoMenu = useCallback(() => {
    const loaded = safeLoad(STORAGE_KEYS.MENU, INITIAL_MENU_ITEMS, (d) => Array.isArray(d) && d.length > 0);
    // Ensure seed images are kept
    return loaded.map((item) => {
      const seedMatch = INITIAL_MENU_ITEMS.find((s) => s.id === item.id || s.name.trim().toLowerCase() === item.name.trim().toLowerCase());
      if (seedMatch && (!item.imageUrl || item.imageUrl !== seedMatch.imageUrl)) {
        return { ...item, imageUrl: seedMatch.imageUrl };
      }
      return item;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Load menu from Supabase (or fall back to LocalStorage/seed)
  // ---------------------------------------------------------------------------
  const loadMenu = useCallback(async () => {
    setMenuLoading(true);
    setMenuError(null);

    if (!isSupabaseConfigured) {
      setMenu(getDemoMenu());
      setMenuLoading(false);
      return;
    }

    try {
      const fetchFn = (role === 'staff' || role === 'admin') ? fetchMenuAdmin : fetchMenu;
      const { items, error } = await fetchFn();
      if (error) {
        console.error('[SmartCanteen] Menu load error:', error.message);
        setMenuError(error.message);
        setMenu(getDemoMenu()); // fallback
      } else {
        setMenu(items);
      }
    } catch (err) {
      console.error('[SmartCanteen] Menu load exception:', err);
      setMenuError(err.message);
      setMenu(getDemoMenu());
    } finally {
      setMenuLoading(false);
    }
  }, [role, getDemoMenu]);

  // ---------------------------------------------------------------------------
  // Real-time subscription
  // ---------------------------------------------------------------------------
  useEffect(() => {
    loadMenu();

    if (isSupabaseConfigured) {
      const { unsubscribe } = subscribeToMenuChanges(
        // INSERT
        (newItem) => {
          setMenu((prev) => {
            if (prev.find((i) => i.id === newItem.id)) return prev; // dedupe
            return [...prev, newItem].sort((a, b) => a.name.localeCompare(b.name));
          });
        },
        // UPDATE
        (updatedItem) => {
          setMenu((prev) => prev.map((i) => i.id === updatedItem.id ? updatedItem : i));
        },
        // DELETE / ARCHIVE
        (deletedId) => {
          setMenu((prev) => prev.filter((i) => i.id !== deletedId));
        }
      );
      channelRef.current = unsubscribe;
    }

    return () => {
      if (channelRef.current) {
        channelRef.current();
        channelRef.current = null;
      }
    };
  }, [loadMenu]);

  // ---------------------------------------------------------------------------
  // Persist demo-mode menu to LocalStorage
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isSupabaseConfigured && menu.length > 0) {
      safeSave(STORAGE_KEYS.MENU, menu);
    }
  }, [menu]);

  // ---------------------------------------------------------------------------
  // Menu mutations (demo-mode use setState; Supabase mode use service calls)
  // ---------------------------------------------------------------------------
  const addMenuItemAction = useCallback(async (newItem) => {
    if (!isSupabaseConfigured) {
      const id = `item-${Date.now()}`;
      const itemWithId = { ...newItem, id };
      setMenu((prev) => [...prev, itemWithId]);
      return { item: itemWithId, error: null };
    }
    const { item, error } = await addMenuItem(newItem);
    if (error) return { item: null, error };
    // Real-time subscription will add to state automatically
    return { item, error: null };
  }, []);

  const updateMenuItemAction = useCallback(async (updatedItem) => {
    if (!isSupabaseConfigured) {
      setMenu((prev) => prev.map((i) => i.id === updatedItem.id ? updatedItem : i));
      return { item: updatedItem, error: null };
    }
    const { item, error } = await updateMenuItem(updatedItem);
    if (error) return { item: null, error };
    return { item, error: null };
  }, []);

  const toggleAvailabilityAction = useCallback(async (itemId) => {
    const current = menu.find((i) => i.id === itemId);
    if (!current) return { error: new Error('Item not found') };
    const newAvailable = !current.available;

    if (!isSupabaseConfigured) {
      setMenu((prev) => prev.map((i) => i.id === itemId ? { ...i, available: newAvailable } : i));
      return { error: null };
    }
    // Optimistic update
    setMenu((prev) => prev.map((i) => i.id === itemId ? { ...i, available: newAvailable } : i));
    const { error } = await toggleItemAvailability(itemId, newAvailable);
    if (error) {
      // Revert on error
      setMenu((prev) => prev.map((i) => i.id === itemId ? { ...i, available: current.available } : i));
      return { error };
    }
    return { error: null };
  }, [menu]);

  const deleteMenuItemAction = useCallback(async (itemId) => {
    if (!isSupabaseConfigured) {
      setMenu((prev) => prev.filter((i) => i.id !== itemId));
      return { error: null };
    }
    const { error } = await archiveMenuItem(itemId);
    if (error) return { error };
    setMenu((prev) => prev.filter((i) => i.id !== itemId));
    return { error: null };
  }, []);

  const refetchMenu = useCallback(() => loadMenu(), [loadMenu]);

  return {
    menu,
    menuLoading,
    menuError,
    refetchMenu,
    addMenuItemAction,
    updateMenuItemAction,
    toggleAvailabilityAction,
    deleteMenuItemAction
  };
}
