import { describe, expect, test } from "bun:test"
import {
  AllCandidatesFailedError,
  candidatesFromKeys,
  isRetryable,
  maskSecret,
  runWithFailover,
} from "@/vantacode/failover"

describe("maskSecret", () => {
  test("masks short secrets entirely", () => {
    expect(maskSecret("short")).toBe("****")
    expect(maskSecret("12345678")).toBe("****")
  })
  test("shows first and last 4 for long secrets", () => {
    expect(maskSecret("sk-abcdefghijklmnop")).toBe("sk-a...mnop")
  })
  test("returns undefined for empty", () => {
    expect(maskSecret(undefined)).toBeUndefined()
  })
})

describe("isRetryable", () => {
  test("429 / 5xx / 401 / 403 are retryable", () => {
    expect(isRetryable({ status: 429 }).retryable).toBe(true)
    expect(isRetryable({ status: 500 }).retryable).toBe(true)
    expect(isRetryable({ status: 401 }).retryable).toBe(true)
    expect(isRetryable({ status: 403 }).retryable).toBe(true)
  })
  test("other 4xx are fatal", () => {
    expect(isRetryable({ status: 400 }).retryable).toBe(false)
    expect(isRetryable({ status: 404 }).retryable).toBe(false)
    expect(isRetryable({ status: 422 }).retryable).toBe(false)
  })
  test("quota / network strings are retryable", () => {
    expect(isRetryable(new Error("insufficient_quota")).retryable).toBe(true)
    expect(isRetryable(new Error("fetch failed")).retryable).toBe(true)
  })
})

const identityCtx = (key: string) => key

describe("candidatesFromKeys", () => {
  test("expands provider->keys preserving order with 1-based ids", () => {
    const candidates = candidatesFromKeys([{ provider: "openai", keys: ["a", "b"], context: identityCtx }])
    expect(candidates.map((c) => c.id)).toEqual(["openai#1", "openai#2"])
    expect(candidates.map((c) => c.secret)).toEqual(["a", "b"])
  })
})

describe("runWithFailover", () => {
  const noSleep = () => Promise.resolve()

  test("returns first success without touching later candidates", async () => {
    const seen: string[] = []
    const candidates = candidatesFromKeys([{ provider: "openai", keys: ["k1", "k2"], context: identityCtx }])
    const { result } = await runWithFailover(
      candidates,
      async (c) => {
        seen.push(c.id)
        return "ok"
      },
      { sleep: noSleep },
    )
    expect(result).toBe("ok")
    expect(seen).toEqual(["openai#1"])
  })

  test("advances to next candidate on retryable failure", async () => {
    const seen: string[] = []
    const candidates = candidatesFromKeys([{ provider: "openai", keys: ["bad", "good"], context: identityCtx }])
    const { result } = await runWithFailover(
      candidates,
      async (c) => {
        seen.push(c.secret ?? "")
        if (c.secret === "bad") throw { status: 429, message: "rate limit" }
        return "recovered"
      },
      { sleep: noSleep },
    )
    expect(result).toBe("recovered")
    expect(seen).toEqual(["bad", "good"])
  })

  test("fails over across providers", async () => {
    const candidates = candidatesFromKeys([
      { provider: "openai", keys: ["x"], context: identityCtx },
      { provider: "anthropic", keys: ["y"], context: identityCtx },
    ])
    const { candidate } = await runWithFailover(
      candidates,
      async (c) => {
        if (c.provider === "openai") throw { status: 503, message: "overloaded" }
        return "anthropic-served"
      },
      { sleep: noSleep },
    )
    expect(candidate.provider).toBe("anthropic")
  })

  test("stops immediately on a fatal error", async () => {
    let calls = 0
    const candidates = candidatesFromKeys([{ provider: "openai", keys: ["k1", "k2"], context: identityCtx }])
    await expect(
      runWithFailover(
        candidates,
        async () => {
          calls++
          throw { status: 400, message: "bad request" }
        },
        { sleep: noSleep },
      ),
    ).rejects.toBeTruthy()
    expect(calls).toBe(1)
  })

  test("throws AllCandidatesFailedError when everything is retryable-failed", async () => {
    const candidates = candidatesFromKeys([{ provider: "openai", keys: ["k1", "k2"], context: identityCtx }])
    let err: unknown
    try {
      await runWithFailover(
        candidates,
        async () => {
          throw { status: 503, message: "overloaded" }
        },
        { sleep: noSleep },
      )
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(AllCandidatesFailedError)
    expect((err as AllCandidatesFailedError).attempts.length).toBe(2)
  })
})
