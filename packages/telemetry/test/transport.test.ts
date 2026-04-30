import { describe, test, expect } from "bun:test"
import { Transport } from "../src/transport.ts"
import type { PlausibleEvent } from "../src/types.ts"

function makeEvent(name = "test.event"): PlausibleEvent {
  return { name, url: "app://event", domain: "opencode.cli" }
}

/** Build a fake fetch that records calls and returns a configurable response. */
function fakeFetch(opts: { ok?: boolean; failures?: number; throwError?: boolean } = {}) {
  const calls: { url: string; init?: RequestInit }[] = []
  let failuresLeft = opts.failures ?? 0
  const impl = async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    if (opts.throwError) throw new Error("network down")
    if (failuresLeft > 0) {
      failuresLeft--
      return new Response("err", { status: 500 })
    }
    return new Response("ok", { status: opts.ok === false ? 400 : 202 })
  }
  // Bun's `fetch` type adds an extra `preconnect` field on top of the standard
  // signature. We don't need it for tests, so cast through `unknown`.
  const fn = impl as unknown as typeof fetch
  return { fn, calls }
}

describe("Transport", () => {
  test("opt-out short-circuits all fetch calls", async () => {
    const { fn, calls } = fakeFetch()
    const t = new Transport({
      endpoint: "https://example.invalid/api/event",
      enabled: false,
      userAgent: "test/1.0",
      baseProps: { version: "1.0.0", install_id: "abc" },
      fetchImpl: fn,
    })
    t.enqueue(makeEvent())
    t.enqueue(makeEvent())
    await t.flush()
    expect(calls.length).toBe(0)
    expect(t.bufferSize()).toBe(0)
  })

  test("flush sends each buffered event once", async () => {
    const { fn, calls } = fakeFetch()
    const t = new Transport({
      endpoint: "https://example.invalid/api/event",
      enabled: true,
      userAgent: "test/1.0",
      baseProps: { version: "1.0.0", install_id: "abc" },
      fetchImpl: fn,
    })
    t.enqueue(makeEvent("a"))
    t.enqueue(makeEvent("b"))
    t.enqueue(makeEvent("c"))
    await t.flush()
    expect(calls.length).toBe(3)
    // Each call carries the event name and the merged base props in body.
    const bodies = calls.map((c) => JSON.parse((c.init?.body as string) ?? ""))
    expect(bodies.map((b) => b.name)).toEqual(["a", "b", "c"])
    expect(bodies[0].props.version).toBe("1.0.0")
    expect(bodies[0].props.install_id).toBe("abc")
  })

  test("buffer auto-flushes when size threshold is reached", async () => {
    const { fn, calls } = fakeFetch()
    const sent: { ok: boolean }[] = []
    const t = new Transport({
      endpoint: "https://example.invalid/api/event",
      enabled: true,
      userAgent: "test/1.0",
      baseProps: {},
      fetchImpl: fn,
      maxBufferSize: 3,
      onSendResult: (ok) => sent.push({ ok }),
    })
    t.enqueue(makeEvent("a"))
    t.enqueue(makeEvent("b"))
    expect(calls.length).toBe(0) // not yet
    t.enqueue(makeEvent("c"))
    // The third enqueue triggers an async flush; wait for it.
    await t.flush()
    expect(calls.length).toBe(3)
    expect(sent.length).toBe(3)
    expect(sent.every((s) => s.ok)).toBe(true)
  })

  test("failed fetch does not throw out of enqueue/flush", async () => {
    const { fn } = fakeFetch({ throwError: true })
    const t = new Transport({
      endpoint: "https://example.invalid/api/event",
      enabled: true,
      userAgent: "test/1.0",
      baseProps: {},
      fetchImpl: fn,
      maxRetries: 1, // keep this test fast
    })
    t.enqueue(makeEvent("a"))
    // Should resolve, not reject.
    let threw = false
    try {
      await t.flush()
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
  })

  test("retries on 5xx and stops after maxRetries (no throw)", async () => {
    const { fn, calls } = fakeFetch({ failures: 5 }) // always 500
    const results: { ok: boolean; attempts: number }[] = []
    const t = new Transport({
      endpoint: "https://example.invalid/api/event",
      enabled: true,
      userAgent: "test/1.0",
      baseProps: {},
      fetchImpl: fn,
      maxRetries: 3,
      initialBackoffMs: 0, // skip the real backoff to keep the test fast
      requestTimeoutMs: 100,
      onSendResult: (ok, _ev, attempts) => results.push({ ok, attempts }),
    })
    t.enqueue(makeEvent("a"))
    await t.flush()
    expect(calls.length).toBe(3) // 3 attempts, all 500
    expect(results.length).toBe(1)
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.attempts).toBe(3)
  })

  test("flush with empty buffer is a no-op", async () => {
    const { fn, calls } = fakeFetch()
    const t = new Transport({
      endpoint: "https://example.invalid/api/event",
      enabled: true,
      userAgent: "test/1.0",
      baseProps: {},
      fetchImpl: fn,
    })
    await t.flush()
    expect(calls.length).toBe(0)
  })

  test("event props override base props (per-event customization)", async () => {
    const { fn, calls } = fakeFetch()
    const t = new Transport({
      endpoint: "https://example.invalid/api/event",
      enabled: true,
      userAgent: "test/1.0",
      baseProps: { version: "1.0.0" },
      fetchImpl: fn,
    })
    t.enqueue({ name: "x", url: "u", domain: "d", props: { version: "override" } })
    await t.flush()
    const body = JSON.parse((calls[0]?.init?.body as string) ?? "")
    expect(body.props.version).toBe("override")
  })
})
