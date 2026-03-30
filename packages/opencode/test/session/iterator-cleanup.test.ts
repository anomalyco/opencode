import { describe, expect, test } from "bun:test"

/**
 * Unit tests for the async iterator cleanup pattern used in processor.ts.
 *
 * The processor wraps its `while(true)` iterator consumption in try/finally
 * with `await iter.return?.().catch(() => {})` in the finally block. These
 * tests verify the pattern works correctly for all exit paths.
 *
 * Validates: Property 8 (Iterator Cleanup on Abort)
 */

function mock(items: number[]) {
  let idx = 0
  const spy = { calls: 0 }
  const iter: AsyncIterator<number> = {
    async next() {
      if (idx >= items.length) return { done: true as const, value: undefined }
      return { done: false as const, value: items[idx++] }
    },
    async return() {
      spy.calls++
      return { done: true as const, value: undefined }
    },
  }
  return { iter, spy }
}

describe("iterator cleanup", () => {
  test("Property 8: return() called on abort", async () => {
    const { iter, spy } = mock([1, 2, 3, 4, 5])
    const controller = new AbortController()
    const aborted = new Promise<never>((_, reject) => {
      if (controller.signal.aborted) return reject(new DOMException("Aborted", "AbortError"))
      controller.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
        once: true,
      })
    })

    const collected: number[] = []
    try {
      while (true) {
        const { done, value } = await Promise.race([iter.next(), aborted])
        if (done) break
        controller.signal.throwIfAborted()
        collected.push(value)
        if (collected.length === 2) controller.abort()
      }
    } catch {
      // abort error expected
    } finally {
      await iter.return?.().catch(() => {})
    }

    expect(spy.calls).toBe(1)
    expect(collected).toEqual([1, 2])
  })

  test("Property 8: return() called on normal completion", async () => {
    const { iter, spy } = mock([1, 2, 3])
    const aborted = new Promise<never>(() => {})

    const collected: number[] = []
    try {
      while (true) {
        const { done, value } = await Promise.race([iter.next(), aborted])
        if (done) break
        collected.push(value)
      }
    } finally {
      await iter.return?.().catch(() => {})
    }

    expect(spy.calls).toBe(1)
    expect(collected).toEqual([1, 2, 3])
  })

  test("Property 8: return() error suppressed", async () => {
    const iter: AsyncIterator<number> = {
      async next() {
        return { done: true as const, value: undefined }
      },
      async return() {
        throw new Error("cleanup failed")
      },
    }

    // Should not throw despite return() throwing
    try {
      while (true) {
        const { done } = await iter.next()
        if (done) break
      }
    } finally {
      await iter.return?.().catch(() => {})
    }

    // Reaching here means the error was suppressed
    expect(true).toBe(true)
  })

  test("Property 8: return() tolerates exhausted iterator", async () => {
    const { iter, spy } = mock([])

    try {
      while (true) {
        const { done } = await iter.next()
        if (done) break
      }
    } finally {
      await iter.return?.().catch(() => {})
    }

    expect(spy.calls).toBe(1)
  })

  test("Property 8: return() called on thrown error", async () => {
    const { iter, spy } = mock([1, 2, 3])
    const aborted = new Promise<never>(() => {})

    let caught = false
    try {
      while (true) {
        const { done, value } = await Promise.race([iter.next(), aborted])
        if (done) break
        if (value === 2) throw new Error("processing error")
      }
    } catch {
      caught = true
    } finally {
      await iter.return?.().catch(() => {})
    }

    expect(caught).toBe(true)
    expect(spy.calls).toBe(1)
  })

  test("Property 8: pre-aborted signal triggers immediate rejection and return()", async () => {
    const { iter, spy } = mock([1, 2, 3])
    const controller = new AbortController()
    controller.abort()
    const aborted = new Promise<never>((_, reject) => {
      if (controller.signal.aborted) return reject(new DOMException("Aborted", "AbortError"))
      controller.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
        once: true,
      })
    })

    let caught = false
    try {
      while (true) {
        const { done, value } = await Promise.race([iter.next(), aborted])
        if (done) break
        controller.signal.throwIfAborted()
      }
    } catch {
      caught = true
    } finally {
      await iter.return?.().catch(() => {})
    }

    expect(caught).toBe(true)
    expect(spy.calls).toBe(1)
  })
})
