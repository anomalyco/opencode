import { describe, expect, test } from "bun:test"
import { retry } from "./retry.js"

describe("client retry", () => {
  test("retries transient failures up to the configured attempt count", async () => {
    const failures: string[] = []
    const value = await retry(
      async () => {
        failures.push("attempt")
        if (failures.length < 3) throw new Error("Failed to fetch")
        return "ready"
      },
      { delay: 0 },
    )

    expect(value).toBe("ready")
    expect(failures).toHaveLength(3)
  })

  test("does not retry other failures", async () => {
    const failures: string[] = []
    await expect(
      retry(async () => {
        failures.push("attempt")
        throw new Error("invalid response")
      }),
    ).rejects.toThrow("invalid response")
    expect(failures).toHaveLength(1)
  })

  test("uses a caller-owned retry condition", async () => {
    const failures: string[] = []
    await expect(
      retry(
        async () => {
          failures.push("attempt")
          throw new Error("retry me")
        },
        { attempts: 2, delay: 0, retryIf: () => true },
      ),
    ).rejects.toThrow("retry me")
    expect(failures).toHaveLength(2)
  })
})
