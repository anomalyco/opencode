import { describe, expect, test } from "bun:test"
import type { ServerConnection } from "@/context/server"
import { checkServerHealth, waitForServerReady } from "./server-health"

const server: ServerConnection.HttpBase = {
  url: "http://localhost:4096",
}

function abortFromInput(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.signal) return init.signal
  if (input instanceof Request) return input.signal
  return undefined
}

describe("checkServerHealth", () => {
  test("returns healthy response with version", async () => {
    let request: URL | undefined
    const fetch = (async (input: RequestInfo | URL) => {
      request = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input)
      return new Response(JSON.stringify({ healthy: true, version: "1.2.3" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch)

    expect(result).toEqual({ healthy: true, version: "1.2.3" })
    expect(request?.pathname).toBe("/api/health")
  })

  test("falls back to the V1 health endpoint", async () => {
    const paths: string[] = []
    const fetch = (async (input: RequestInfo | URL) => {
      const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input)
      paths.push(url.pathname)
      if (url.pathname === "/api/health") return new Response(undefined, { status: 404 })
      return Response.json({ healthy: true, version: "1.18.4" })
    }) as unknown as typeof globalThis.fetch

    expect(await checkServerHealth(server, fetch)).toEqual({ healthy: true, version: "1.18.4" })
    expect(paths).toEqual(["/api/health", "/global/health"])
  })

  test("falls back when the current health response is malformed", async () => {
    const paths: string[] = []
    const fetch = (async (input: RequestInfo | URL) => {
      const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input)
      paths.push(url.pathname)
      if (url.pathname === "/api/health") return Response.json({})
      return Response.json({ healthy: true, version: "1.18.4" })
    }) as unknown as typeof globalThis.fetch

    expect(await checkServerHealth(server, fetch)).toEqual({ healthy: true, version: "1.18.4" })
    expect(paths).toEqual(["/api/health", "/global/health"])
  })

  test("allows slow servers thirty seconds by default", async () => {
    const timeout = Object.getOwnPropertyDescriptor(AbortSignal, "timeout")
    let timeoutMs = 0
    Object.defineProperty(AbortSignal, "timeout", {
      configurable: true,
      value: (ms: number) => {
        timeoutMs = ms
        return new AbortController().signal
      },
    })

    const fetch = (async () =>
      new Response(JSON.stringify({ healthy: true, version: "1.2.3" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof globalThis.fetch

    await checkServerHealth(server, fetch).finally(() => {
      if (timeout) Object.defineProperty(AbortSignal, "timeout", timeout)
      if (!timeout) Reflect.deleteProperty(AbortSignal, "timeout")
    })

    expect(timeoutMs).toBe(30_000)
  })

  test("returns unhealthy when request fails", async () => {
    const fetch = (async () => {
      throw new Error("network")
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch)

    expect(result).toEqual({ healthy: false })
  })

  test("uses timeout fallback when AbortSignal.timeout is unavailable", async () => {
    const timeout = Object.getOwnPropertyDescriptor(AbortSignal, "timeout")
    Object.defineProperty(AbortSignal, "timeout", {
      configurable: true,
      value: undefined,
    })

    let aborted = false
    const fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = abortFromInput(input, init)
        signal?.addEventListener(
          "abort",
          () => {
            aborted = true
            reject(new DOMException("Aborted", "AbortError"))
          },
          { once: true },
        )
      })) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch, {
      timeoutMs: 10,
    }).finally(() => {
      if (timeout) Object.defineProperty(AbortSignal, "timeout", timeout)
      if (!timeout) Reflect.deleteProperty(AbortSignal, "timeout")
    })

    expect(aborted).toBe(true)
    expect(result).toEqual({ healthy: false })
  })

  test("aborts the in-flight request when the provided signal fires", async () => {
    let signal: AbortSignal | undefined
    // Hangs until its signal fires, like a request against a dead server.
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      signal = abortFromInput(input, init)
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
      })
    }) as unknown as typeof globalThis.fetch

    const abort = new AbortController()
    setTimeout(() => abort.abort(), 20)
    await checkServerHealth(server, fetch, {
      signal: abort.signal,
      retryCount: 0,
    })

    // The request sees a derived signal that also covers the per-attempt
    // timeout; firing the caller's signal must still abort the request.
    expect(signal?.aborted).toBe(true)
  })

  test("retries transient failures and eventually succeeds", async () => {
    let count = 0
    const fetch = (async () => {
      count += 1
      if (count < 3) throw new TypeError("network")
      return new Response(JSON.stringify({ healthy: true, version: "1.2.3" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch, {
      retryCount: 2,
      retryDelayMs: 1,
    })

    expect(count).toBe(3)
    expect(result).toEqual({ healthy: true, version: "1.2.3" })
  })

  test("returns unhealthy when retries are exhausted", async () => {
    let count = 0
    const fetch = (async () => {
      count += 1
      throw new TypeError("network")
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch, {
      retryCount: 2,
      retryDelayMs: 1,
    })

    expect(count).toBe(6)
    expect(result).toEqual({ healthy: false })
  })
})

describe("waitForServerReady", () => {
  test("resolves immediately when the server is already healthy", async () => {
    const fetch = (async () =>
      new Response(JSON.stringify({ healthy: true, version: "1.2.3" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof globalThis.fetch

    const ready = await waitForServerReady(server, fetch, { timeoutMs: 1000, pollMs: 50 })

    expect(ready).toBe(true)
  })

  test("waits and resolves once the server becomes reachable", async () => {
    let count = 0
    const fetch = (async () => {
      count += 1
      if (count < 3) throw new TypeError("Failed to fetch")
      return new Response(JSON.stringify({ healthy: true, version: "1.2.3" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof globalThis.fetch

    const ready = await waitForServerReady(server, fetch, { timeoutMs: 5000, pollMs: 20 })

    expect(ready).toBe(true)
    expect(count).toBeGreaterThanOrEqual(3)
  })

  test("returns false when the server never becomes reachable", async () => {
    const fetch = (async () => {
      throw new TypeError("Failed to fetch")
    }) as unknown as typeof globalThis.fetch

    const ready = await waitForServerReady(server, fetch, { timeoutMs: 200, pollMs: 20 })

    expect(ready).toBe(false)
  })

  test("aborts early when the signal fires", async () => {
    const fetch = (async () => {
      throw new TypeError("Failed to fetch")
    }) as unknown as typeof globalThis.fetch
    const abort = new AbortController()
    abort.abort()

    const ready = await waitForServerReady(server, fetch, { timeoutMs: 5000, pollMs: 20, signal: abort.signal })

    expect(ready).toBe(false)
  })

  test("aborts the in-flight health request when the caller signal fires mid-poll", async () => {
    let requestAborted = false
    // A fetch that hangs until its abort signal fires, like the platform fetch.
    const fetch = ((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            requestAborted = true
            reject(new DOMException("Aborted", "AbortError"))
          },
          { once: true },
        )
      })) as unknown as typeof globalThis.fetch
    const controller = new AbortController()

    const pending = waitForServerReady(server, fetch, { timeoutMs: 10_000, pollMs: 20, signal: controller.signal })
    setTimeout(() => controller.abort(), 50)

    const started = Date.now()
    const ready = await pending

    expect(ready).toBe(false)
    expect(requestAborted).toBe(true)
    // The in-flight attempt is cut off instead of waiting for its own timeout.
    expect(Date.now() - started).toBeLessThan(5000)
  })

  test("cuts off a hung attempt so the total wall clock stays near timeoutMs", async () => {
    const started = Date.now()
    // A request that never settles must be abandoned by the per-attempt
    // timeout, and each attempt is bounded by the time left before the overall
    // deadline — otherwise the poll overshoots `timeoutMs` by up to a poll
    // budget per iteration.
    const fetch = ((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
      })) as unknown as typeof globalThis.fetch

    const ready = await waitForServerReady(server, fetch, { timeoutMs: 200, pollMs: 150 })

    const elapsed = Date.now() - started
    expect(ready).toBe(false)
    // Without the remaining-time clamp this poll overshoots to ~timeoutMs +
    // (pollMs * 4) + pollMs.
    expect(elapsed).toBeLessThan(600)
  })

  test("readiness gate blocks the fan-out and fails fast when the server never becomes ready", async () => {
    // Pins the wiring contract used by both gates in server-sync.tsx (global
    // bootstrap + per-directory fan-out): when readiness fails, no data
    // requests are fired into the dead server and the caller gets an error.
    const fetch = (async () => {
      throw new TypeError("Failed to fetch")
    }) as unknown as typeof globalThis.fetch
    let fanOutCalls = 0
    const gatedFanOut = async () => {
      const ready = await waitForServerReady(server, fetch, { timeoutMs: 200, pollMs: 20 })
      if (!ready) throw new Error("Could not reach http://localhost:4096")
      fanOutCalls += 1
    }

    await expect(gatedFanOut()).rejects.toThrow("Could not reach")
    expect(fanOutCalls).toBe(0)
  })
})
