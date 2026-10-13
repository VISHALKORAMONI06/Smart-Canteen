/**
 * Safe LocalStorage abstraction for SmartCanteen.
 * Prevents crashes on corrupted JSON or invalid shapes.
 */

export const STORAGE_KEYS = {
  MENU: 'smartcanteen:menu',
  CART: 'smartcanteen:cart',
  ORDERS: 'smartcanteen:orders',
  TOKEN_STATE: 'smartcanteen:tokenState',
  SETTINGS: 'smartcanteen:settings'
};

/**
 * Safely loads and parses data from LocalStorage with validator.
 * @template T
 * @param {string} key - Full storage key
 * @param {T} fallback - Default fallback value if missing, corrupted or invalid
 * @param {function(any): boolean} [validator] - Optional shape validator function
 * @returns {T}
 */
export function safeLoad(key, fallback, validator = () => true) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined) {
      return fallback;
    }
    const parsed = JSON.parse(raw);
    if (validator && !validator(parsed)) {
      console.warn(`[SmartCanteen Storage] Validator failed for key "${key}", falling back to default.`);
      return fallback;
    }
    return parsed;
  } catch (err) {
    console.warn(`[SmartCanteen Storage] Error parsing key "${key}":`, err);
    return fallback;
  }
}

/**
 * Safely saves data to LocalStorage.
 * @param {string} key
 * @param {any} value
 */
export function safeSave(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`[SmartCanteen Storage] Failed to save key "${key}":`, err);
  }
}

/**
 * Safely removes a key from LocalStorage.
 * @param {string} key
 */
export function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    console.error(`[SmartCanteen Storage] Failed to remove key "${key}":`, err);
  }
}
