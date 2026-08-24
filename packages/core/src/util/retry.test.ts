import { describe, expect, test } from "bun:test"
import { retry } from "./retry"

describe("retry", () => {
  test("retries on network TypeError when opted in and eventually succeeds", async () => {
    let count = 0
    const result = await retry(
      async () => {
        count += 1
        if (count < 3) throw new TypeError("Failed to fetch")
        return "ok"
      },
      { attempts: 3, delay: 1, factor: 1, retryOnTypeError: true },
    )
    expect(result).toBe("ok")
    expect(count).toBe(3)
  })

  test("retries on a localized/unknown TypeError message when opted in", async () => {
    let count = 0
    const result = await retry(
      async () => {
        count += 1
        if (count < 2) throw new TypeError("ネットワークエラー")
        return "ok"
      },
      { attempts: 3, delay: 1, factor: 1, retryOnTypeError: true },
    )
    expect(result).toBe("ok")
    expect(count).toBe(2)
  })

  test("does not retry a programming TypeError by default", async () => {
    // A bare `TypeError` is only treated as transient for callers that opted in;
    // by default it fails fast so a bug in the callback surfaces immediately.
    let count = 0
    const error = await retry(
      async () => {
        count += 1
        throw new TypeError("x.foo is not a function")
      },
      { attempts: 3, delay: 1, factor: 1 },
    ).catch((e) => e)
    expect(count).toBe(1)
    expect(error).toBeInstanceOf(TypeError)
  })

  test("still retries message-matched transient errors without opting in", async () => {
    let count = 0
    const result = await retry(
      async () => {
        count += 1
        if (count < 3) throw new Error("connect ECONNREFUSED 127.0.0.1:4096")
        return "ok"
      },
      { attempts: 3, delay: 1, factor: 1 },
    )
    expect(result).toBe("ok")
    expect(count).toBe(3)
  })

  test("gives up after exhausting attempts", async () => {
    let count = 0
    const error = await retry(
      async () => {
        count += 1
        throw new TypeError("NetworkError")
      },
      { attempts: 2, delay: 1, factor: 1, retryOnTypeError: true },
    ).catch((e) => e)
    expect(count).toBe(2)
    expect(error).toBeInstanceOf(TypeError)
  })

  test("honors a custom retryIf over the default rules", async () => {
    let count = 0
    const result = await retry(
      async () => {
        count += 1
        if (count < 2) throw new TypeError("anything")
        return "ok"
      },
      { attempts: 3, delay: 1, factor: 1, retryIf: () => true },
    )
    expect(result).toBe("ok")
    expect(count).toBe(2)
  })
})
