import { describe, expect, test } from "bun:test"
import { isTransientNetworkError, retry } from "@opencode-ai/core/util/retry"

describe("util.retry", () => {
  test("recognizes transient Electron network errors", () => {
    expect(isTransientNetworkError(new Error("net::ERR_NETWORK_CHANGED"))).toBe(true)
    expect(isTransientNetworkError(new Error("net::ERR_NETWORK_IO_SUSPENDED"))).toBe(true)
  })

  test("rejects non-transient errors", () => {
    expect(isTransientNetworkError(new Error("Unauthorized"))).toBe(false)
  })

  test("stops after attempts are exhausted", async () => {
    let calls = 0

    await expect(
      retry(
        async () => {
          calls++
          throw new TypeError("Failed to fetch")
        },
        { attempts: 2, delay: 1 },
      ),
    ).rejects.toThrow("Failed to fetch")

    expect(calls).toBe(2)
  })
})
