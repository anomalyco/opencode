import { describe, expect, test } from "bun:test"
import type { ServerConnection } from "@/runtime/server/registry"
import { checkServerHealth } from "./health"

const server: ServerConnection.HttpBase = {
  url: "http://localhost:4096",
}

const info = (version = "1.2.3") =>
  Response.json({ version, pid: 1, urls: [server.url], paths: { tmp: "/tmp/opencode" } })

// SAFETY: `checkServerHealth` only calls `fetch(input, init)`, which these fakes implement; none reads `preconnect`.
const fakeFetch = (handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) =>
  handler as typeof globalThis.fetch

// Puts back the `AbortSignal.timeout` a test replaced, or removes the stand-in when the runtime had none.
function restoreTimeout(descriptor: PropertyDescriptor | undefined) {
  if (descriptor) return void Object.defineProperty(AbortSignal, "timeout", descriptor)

  const signal: Partial<typeof AbortSignal> = AbortSignal
  delete signal.timeout
}

function abortFromInput(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.signal) return init.signal

  if (input instanceof Request) return input.signal

  return undefined
}

describe("checkServerHealth", () => {
  test.each([undefined, "secret"])("reads /api/info authenticating with only the password (%s)", async (password) => {
    const requests: { path: string; authorization: string | null }[] = []

    const fetch = fakeFetch(async (input, init) => {
      const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input)
      requests.push({ path: url.pathname, authorization: new Headers(init?.headers).get("authorization") })

      return info("2.0.0")
    })

    expect(await checkServerHealth({ ...server, password }, fetch)).toEqual({ type: "healthy", version: "2.0.0" })
    expect(requests).toEqual([
      { path: "/api/info", authorization: password ? `Basic ${btoa(`opencode:${password}`)}` : null },
    ])
  })

  test("reports rejected credentials without retrying", async () => {
    let calls = 0

    const fetch = fakeFetch(async () => {
      calls++

      return new Response(`{"_tag":"UnauthorizedError","message":"Authentication required"}`, {
        status: 401,
        headers: { "content-type": "application/json" },
      })
    })

    expect(await checkServerHealth(server, fetch)).toEqual({ type: "unauthorized" })
    expect(calls).toBe(1)
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

    const fetch = fakeFetch(async () => info())

    await checkServerHealth(server, fetch).finally(() => restoreTimeout(timeout))

    expect(timeoutMs).toBe(30_000)
  })

  test("uses timeout fallback when AbortSignal.timeout is unavailable", async () => {
    const timeout = Object.getOwnPropertyDescriptor(AbortSignal, "timeout")
    Object.defineProperty(AbortSignal, "timeout", {
      configurable: true,
      value: undefined,
    })

    let aborted = false

    const fetch = fakeFetch(
      (input, init) =>
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
        }),
    )

    const result = await checkServerHealth(server, fetch, {
      timeoutMs: 10,
    }).finally(() => restoreTimeout(timeout))

    expect(aborted).toBe(true)
    expect(result).toEqual({ type: "unreachable" })
  })

  test("uses provided abort signal", async () => {
    let signal: AbortSignal | undefined

    const fetch = fakeFetch(async (input, init) => {
      signal = abortFromInput(input, init)

      return info()
    })

    const abort = new AbortController()
    await checkServerHealth(server, fetch, {
      signal: abort.signal,
    })

    expect(signal).toBe(abort.signal)
  })

  test("retries transient failures and eventually succeeds", async () => {
    let count = 0

    const fetch = fakeFetch(async () => {
      count += 1

      if (count < 3) throw new TypeError("network")

      return info()
    })

    const result = await checkServerHealth(server, fetch, {
      retryCount: 2,
      retryDelayMs: 1,
    })

    expect(count).toBe(3)
    expect(result).toEqual({ type: "healthy", version: "1.2.3" })
  })

  test("returns unreachable when retries are exhausted", async () => {
    let count = 0

    const fetch = fakeFetch(async () => {
      count += 1
      throw new TypeError("network")
    })

    const result = await checkServerHealth(server, fetch, {
      retryCount: 2,
      retryDelayMs: 1,
    })

    expect(count).toBe(3)
    expect(result).toEqual({ type: "unreachable" })
  })
})
