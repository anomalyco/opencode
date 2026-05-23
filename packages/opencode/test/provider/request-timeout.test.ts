import { describe, expect, test } from "bun:test"
import { SessionRetry } from "../../src/session/retry"
import { createTimeoutFetch } from "../../src/provider/provider"
import { WakeWatch } from "../../src/provider/wake"

describe("request timeout retryable classification", () => {
  test('retryable returns message for "request timed out"', () => {
    const error = { name: "", data: { message: "request timed out" } }
    expect(SessionRetry.retryable(error as any, "ollama-cloud")).toEqual({
      message: "request timed out",
    })
  })
})

// A spec-compliant fake fetch that rejects with signal.reason on abort.
const hangingFetch = ((_input: any, init?: any) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal.reason))
  })) as unknown as typeof fetch

// A fake fetch that resolves immediately with a plain JSON response.
const successFetch = ((_input: any, _init?: any) =>
  Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))) as unknown as typeof fetch

// A fake fetch that resolves immediately with an SSE response.
const sseFetch = ((_input: any, _init?: any) =>
  Promise.resolve(
    new Response(
      new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(new TextEncoder().encode("data: hello\n\n"))
          ctrl.close()
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    ),
  )) as unknown as typeof fetch

// A fake fetch that rejects immediately (e.g. ECONNREFUSED).
const refusedFetch = ((_input: any, _init?: any) =>
  Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch

describe("createTimeoutFetch — (a) timeout path: rejects with 'request timed out', not AbortError", () => {
  test("awaited fetch rejects with message 'request timed out' when timeout fires", async () => {
    const wrappedFetch = createTimeoutFetch(hangingFetch, {
      timeout: 20,
      chunkTimeout: 0,
      npm: "@ai-sdk/openai-compatible",
    })

    await expect(wrappedFetch("https://example.com")).rejects.toMatchObject({
      message: "request timed out",
    })
  })

  test("rejection is an Error (not a DOMException/AbortError)", async () => {
    const wrappedFetch = createTimeoutFetch(hangingFetch, {
      timeout: 20,
      chunkTimeout: 0,
      npm: "@ai-sdk/openai-compatible",
    })

    const err = await wrappedFetch("https://example.com").catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).not.toBe("AbortError")
    expect(err.message).toBe("request timed out")
  })
})

describe("createTimeoutFetch — (b) registration leak fix", () => {
  test("timeout path: WakeWatch size returns to baseline after timeout rejection", async () => {
    const baseline = WakeWatch.size()

    const wrappedFetch = createTimeoutFetch(hangingFetch, {
      timeout: 20,
      chunkTimeout: 0,
      npm: "@ai-sdk/openai-compatible",
    })

    await wrappedFetch("https://example.com").catch(() => {})

    expect(WakeWatch.size()).toBe(baseline)
  })

  test("immediate-throw path: WakeWatch size returns to baseline after ECONNREFUSED", async () => {
    const baseline = WakeWatch.size()

    const wrappedFetch = createTimeoutFetch(refusedFetch, {
      timeout: false,
      chunkTimeout: 0,
      npm: "@ai-sdk/openai-compatible",
    })

    await wrappedFetch("https://example.com").catch(() => {})

    expect(WakeWatch.size()).toBe(baseline)
  })

  test("immediate-throw path: re-throws the original error", async () => {
    const wrappedFetch = createTimeoutFetch(refusedFetch, {
      timeout: false,
      chunkTimeout: 0,
      npm: "@ai-sdk/openai-compatible",
    })

    await expect(wrappedFetch("https://example.com")).rejects.toMatchObject({
      message: "ECONNREFUSED",
    })
  })
})

describe("createTimeoutFetch — (c) timeout: false path", () => {
  test("hanging fetch is NOT aborted within 40ms when timeout is false", async () => {
    let aborted = false
    const monitoredHangingFetch = ((_input: any, init?: any) =>
      new Promise((_resolve, _reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true
        })
      })) as unknown as typeof fetch

    const wrappedFetch = createTimeoutFetch(monitoredHangingFetch, {
      timeout: false,
      chunkTimeout: 0,
      npm: "@ai-sdk/openai-compatible",
    })

    const promise = wrappedFetch("https://example.com")
    await new Promise((r) => setTimeout(r, 40))
    expect(aborted).toBe(false)
    // Don't await promise — it hangs intentionally
    promise.catch(() => {})
  })

  test("successful fetch resolves normally when timeout is false", async () => {
    const wrappedFetch = createTimeoutFetch(successFetch, {
      timeout: false,
      chunkTimeout: 0,
      npm: "@ai-sdk/openai-compatible",
    })

    const res = await wrappedFetch("https://example.com")
    expect(res.status).toBe(200)
  })
})

describe("createTimeoutFetch — (d) successful response: timer cleared and registration released", () => {
  test("non-SSE response: WakeWatch size returns to baseline after success", async () => {
    const baseline = WakeWatch.size()

    const wrappedFetch = createTimeoutFetch(successFetch, {
      timeout: 5000,
      chunkTimeout: 0,
      npm: "@ai-sdk/openai-compatible",
    })

    const res = await wrappedFetch("https://example.com")
    expect(res.status).toBe(200)
    expect(WakeWatch.size()).toBe(baseline)
  })

  test("non-SSE response is returned as-is (not wrapped)", async () => {
    const wrappedFetch = createTimeoutFetch(successFetch, {
      timeout: 5000,
      chunkTimeout: 120_000,
      npm: "@ai-sdk/openai-compatible",
    })

    const res = await wrappedFetch("https://example.com")
    // content-type is application/json — should NOT be treated as SSE
    const ct = res.headers.get("content-type") ?? ""
    expect(ct).not.toContain("text/event-stream")
    const body = await res.json()
    expect(body).toEqual({ ok: true })
  })

  test("SSE response is wrapped (still readable)", async () => {
    const wrappedFetch = createTimeoutFetch(sseFetch, {
      timeout: 5000,
      chunkTimeout: 120_000,
      npm: "@ai-sdk/openai-compatible",
    })

    const res = await wrappedFetch("https://example.com")
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    const text = await res.text()
    expect(text).toContain("data: hello")
  })
})
