/**
 * AppContext — Unified application context for SmartCanteen.
 *
 * This is the single source of truth that composes:
 * - Auth (useAuth)
 * - Menu (useMenu)
 * - Orders (useOrders)
 * - Settings (useSettings)
 * - Cart (local state with LocalStorage persistence)
 * - UI state (toasts, confirmDialog, navigation)
 *
 * Component API is preserved for backward compatibility.
 * When Supabase is configured, real-time subscriptions and server-side
 * order placement are used automatically. Otherwise, the app runs in
 * LocalStorage demo mode.
 */
import React, { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { isSupabaseConfigured } from '../lib/supabaseClient.js';
import { useAuth } from '../hooks/useAuth.js';
import { useMenu } from '../hooks/useMenu.js';
import { useOrders } from '../hooks/useOrders.js';
import { useSettings } from '../hooks/useSettings.js';
import { STORAGE_KEYS, safeLoad, safeSave } from '../utils/storage.js';
import { INITIAL_MENU_ITEMS } from '../utils/seedMenu.js';
import { INITIAL_TOKEN_COUNTER } from '../utils/tokens.js';
import { DEFAULT_BUFFER_RATE } from '../utils/demand.js';
import { getLocalDateKey } from '../utils/dates.js';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  // ---------------------------------------------------------------------------
  // Auth layer
  // ---------------------------------------------------------------------------
  const auth = useAuth();

  // ---------------------------------------------------------------------------
  // Navigation state
  // ---------------------------------------------------------------------------
  // Effective role: auth role when Supabase is configured, demo role otherwise
  const effectiveRole = auth.role; // 'student' | 'staff' | 'admin'

  const [studentView, setStudentView] = useState('menu');
  const [staffView, setStaffView]     = useState('orders');

  // ---------------------------------------------------------------------------
  // Menu layer
  // ---------------------------------------------------------------------------
  const menuHook = useMenu(effectiveRole);

  // ---------------------------------------------------------------------------
  // Orders layer
  // ---------------------------------------------------------------------------
  const ordersHook = useOrders({
    role:   effectiveRole,
    userId: auth.userId,
    menu:   menuHook.menu
  });

  // ---------------------------------------------------------------------------
  // Settings layer
  // ---------------------------------------------------------------------------
  const settingsHook = useSettings();

  // ---------------------------------------------------------------------------
  // Cart state (LocalStorage persistence — cleared only on successful order)
  // ---------------------------------------------------------------------------
  const [cart, setCart] = useState(() =>
    safeLoad(STORAGE_KEYS.CART, [], Array.isArray)
  );

  useEffect(() => {
    safeSave(STORAGE_KEYS.CART, cart);
  }, [cart]);

  // Clear cart when user signs out
  useEffect(() => {
    if (!auth.isAuthenticated && isSupabaseConfigured) {
      setCart([]);
    }
  }, [auth.isAuthenticated]);

  // ---------------------------------------------------------------------------
  // Menu lookup Map (memoized)
  // ---------------------------------------------------------------------------
  const menuMap = useMemo(() => {
    const map = new Map();
    for (const item of menuHook.menu) {
      map.set(item.id, item);
    }
    return map;
  }, [menuHook.menu]);

  // ---------------------------------------------------------------------------
  // Toast notifications
  // ---------------------------------------------------------------------------
  const [toasts, setToasts] = useState([]);
  const [confirmDialog, setConfirmDialog] = useState(null);

  const addToast = useCallback((message, type = 'success') => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ---------------------------------------------------------------------------
  // Cart computed values
  // ---------------------------------------------------------------------------
  const cartBadge = useMemo(() =>
    cart.reduce((sum, item) => sum + (item.quantity || 0), 0), [cart]
  );

  // ---------------------------------------------------------------------------
  // Cart actions
  // ---------------------------------------------------------------------------
  const addToCart = useCallback((itemId) => {
    const menuItem = menuMap.get(itemId);
    if (!menuItem || !menuItem.available) {
      addToast('This item is currently unavailable.', 'error');
      return;
    }
    const maxQty = settingsHook.settings.maxQtyPerItem || 10;
    setCart((prev) => {
      const existing = prev.find((item) => item.itemId === itemId);
      if (existing) {
        if (existing.quantity >= maxQty) {
          addToast(`Maximum ${maxQty} of this item allowed.`, 'error');
          return prev;
        }
        return prev.map((item) =>
          item.itemId === itemId ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { itemId, quantity: 1 }];
    });
  }, [menuMap, addToast, settingsHook.settings.maxQtyPerItem]);

  const updateCartQuantity = useCallback((itemId, delta) => {
    const maxQty = settingsHook.settings.maxQtyPerItem || 10;
    setCart((prev) => {
      const existing = prev.find((item) => item.itemId === itemId);
      if (!existing) return prev;
      const newQty = existing.quantity + delta;
      if (newQty <= 0) return prev.filter((item) => item.itemId !== itemId);
      if (newQty > maxQty) {
        addToast(`Maximum ${maxQty} of this item allowed.`, 'error');
        return prev;
      }
      return prev.map((item) =>
        item.itemId === itemId ? { ...item, quantity: newQty } : item
      );
    });
  }, [settingsHook.settings.maxQtyPerItem, addToast]);

  const removeFromCart = useCallback((itemId) => {
    setCart((prev) => prev.filter((item) => item.itemId !== itemId));
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
  }, []);

  // ---------------------------------------------------------------------------
  // Place order — bridges cart + orders hook
  // ---------------------------------------------------------------------------
  const isPlacingOrderRef = useRef(false);

  const placeOrder = useCallback(async (kitchenNote = '') => {
    if (isPlacingOrderRef.current) {
      console.warn('[SmartCanteen] Blocked duplicate order submission.');
      return null;
    }
    isPlacingOrderRef.current = true;

    try {
      const idempotencyKey = isSupabaseConfigured
        ? (typeof crypto !== 'undefined' ? crypto.randomUUID() : `idem_${Date.now()}`)
        : null;

      const { order, error } = await ordersHook.placeOrder({
        cart,
        menuMap,
        kitchenNote,
        idempotencyKey
      });

      if (error) {
        // Parse Supabase RPC error codes
        const msg = parseOrderError(error);
        addToast(msg, 'error');
        return null;
      }

      // Clear cart only after server confirmation
      setCart([]);
      setStudentView('orders');
      addToast(`Pre-order confirmed! Token: ${order.token}`, 'success');
      return order;
    } finally {
      setTimeout(() => { isPlacingOrderRef.current = false; }, 500);
    }
  }, [cart, menuMap, ordersHook, addToast]);

  // ---------------------------------------------------------------------------
  // Order status transitions (bridging orders hook)
  // ---------------------------------------------------------------------------
  const transitionOrderStatus = useCallback(async (orderId, targetStatus) => {
    const { error } = await ordersHook.transitionOrderStatus(orderId, targetStatus);
    if (error) {
      const msg = parseOrderError(error);
      addToast(msg, 'error');
      return;
    }
    addToast(`Order marked as ${targetStatus}.`, 'info');
  }, [ordersHook, addToast]);

  // ---------------------------------------------------------------------------
  // Menu actions (bridging menu hook) with toasts
  // ---------------------------------------------------------------------------
  const addMenuItem = useCallback(async (newItem) => {
    const { error } = await menuHook.addMenuItemAction(newItem);
    if (error) { addToast(`Failed to add item: ${error.message}`, 'error'); return; }
    addToast(`"${newItem.name}" added to menu.`, 'success');
  }, [menuHook, addToast]);

  const updateMenuItem = useCallback(async (updatedItem) => {
    const { error } = await menuHook.updateMenuItemAction(updatedItem);
    if (error) { addToast(`Failed to update item: ${error.message}`, 'error'); return; }
    addToast(`"${updatedItem.name}" updated successfully.`, 'success');
  }, [menuHook, addToast]);

  const toggleItemAvailability = useCallback(async (itemId) => {
    const item = menuMap.get(itemId);
    const { error } = await menuHook.toggleAvailabilityAction(itemId);
    if (error) { addToast(`Failed to toggle availability: ${error.message}`, 'error'); return; }
    if (item) {
      const nextVal = !item.available;
      addToast(`${item.name} is now ${nextVal ? 'available' : 'unavailable'}.`, 'info');
    }
  }, [menuHook, menuMap, addToast]);

  const deleteMenuItem = useCallback(async (itemId) => {
    const item = menuMap.get(itemId);
    // Also remove from cart
    setCart((prev) => prev.filter((it) => it.itemId !== itemId));
    const { error } = await menuHook.deleteMenuItemAction(itemId);
    if (error) { addToast(`Failed to delete item: ${error.message}`, 'error'); return; }
    addToast(`"${item ? item.name : 'Item'}" removed from menu.`, 'info');
  }, [menuHook, menuMap, addToast]);

  // ---------------------------------------------------------------------------
  // Buffer rate update
  // ---------------------------------------------------------------------------
  const updateBufferRate = useCallback(async (rate) => {
    const { error } = await settingsHook.updateBufferRate(rate);
    if (error) addToast(`Failed to update buffer rate: ${error.message}`, 'error');
  }, [settingsHook, addToast]);

  // ---------------------------------------------------------------------------
  // Demo helpers (safe in Supabase mode — they check isSupabaseConfigured)
  // ---------------------------------------------------------------------------
  const resetDemoData = useCallback(() => {
    if (isSupabaseConfigured) {
      addToast('Demo reset is not available in production mode.', 'error');
      return;
    }
    // Use the statically imported INITIAL_MENU_ITEMS (already at top of file)
    safeSave(STORAGE_KEYS.MENU, INITIAL_MENU_ITEMS);
    setCart([]);
    ordersHook.resetDemoOrders();
    setStudentView('menu');
    setStaffView('orders');
    addToast('Demo data reset. Menu reseeded, orders cleared.', 'success');
    // Reload so menu hook re-reads from freshly written LocalStorage
    setTimeout(() => window.location.reload(), 400);
  }, [menuHook, ordersHook, addToast]);

  const loadSampleOrders = useCallback(() => {
    if (isSupabaseConfigured) {
      addToast('Sample orders are not available in production mode.', 'error');
      return;
    }
    ordersHook.loadSampleOrdersDemo(menuHook.menu);
    addToast('Loaded sample orders for demonstration.', 'success');
  }, [ordersHook, menuHook.menu, addToast]);

  // ---------------------------------------------------------------------------
  // Connection status banner (Supabase only)
  // ---------------------------------------------------------------------------
  const [realtimeConnected, setRealtimeConnected] = useState(true);

  // ---------------------------------------------------------------------------
  // Context value — preserves original API shape for backward compat
  // ---------------------------------------------------------------------------
  const value = {
    // Auth
    session:         auth.session,
    user:            auth.user,
    userId:          auth.userId,
    profile:         auth.profile,
    role:            effectiveRole,
    isAuthenticated: auth.isAuthenticated,
    isStudent:       auth.isStudent,
    isStaff:         auth.isStaff,
    isAdmin:         auth.isAdmin,
    authLoading:     auth.authLoading,
    authError:       auth.authError,
    setAuthError:    auth.setAuthError,
    signIn:          auth.signIn,
    signUp:          auth.signUp,
    signOut:         auth.signOut,
    setDemoRole:     auth.setDemoRole,
    isDemoMode:      auth.isDemoMode,
    // Compat: role setter (demo mode only)
    setRole:         auth.setDemoRole,

    // Navigation
    studentView,
    setStudentView,
    staffView,
    setStaffView,

    // Menu
    menu:            menuHook.menu,
    menuMap,
    menuLoading:     menuHook.menuLoading,
    menuError:       menuHook.menuError,

    // Cart
    cart,
    cartBadge,
    addToCart,
    updateCartQuantity,
    removeFromCart,
    clearCart,

    // Orders
    orders:          ordersHook.orders,
    ordersLoading:   ordersHook.ordersLoading,
    ordersError:     ordersHook.ordersError,
    isPlacingOrder:  ordersHook.isPlacingOrder,
    tokenState:      ordersHook.tokenState,

    // Settings
    settings:        settingsHook.settings,

    // Actions
    placeOrder,
    transitionOrderStatus,
    addMenuItem,
    updateMenuItem,
    toggleItemAvailability,
    deleteMenuItem,
    updateBufferRate,
    toggleOrderingOpen: settingsHook.toggleOrderingOpen,

    // Demo helpers
    resetDemoData,
    loadSampleOrders,

    // UI
    toasts,
    addToast,
    removeToast,
    confirmDialog,
    setConfirmDialog,

    // Real-time state
    realtimeConnected,
    isSupabaseConfigured
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}

// ---------------------------------------------------------------------------
// Parse RPC error messages into user-friendly strings
// ---------------------------------------------------------------------------
function parseOrderError(error) {
  const msg = error?.message || '';
  if (msg.includes('UNAUTHENTICATED'))   return 'You must be signed in to perform this action.';
  if (msg.includes('CANTEEN_CLOSED'))    return 'The canteen is not accepting orders right now.';
  if (msg.includes('OUTSIDE_HOURS'))     return 'Orders can only be placed during canteen hours.';
  if (msg.includes('EMPTY_CART'))        return 'Your cart is empty.';
  if (msg.includes('ITEM_UNAVAILABLE'))  return msg.split('ITEM_UNAVAILABLE: ')[1] || 'An item in your cart is unavailable.';
  if (msg.includes('ITEM_NOT_FOUND'))    return 'One or more items in your cart no longer exist on the menu.';
  if (msg.includes('DUPLICATE_ORDER'))   return 'This order was already submitted. Please refresh and check your orders.';
  if (msg.includes('INVALID_TRANSITION')) return msg.split('INVALID_TRANSITION: ')[1] || 'Invalid status transition.';
  if (msg.includes('FORBIDDEN'))        return 'You do not have permission to perform this action.';
  if (msg.includes('TOO_MANY_ITEMS'))   return 'Your cart has too many distinct items. Please reduce it.';
  if (msg.includes('QTY_EXCEEDED'))     return 'One or more items exceed the maximum quantity allowed.';
  return msg || 'An unexpected error occurred. Please try again.';
}
