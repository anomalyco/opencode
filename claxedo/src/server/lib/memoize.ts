/**
 * Simple in-memory memoization with TTL
 */
import { nowMs } from "./logging.ts";

interface CacheEntry<T> {
  value: Promise<T>;
  expiry: number;
}

export function memoizePromise<T>(
  fn: (...args: any[]) => Promise<T>,
  ttlMs: number,
  swrMs: number = 0,
  keyFn?: (...args: any[]) => string
): (...args: any[]) => Promise<T> {
  const cache = new Map<string, CacheEntry<T>>();
  const pending = new Map<string, Promise<T>>();

  return async (...args: any[]): Promise<T> => {
    const key = keyFn ? keyFn(...args) : JSON.stringify(args);
    const now = nowMs();
    const entry = cache.get(key);

    if (entry) {
      // 1. Fresh: Return immediately (fastest)
      if (entry.expiry > now) {
        return entry.value;
      }
      
      // 2. Stale but within SWR window: Return stale, refresh in background if not already pending
      if (swrMs > 0 && entry.expiry + swrMs > now) {
        if (!pending.has(key)) {
          // Trigger background refresh
          const refreshPromise = fn(...args).then((val) => {
            // Update cache only on success
            cache.set(key, { value: Promise.resolve(val), expiry: nowMs() + ttlMs });
            pending.delete(key);
            return val;
          }).catch((err) => {
            // On failure, keep stale? Or delete?
            // Deleting forces next caller to retry
            cache.delete(key);
            pending.delete(key);
            throw err;
          });
          
          pending.set(key, refreshPromise);
        }
        
        // CRITICAL: Return the OLD value immediately, do not wait for refresh
        return entry.value;
      }
    }

    // 3. Missing or Fully Expired: Fetch and wait (coalescing)
    let promise = pending.get(key);
    if (!promise) {
      promise = fn(...args).then((val) => {
          cache.set(key, { value: Promise.resolve(val), expiry: nowMs() + ttlMs });
          pending.delete(key);
          return val;
      }).catch((err) => {
        pending.delete(key);
        throw err;
      });
      pending.set(key, promise);
    }

    if (cache.size > 1000) {
      for (const [k, v] of cache.entries()) {
        // Only delete if fully expired (past SWR window)
        // Note: now is from start of function, might be slightly old but fine
        if (v.expiry + swrMs <= now) {
          cache.delete(k);
        }
      }
    }
    
    return promise;
  };
}
