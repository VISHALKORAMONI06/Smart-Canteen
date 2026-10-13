import React, { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { STORAGE_KEYS, safeLoad, safeSave } from '../utils/storage.js';
import { INITIAL_MENU_ITEMS } from '../utils/seedMenu.js';
import { getLocalDateKey, calculateEstimatedPickupTime, expireStaleOrders } from '../utils/dates.js';
import { allocateNextToken, INITIAL_TOKEN_COUNTER } from '../utils/tokens.js';
import { DEFAULT_BUFFER_RATE } from '../utils/demand.js';
import { generateSampleOrders } from '../utils/sampleOrders.js';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  // Navigation & Role State
  const [role, setRole] = useState('student'); // 'student' | 'staff'
  const [studentView, setStudentView] = useState('menu'); // 'menu' | 'cart' | 'orders'
  const [staffView, setStaffView] = useState('orders'); // 'orders' | 'demand' | 'menu'

  // Core Data State (persisted to LocalStorage)
  const [menu, setMenu] = useState(() => {
    const loaded = safeLoad(STORAGE_KEYS.MENU, INITIAL_MENU_ITEMS, (data) => Array.isArray(data) && data.length > 0);
    // Ensure standard default dishes are linked to their authentic local dish photos
    return loaded.map((item) => {
      const seedMatch = INITIAL_MENU_ITEMS.find((s) => s.id === item.id || s.name.trim().toLowerCase() === item.name.trim().toLowerCase());
      if (seedMatch && (!item.imageUrl || item.imageUrl.includes('unsplash.com') || item.imageUrl !== seedMatch.imageUrl)) {
        return { ...item, imageUrl: seedMatch.imageUrl };
      }
      return item;
    });
  });

  const [cart, setCart] = useState(() =>
    safeLoad(STORAGE_KEYS.CART, [], Array.isArray)
  );

  // Initialize orders: if empty, seed with realistic sample orders to showcase full workflow
  const [orders, setOrders] = useState(() => {
    const today = getLocalDateKey();
    const stored = safeLoad(STORAGE_KEYS.ORDERS, null, Array.isArray);
    if (stored !== null) return stored;
    return generateSampleOrders(today, INITIAL_MENU_ITEMS);
  });

  const [tokenState, setTokenState] = useState(() =>
    safeLoad(STORAGE_KEYS.TOKEN_STATE, { dateKey: getLocalDateKey(), counter: 108 }, (data) =>
      Boolean(data && typeof data.counter === 'number' && typeof data.dateKey === 'string')
    )
  );

  const [settings, setSettings] = useState(() =>
    safeLoad(STORAGE_KEYS.SETTINGS, { bufferRate: DEFAULT_BUFFER_RATE }, (data) =>
      Boolean(data && typeof data.bufferRate === 'number')
    )
  );

  // Transient UI State: Toasts & Confirmations
  const [toasts, setToasts] = useState([]);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const isPlacingOrderRef = useRef(false);

  // ---------------------------------------------------------
  // Persist state to LocalStorage
  // ---------------------------------------------------------
  useEffect(() => {
    safeSave(STORAGE_KEYS.MENU, menu);
  }, [menu]);

  useEffect(() => {
    safeSave(STORAGE_KEYS.CART, cart);
  }, [cart]);

  useEffect(() => {
    safeSave(STORAGE_KEYS.ORDERS, orders);
  }, [orders]);

  useEffect(() => {
    safeSave(STORAGE_KEYS.TOKEN_STATE, tokenState);
  }, [tokenState]);

  useEffect(() => {
    safeSave(STORAGE_KEYS.SETTINGS, settings);
  }, [settings]);

  // ---------------------------------------------------------
  // Toast Notification System
  // ---------------------------------------------------------
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

  // ---------------------------------------------------------
  // Stale Order Expiry (mount + 60s interval)
  // ---------------------------------------------------------
  useEffect(() => {
    const checkExpiry = () => {
      const today = getLocalDateKey();
      setOrders((prevOrders) => {
        const { updatedOrders, expiredCount } = expireStaleOrders(prevOrders, today);
        if (expiredCount > 0) {
          console.info(`[SmartCanteen] Expired ${expiredCount} stale orders from previous days.`);
        }
        return updatedOrders;
      });
    };

    checkExpiry();
    const interval = setInterval(checkExpiry, 60000);
    return () => clearInterval(interval);
  }, []);

  // ---------------------------------------------------------
  // Menu Item Lookup Map
  // ---------------------------------------------------------
  const menuMap = useMemo(() => {
    const map = new Map();
    for (const item of menu) {
      map.set(item.id, item);
    }
    return map;
  }, [menu]);

  // ---------------------------------------------------------
  // Cart Actions & Metrics
  // ---------------------------------------------------------
  const cartBadge = useMemo(() => {
    return cart.reduce((sum, item) => sum + (item.quantity || 0), 0);
  }, [cart]);

  const addToCart = useCallback((itemId) => {
    const menuItem = menuMap.get(itemId);
    if (!menuItem || !menuItem.available) {
      addToast('This item is currently unavailable.', 'error');
      return;
    }

    setCart((prev) => {
      const existing = prev.find((item) => item.itemId === itemId);
      if (existing) {
        return prev.map((item) =>
          item.itemId === itemId ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { itemId, quantity: 1 }];
    });
  }, [menuMap, addToast]);

  const updateCartQuantity = useCallback((itemId, delta) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.itemId === itemId);
      if (!existing) return prev;

      const newQty = existing.quantity + delta;
      if (newQty <= 0) {
        return prev.filter((item) => item.itemId !== itemId);
      }
      return prev.map((item) =>
        item.itemId === itemId ? { ...item, quantity: newQty } : item
      );
    });
  }, []);

  const removeFromCart = useCallback((itemId) => {
    setCart((prev) => prev.filter((item) => item.itemId !== itemId));
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
  }, []);

  // ---------------------------------------------------------
  // Order Placement (with strict double-submit protection)
  // ---------------------------------------------------------
  const placeOrder = useCallback(async (kitchenNote = '') => {
    // 1. Guard against concurrent / duplicate submissions
    if (isPlacingOrderRef.current) {
      console.warn('[SmartCanteen] Blocked duplicate order submission within same tick.');
      return null;
    }
    isPlacingOrderRef.current = true;

    try {
      if (cart.length === 0) {
        addToast('Your cart is empty.', 'error');
        return null;
      }

      // Check if any cart item is unavailable or deleted
      const invalidItems = [];
      const snapshottedItems = [];

      for (const cartRow of cart) {
        const item = menuMap.get(cartRow.itemId);
        if (!item || !item.available) {
          invalidItems.push(item ? item.name : 'Unknown item');
        } else {
          snapshottedItems.push({
            itemId: item.id,
            name: item.name,
            unitPrice: item.price,
            quantity: cartRow.quantity,
            prepTime: item.prepTime
          });
        }
      }

      if (invalidItems.length > 0) {
        addToast(`Cannot place order: ${invalidItems.join(', ')} is unavailable or deleted. Please remove it from cart.`, 'error');
        return null;
      }

      const today = getLocalDateKey();
      const now = new Date();
      const createdAt = now.toISOString();

      // Allocate sequential token
      const { nextToken, nextTokenState } = allocateNextToken(tokenState, orders, today);

      // Estimated pickup time
      const pickupAt = calculateEstimatedPickupTime(snapshottedItems, now);

      const totalAmount = snapshottedItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
      const totalPortions = snapshottedItems.reduce((sum, item) => sum + item.quantity, 0);

      const newOrder = {
        id: `ord_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        token: nextToken,
        dateKey: today,
        createdAt,
        pickupAt,
        items: snapshottedItems,
        totalAmount,
        totalPortions,
        status: 'Placed',
        collectedAt: null,
        note: kitchenNote.trim()
      };

      // Atomic state updates
      setOrders((prev) => [newOrder, ...prev]);
      setTokenState(nextTokenState);
      setCart([]);
      setStudentView('orders');

      addToast(`Pre-order confirmed! Token: ${nextToken}`, 'success');
      return newOrder;
    } finally {
      // Release lock after brief delay
      setTimeout(() => {
        isPlacingOrderRef.current = false;
      }, 300);
    }
  }, [cart, menuMap, tokenState, orders, addToast]);

  // ---------------------------------------------------------
  // Order Lifecycle Transitions
  // Placed -> Preparing -> Ready -> Collected
  // ---------------------------------------------------------
  const transitionOrderStatus = useCallback((orderId, targetStatus) => {
    const validTransitions = {
      Placed: ['Preparing'],
      Preparing: ['Ready'],
      Ready: ['Collected'],
      Collected: [],
      Expired: []
    };

    setOrders((prev) =>
      prev.map((order) => {
        if (order.id !== orderId) return order;

        const allowedNext = validTransitions[order.status] || [];
        if (!allowedNext.includes(targetStatus)) {
          console.warn(`[SmartCanteen] Invalid transition attempted: ${order.status} -> ${targetStatus}`);
          addToast(`Cannot transition order from ${order.status} to ${targetStatus}`, 'error');
          return order;
        }

        const now = new Date().toISOString();
        const updated = {
          ...order,
          status: targetStatus,
          collectedAt: targetStatus === 'Collected' ? now : order.collectedAt
        };

        addToast(`Order ${order.token} marked as ${targetStatus}.`, 'info');
        return updated;
      })
    );
  }, [addToast]);

  // ---------------------------------------------------------
  // Menu Management Actions
  // ---------------------------------------------------------
  const addMenuItem = useCallback((newItem) => {
    const id = `item-${Date.now()}`;
    const itemWithId = { ...newItem, id };
    setMenu((prev) => [...prev, itemWithId]);
    addToast(`"${newItem.name}" added to menu.`, 'success');
  }, [addToast]);

  const updateMenuItem = useCallback((updatedItem) => {
    setMenu((prev) => prev.map((item) => (item.id === updatedItem.id ? updatedItem : item)));
    addToast(`"${updatedItem.name}" updated successfully.`, 'success');
  }, [addToast]);

  const toggleItemAvailability = useCallback((itemId) => {
    setMenu((prev) =>
      prev.map((item) => {
        if (item.id === itemId) {
          const nextVal = !item.available;
          addToast(`${item.name} is now ${nextVal ? 'available' : 'unavailable'}.`, 'info');
          return { ...item, available: nextVal };
        }
        return item;
      })
    );
  }, [addToast]);

  const deleteMenuItem = useCallback((itemId) => {
    const item = menuMap.get(itemId);
    setMenu((prev) => prev.filter((it) => it.id !== itemId));
    // Remove from active cart if present
    setCart((prev) => prev.filter((it) => it.itemId !== itemId));
    addToast(`"${item ? item.name : 'Item'}" removed from menu.`, 'info');
  }, [menuMap, addToast]);

  // ---------------------------------------------------------
  // Reset Demo Data
  // Clears menu (reseeds), cart, orders, and resets token counter to 100
  // ---------------------------------------------------------
  const resetDemoData = useCallback(() => {
    const today = getLocalDateKey();
    setMenu(INITIAL_MENU_ITEMS);
    setCart([]);
    setOrders([]);
    setTokenState({ dateKey: today, counter: INITIAL_TOKEN_COUNTER });
    setSettings({ bufferRate: DEFAULT_BUFFER_RATE });
    setStudentView('menu');
    setStaffView('orders');
    addToast('Demo data reset: menu reseeded, orders cleared, next token SC-101.', 'success');
  }, [addToast]);

  // Helper to load sample orders (handy for viva demonstration)
  const loadSampleOrders = useCallback(() => {
    const today = getLocalDateKey();
    const samples = generateSampleOrders(today, menu);
    setOrders(samples);
    setTokenState({ dateKey: today, counter: 108 });
    addToast('Loaded sample orders for viva demonstration.', 'success');
  }, [menu, addToast]);

  // Settings update (buffer rate)
  const updateBufferRate = useCallback((rate) => {
    const bounded = Math.max(0, Math.min(0.5, Number(rate) || 0));
    setSettings((prev) => ({ ...prev, bufferRate: bounded }));
  }, []);

  // Context value
  const value = {
    role,
    setRole,
    studentView,
    setStudentView,
    staffView,
    setStaffView,
    menu,
    menuMap,
    cart,
    cartBadge,
    orders,
    tokenState,
    settings,
    toasts,
    addToast,
    removeToast,
    confirmDialog,
    setConfirmDialog,
    addToCart,
    updateCartQuantity,
    removeFromCart,
    clearCart,
    placeOrder,
    transitionOrderStatus,
    addMenuItem,
    updateMenuItem,
    toggleItemAvailability,
    deleteMenuItem,
    resetDemoData,
    loadSampleOrders,
    updateBufferRate
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
