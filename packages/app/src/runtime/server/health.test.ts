import { describe, expect, test } from "bun:test"
import type { ServerConnection } from "@/runtime/server/registry"
import { checkServerHealth } from "./health"

const server: ServerConnection.HttpBase = {
  url: "http://localhost:4096",
}

const info = (version = "1.2.3") =>
  Response.json({ version, pid: 1, urls: [server.url], paths: { tmp: "/tmp/opencode" } })

function abortFromInput(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.signal) return init.signal

  if (input instanceof Request) return input.signal

  return undefined
}

describe("checkServerHealth", () => {
  test.each([undefined, "secret"])("reads /api/info authenticating with only the password (%s)", async (password) => {
    const requests: { path: string; authorization: string | null }[] = []

    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input)
      requests.push({ path: url.pathname, authorization: new Headers(init?.headers).get("authorization") })

      return info("2.0.0")
    }) as typeof globalThis.fetch

    expect(await checkServerHealth({ ...server, password }, fetch)).toEqual({ healthy: true, version: "2.0.0" })
    expect(requests).toEqual([
      { path: "/api/info", authorization: password ? `Basic ${btoa(`opencode:${password}`)}` : null },
    ])
  })

  test("reports rejected credentials without retrying", async () => {
    let calls = 0

    const fetch = (async () => {
      calls++

      return Response.json({ _tag: "UnauthorizedError", message: "Authentication required" }, { status: 401 })
    }) as unknown as typeof globalThis.fetch

    expect(await checkServerHealth(server, fetch)).toEqual({ healthy: false, unauthorized: true })
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

    const fetch = (async () => info()) as unknown as typeof globalThis.fetch

    await checkServerHealth(server, fetch).finally(() => {
      if (timeout) Object.defineProperty(AbortSignal, "timeout", timeout)

      if (!timeout) delete (AbortSignal as Partial<typeof AbortSignal>).timeout
    })

    expect(timeoutMs).toBe(30_000)
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

      if (!timeout) delete (AbortSignal as Partial<typeof AbortSignal>).timeout
    })

    expect(aborted).toBe(true)
    expect(result).toEqual({ healthy: false })
  })

  test("uses provided abort signal", async () => {
    let signal: AbortSignal | undefined

    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      signal = abortFromInput(input, init)

      return info()
    }) as unknown as typeof globalThis.fetch

    const abort = new AbortController()
    await checkServerHealth(server, fetch, {
      signal: abort.signal,
    })

    expect(signal).toBe(abort.signal)
  })

  test("retries transient failures and eventually succeeds", async () => {
    let count = 0

    const fetch = (async () => {
      count += 1

      if (count < 3) throw new TypeError("network")

      return info()
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

    expect(count).toBe(3)
    expect(result).toEqual({ healthy: false })
  })
})
