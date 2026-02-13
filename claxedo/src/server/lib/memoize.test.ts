
import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { memoizePromise } from "./memoize.ts";

// Mock implementation
const originalFn = mock(async (x: number) => {
  return x * 2;
});

describe("memoizePromise", () => {
    it("should cache results", async () => {
        const cachedFn = memoizePromise(originalFn, 100);
        
        // First call
        const result1 = await cachedFn(2);
        expect(result1).toBe(4);
        expect(originalFn).toHaveBeenCalledTimes(1);

        // Second call (should be cached)
        const result2 = await cachedFn(2);
        expect(result2).toBe(4);
        expect(originalFn).toHaveBeenCalledTimes(1);
    });

    it("should expire cache after TTL", async () => {
        const cachedFn = memoizePromise(originalFn, 10); // 10ms TTL
        
        // First call
        await cachedFn(3);
        expect(originalFn).toHaveBeenCalledTimes(2); // +1 from previous test

        // Wait for expiry
        await new Promise(r => setTimeout(r, 20));

        // Second call (should be fresh)
        await cachedFn(3);
        expect(originalFn).toHaveBeenCalledTimes(3); 
    });

    it("should distinguish different args", async () => {
        const cachedFn = memoizePromise(originalFn, 100);
        
        await cachedFn(4);
        await cachedFn(5);
        
        expect(originalFn).toHaveBeenCalledTimes(5); // +2 calls
    });
    it("should coalesce concurrent requests", async () => {
        const slowFn = mock(async (x: number) => {
            await new Promise(resolve => setTimeout(resolve, 50));
            return x * 2;
        });
        const cachedFn = memoizePromise(slowFn, 100);

        // Call 3 times concurrently
        const p1 = cachedFn(10);
        const p2 = cachedFn(10);
        const p3 = cachedFn(10);

        const results = await Promise.all([p1, p2, p3]);

        expect(results).toEqual([20, 20, 20]);
        expect(slowFn).toHaveBeenCalledTimes(1); // Only called once!
    });
    it("should serve stale data immediately during background refresh", async () => {
        let calls = 0;
        const slowRefresher = async (x: number) => {
            calls++;
            await new Promise(resolve => setTimeout(resolve, 100)); // Slow
            return x * 2 + calls; // Change value to prove update
        };
        
        // TTL 50ms, SWR 1000ms
        const cachedFn = memoizePromise(slowRefresher, 50, 1000);

        // 1. Prime cache
        const val1 = await cachedFn(1);
        expect(val1).toBe(3); // 1 * 2 + 1
        expect(calls).toBe(1);

        // 2. Wait for staleness (TTL expired)
        await new Promise(r => setTimeout(r, 60));

        // 3. Trigger refresh (Call A)
        const t0 = performance.now();
        const p1 = cachedFn(1);
        
        // 4. Concurrent request (Call B) - SHOULD NOT BLOCK
        const p2 = cachedFn(1);

        const valA = await p1;
        const valB = await p2;
        const duration = performance.now() - t0;

        // Both should get the OLD value (3) instantly
        expect(valA).toBe(3);
        expect(valB).toBe(3);
        
        // Duration should be fast (< 50ms), even though refresher takes 100ms
        // If it blocks, duration will be > 100ms
        expect(duration).toBeLessThan(50);
        
        // usage: Wait for refresh to likely finish
        await new Promise(r => setTimeout(r, 150));
        
        // 5. Next call gets new value
        const valNew = await cachedFn(1);
        expect(valNew).toBe(4); // 1 * 2 + 2
        expect(calls).toBe(2);
    });
});
