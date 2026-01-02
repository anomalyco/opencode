# Memory Leak Fixes Plan

## Summary

This document outlines the memory leak issues identified in the session module and the proposed fixes.

## Issues Identified

### Issue 1: Instance Dispose Callback Missing Callback Rejection (HIGH)

**File**: `prompt.ts:69-73`

**Problem**: When an instance is disposed, the dispose callback only aborts the AbortControllers but doesn't reject the pending promise callbacks. This leaves hanging promises that never resolve or reject.

**Current Code**:

```typescript
async (current) => {
  for (const item of Object.values(current)) {
    item.abort.abort()
  }
},
```

**Fix**: Add callback rejection in the dispose handler:

```typescript
async (current) => {
  for (const item of Object.values(current)) {
    item.abort.abort()
    for (const callback of item.callbacks) {
      callback.reject()
    }
  }
},
```

---

### Issue 2: Abort Listener Not Removed on Timeout (MEDIUM)

**File**: `retry.ts:10-22`

**Problem**: If the timeout resolves before the abort signal fires, the abort event listener remains attached to the signal. While `{ once: true }` ensures it fires only once if aborted, it doesn't remove the listener if the timeout fires first. This causes a minor memory leak for long-lived signals.

**Current Code**:

```typescript
export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, Math.min(ms, RETRY_MAX_DELAY))
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout)
        reject(new DOMException("Aborted", "AbortError"))
      },
      { once: true },
    )
  })
}
```

**Fix**: Store the abort handler and remove it when timeout resolves:

```typescript
export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abortHandler = () => {
      clearTimeout(timeout)
      reject(new DOMException("Aborted", "AbortError"))
    }
    const timeout = setTimeout(
      () => {
        signal.removeEventListener("abort", abortHandler)
        resolve()
      },
      Math.min(ms, RETRY_MAX_DELAY),
    )
    signal.addEventListener("abort", abortHandler, { once: true })
  })
}
```

---

### Issue 3: Orphaned AbortControllers (LOW - Optional)

**Files**:

- `summary.ts:102`, `summary.ts:143`
- `prompt.ts:884-892`, `prompt.ts:945-953`

**Problem**: New `AbortController()` instances are created inline and passed to functions, but the controllers are never stored or explicitly aborted. While this isn't a significant leak (GC handles them when streams complete), it's a code smell.

**Example**:

```typescript
abort: new AbortController().signal,
```

**Recommendation**: Leave as-is. The overhead is minimal and the code is clearer. The streams complete naturally and the objects are garbage collected.

---

## Implementation Checklist

- [ ] Fix Issue 1: Add callback rejection in `prompt.ts` dispose handler
- [ ] Fix Issue 2: Clean up abort listener in `retry.ts` sleep function
- [ ] (Optional) Issue 3: No action needed

## Testing Notes

After implementing fixes:

1. Verify existing tests pass
2. Manually test session cancellation during active processing
3. Verify instance disposal properly cleans up all pending sessions
