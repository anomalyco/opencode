import { describe, expect, test } from "bun:test"
import { retry } from "./retry"

describe("retry", () => {
  test("retries on network TypeError and eventually succeeds", async () => {
    let count = 0
    const result = await retry(
      async () => {
        count += 1
        if (count < 3) throw new TypeError("Failed to fetch")
        return "ok"
      },
      { attempts: 3, delay: 1, factor: 1 },
    )
    expect(result).toBe("ok")
    expect(count).toBe(3)
  })

  test("retries on a localized/unknown TypeError message", async () => {
    let count = 0
    const result = await retry(
      async () => {
        count += 1
        if (count < 2) throw new TypeError("ネットワークエラー")
        return "ok"
      },
      { attempts: 3, delay: 1, factor: 1 },
    )
    expect(result).toBe("ok")
    expect(count).toBe(2)
  })

  test("gives up after exhausting attempts", async () => {
    let count = 0
    const error = await retry(
      async () => {
        count += 1
        throw new TypeError("NetworkError")
      },
      { attempts: 2, delay: 1, factor: 1 },
    ).catch((e) => e)
    expect(count).toBe(2)
    expect(error).toBeInstanceOf(TypeError)
  })
})
