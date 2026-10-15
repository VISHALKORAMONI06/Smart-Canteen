/**
 * useOrders — Order data fetching and real-time subscription hook.
 * Student mode: fetches and subscribes to their own orders.
 * Staff/admin mode: fetches and subscribes to all orders.
 * Demo mode (no Supabase): uses LocalStorage.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { isSupabaseConfigured } from '../lib/supabaseClient.js';
import {
  fetchMyOrders,
  fetchAllOrders,
  placeOrder as placeOrderService,
  transitionOrderStatus as transitionStatusService,
  subscribeToStudentOrders,
  subscribeToAllOrders
} from '../services/orderService.js';
import { safeLoad, safeSave, STORAGE_KEYS } from '../utils/storage.js';
import { getLocalDateKey, calculateEstimatedPickupTime, expireStaleOrders } from '../utils/dates.js';
import { allocateNextToken, INITIAL_TOKEN_COUNTER } from '../utils/tokens.js';
import { generateSampleOrders } from '../utils/sampleOrders.js';
import { INITIAL_MENU_ITEMS } from '../utils/seedMenu.js';

export function useOrders({ role = 'student', userId = null, menu = [] }) {
  const [orders, setOrders]             = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError]   = useState(null);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const isPlacingRef = useRef(false);
  const channelRef   = useRef(null);

  // Demo-mode token state
  const [tokenState, setTokenState] = useState(() =>
    safeLoad(STORAGE_KEYS.TOKEN_STATE, { dateKey: getLocalDateKey(), counter: 108 }, (d) =>
      Boolean(d && typeof d.counter === 'number' && typeof d.dateKey === 'string')
    )
  );

  // ---------------------------------------------------------------------------
  // Demo-mode: initialize orders from LocalStorage or sample data
  // ---------------------------------------------------------------------------
  const getDemoOrders = useCallback(() => {
    const today = getLocalDateKey();
    const stored = safeLoad(STORAGE_KEYS.ORDERS, null, Array.isArray);
    if (stored !== null) return stored;
    return generateSampleOrders(today, INITIAL_MENU_ITEMS);
  }, []);

  // ---------------------------------------------------------------------------
  // Load orders
  // ---------------------------------------------------------------------------
  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    setOrdersError(null);

    if (!isSupabaseConfigured) {
      const today = getLocalDateKey();
      const { updatedOrders } = expireStaleOrders(getDemoOrders(), today);
      setOrders(updatedOrders);
      setOrdersLoading(false);
      return;
    }

    try {
      if (!userId) {
        setOrders([]);
        setOrdersLoading(false);
        return;
      }

      const today = getLocalDateKey();
      const fetchFn = (role === 'staff' || role === 'admin')
        ? () => fetchAllOrders(today)
        : () => fetchMyOrders(userId);

      const { orders: fetched, error } = await fetchFn();
      if (error) {
        console.error('[SmartCanteen] Orders load error:', error.message);
        setOrdersError(error.message);
      } else {
        setOrders(fetched || []);
      }
    } catch (err) {
      console.error('[SmartCanteen] Orders load exception:', err);
      setOrdersError(err.message);
    } finally {
      setOrdersLoading(false);
    }
  }, [role, userId, getDemoOrders]);

  // ---------------------------------------------------------------------------
  // Subscribe to real-time order changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    loadOrders();

    if (isSupabaseConfigured && userId) {
      const subscribeFn = (role === 'staff' || role === 'admin')
        ? (cb) => subscribeToAllOrders(cb)
        : (cb) => subscribeToStudentOrders(userId, cb);

      const { unsubscribe } = subscribeFn(({ type, order, id }) => {
        if (type === 'DELETED') {
          setOrders((prev) => prev.filter((o) => o.id !== id));
          return;
        }
        if (type === 'INSERT') {
          setOrders((prev) => {
            if (prev.find((o) => o.id === order.id)) return prev;
            return [order, ...prev];
          });
        }
        if (type === 'UPDATE') {
          setOrders((prev) => prev.map((o) => o.id === order.id ? order : o));
        }
      });

      channelRef.current = unsubscribe;
    }

    return () => {
      if (channelRef.current) {
        channelRef.current();
        channelRef.current = null;
      }
    };
  }, [loadOrders, role, userId]);

  // ---------------------------------------------------------------------------
  // Persist demo-mode orders to LocalStorage
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isSupabaseConfigured) {
      safeSave(STORAGE_KEYS.ORDERS, orders);
    }
  }, [orders]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      safeSave(STORAGE_KEYS.TOKEN_STATE, tokenState);
    }
  }, [tokenState]);

  // ---------------------------------------------------------------------------
  // Demo-mode: expire stale orders on mount + interval
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (isSupabaseConfigured) return;

    const checkExpiry = () => {
      const today = getLocalDateKey();
      setOrders((prev) => {
        const { updatedOrders, expiredCount } = expireStaleOrders(prev, today);
        if (expiredCount > 0) {
          console.info(`[SmartCanteen] Expired ${expiredCount} stale orders.`);
        }
        return updatedOrders;
      });
    };

    checkExpiry();
    const interval = setInterval(checkExpiry, 60000);
    return () => clearInterval(interval);
  }, []);

  // ---------------------------------------------------------------------------
  // Place order — real (via RPC) or demo (local state)
  // ---------------------------------------------------------------------------
  const placeOrder = useCallback(async ({ cart, menuMap, kitchenNote = '', idempotencyKey }) => {
    if (isPlacingRef.current) {
      return { error: new Error('Duplicate submission blocked'), order: null };
    }
    isPlacingRef.current = true;
    setIsPlacingOrder(true);

    try {
      if (cart.length === 0) {
        return { error: new Error('Your cart is empty.'), order: null };
      }

      // Validate all cart items are available
      const invalidItems = [];
      for (const cartRow of cart) {
        const item = menuMap.get(cartRow.itemId);
        if (!item || !item.available) {
          invalidItems.push(item ? item.name : 'Unknown item');
        }
      }
      if (invalidItems.length > 0) {
        return {
          error: new Error(`Cannot place order: ${invalidItems.join(', ')} is unavailable. Please remove it from your cart.`),
          order: null
        };
      }

      if (!isSupabaseConfigured) {
        // Demo mode: place order locally
        const today = getLocalDateKey();
        const now = new Date();
        const snapshottedItems = cart.map((cartRow) => {
          const item = menuMap.get(cartRow.itemId);
          return {
            itemId:    item.id,
            name:      item.name,
            unitPrice: item.price,
            quantity:  cartRow.quantity,
            prepTime:  item.prepTime
          };
        });
        const { nextToken, nextTokenState } = allocateNextToken(tokenState, orders, today);
        const pickupAt = calculateEstimatedPickupTime(snapshottedItems, now);
        const totalAmount = snapshottedItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

        const newOrder = {
          id:           `ord_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          token:        nextToken,
          dateKey:      today,
          createdAt:    now.toISOString(),
          pickupAt,
          items:        snapshottedItems,
          totalAmount,
          totalPortions: snapshottedItems.reduce((s, i) => s + i.quantity, 0),
          status:       'Placed',
          collectedAt:  null,
          note:         kitchenNote.trim()
        };

        setOrders((prev) => [newOrder, ...prev]);
        setTokenState(nextTokenState);
        return { order: newOrder, error: null };
      }

      // Supabase mode: call RPC
      const { data, error } = await placeOrderService({
        cartItems:       cart,
        studentNote:     kitchenNote,
        idempotencyKey:  idempotencyKey || crypto.randomUUID()
      });

      if (error) {
        return { error, order: null };
      }

      // Refresh orders after placement (realtime will also update)
      loadOrders();
      return {
        order: {
          id:          data.order_id,
          token:       data.token,
          status:      data.status,
          totalAmount: Math.round((data.total_paise || 0) / 100),
          pickupAt:    data.estimated_pickup,
          createdAt:   data.created_at
        },
        error: null
      };
    } finally {
      setTimeout(() => { isPlacingRef.current = false; }, 500);
      setIsPlacingOrder(false);
    }
  }, [orders, tokenState, loadOrders]); // cart and menuMap are passed in as args

  // ---------------------------------------------------------------------------
  // Transition order status — real (via RPC) or demo (local state)
  // ---------------------------------------------------------------------------
  const transitionOrderStatus = useCallback(async (orderId, targetStatus) => {
    if (!isSupabaseConfigured) {
      // Demo mode: validate and update locally
      const validTransitions = {
        Placed:    ['Preparing'],
        Preparing: ['Ready'],
        Ready:     ['Collected'],
        Collected: [],
        Expired:   [],
        Cancelled: []
      };

      let errorMsg = null;
      setOrders((prev) =>
        prev.map((order) => {
          if (order.id !== orderId) return order;
          const allowed = validTransitions[order.status] || [];
          if (!allowed.includes(targetStatus)) {
            errorMsg = `Cannot transition order from ${order.status} to ${targetStatus}`;
            return order;
          }
          const now = new Date().toISOString();
          return {
            ...order,
            status:      targetStatus,
            collectedAt: targetStatus === 'Collected' ? now : order.collectedAt
          };
        })
      );
      return { error: errorMsg ? new Error(errorMsg) : null };
    }

    // Supabase mode
    const { data, error } = await transitionStatusService(orderId, targetStatus);
    if (error) return { error };
    // Real-time subscription will update the order in state
    return { data, error: null };
  }, []);

  // ---------------------------------------------------------------------------
  // Demo helpers
  // ---------------------------------------------------------------------------
  const resetDemoOrders = useCallback((newMenu = INITIAL_MENU_ITEMS) => {
    if (isSupabaseConfigured) return;
    const today = getLocalDateKey();
    setOrders([]);
    setTokenState({ dateKey: today, counter: INITIAL_TOKEN_COUNTER });
  }, []);

  const loadSampleOrdersDemo = useCallback((menuItems = INITIAL_MENU_ITEMS) => {
    if (isSupabaseConfigured) return;
    const today = getLocalDateKey();
    const samples = generateSampleOrders(today, menuItems);
    setOrders(samples);
    setTokenState({ dateKey: today, counter: 108 });
  }, []);

  return {
    orders,
    ordersLoading,
    ordersError,
    isPlacingOrder,
    tokenState,
    placeOrder,
    transitionOrderStatus,
    refetchOrders: loadOrders,
    resetDemoOrders,
    loadSampleOrdersDemo
  };
}
