import { describe, test, expect } from "bun:test"

describe("GitLab Retry Logic", () => {
  test("retries on failure", async () => {
    const { retryWithBackoff } = require("../../../src/vcs/gitlab/gitlab")

    let attempts = 0
    const fn = async () => {
      attempts++
      if (attempts < 2) throw new Error("Temporary failure")
      return "success"
    }

    const result = await retryWithBackoff(fn, { maxAttempts: 3, baseDelay: 10 })
    expect(result).toBe("success")
    expect(attempts).toBe(2)
  })

  test("gives up after max attempts", async () => {
    const { retryWithBackoff } = require("../../../src/vcs/gitlab/gitlab")

    const fn = async () => {
      throw new Error("Permanent failure")
    }

    await expect(
      retryWithBackoff(fn, { maxAttempts: 2, baseDelay: 10 })
    ).rejects.toThrow("Permanent failure")
  })

  test("succeeds on first try", async () => {
    const { retryWithBackoff } = require("../../../src/vcs/gitlab/gitlab")

    const fn = async () => "immediate success"

    const result = await retryWithBackoff(fn)
    expect(result).toBe("immediate success")
  })
})
