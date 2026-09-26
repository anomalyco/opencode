import { describe, expect, test } from "bun:test"
import { Agent } from "undici"
import { resolveTimeoutMs, createUndiciDispatcher } from "@opencode-ai/core/util/undici-dispatcher"

describe("resolveTimeoutMs", () => {
  test("false → 0 (disabled)", () => {
    expect(resolveTimeoutMs(false)).toBe(0)
  })

  test("positive number → that value in ms", () => {
    expect(resolveTimeoutMs(600_000)).toBe(600_000)
  })

  test("undefined → undefined (undici defaults apply)", () => {
    expect(resolveTimeoutMs(undefined)).toBeUndefined()
  })

  test("0 → undefined (not a positive number)", () => {
    expect(resolveTimeoutMs(0)).toBeUndefined()
  })

  test("negative number → undefined", () => {
    expect(resolveTimeoutMs(-1)).toBeUndefined()
  })

  test("null → undefined", () => {
    expect(resolveTimeoutMs(null)).toBeUndefined()
  })

  test("string → undefined", () => {
    expect(resolveTimeoutMs("300000")).toBeUndefined()
  })
})

describe("createUndiciDispatcher", () => {
  test("Bun guard: returns undefined when process.versions.bun is set", () => {
    const original = (process.versions as Record<string, string | undefined>).bun
    ;(process.versions as Record<string, string | undefined>).bun = "1.0.0"
    try {
      expect(createUndiciDispatcher(600_000)).toBeUndefined()
      expect(createUndiciDispatcher(false)).toBeUndefined()
    } finally {
      if (original === undefined) delete (process.versions as Record<string, string | undefined>).bun
      else (process.versions as Record<string, string | undefined>).bun = original
    }
  })

  test("returns undefined when no bun version and timeout resolves to undefined", () => {
    const original = (process.versions as Record<string, string | undefined>).bun
    ;(process.versions as Record<string, string | undefined>).bun = undefined
    try {
      expect(createUndiciDispatcher(undefined)).toBeUndefined()
      expect(createUndiciDispatcher(0)).toBeUndefined()
    } finally {
      if (original === undefined) delete (process.versions as Record<string, string | undefined>).bun
      else (process.versions as Record<string, string | undefined>).bun = original
    }
  })

  // Under Bun, createUndiciDispatcher always returns undefined because of the
  // guard. The Agent construction path only runs under Node. We verify it
  // returns an Agent instance (not private fields) when the bun guard is
  // removed and a valid timeout is provided.
  test("returns an Agent instance under Node (bun guard bypassed)", () => {
    const original = (process.versions as Record<string, string | undefined>).bun
    ;(process.versions as Record<string, string | undefined>).bun = undefined
    try {
      const agent = createUndiciDispatcher(600_000)
      expect(agent).toBeInstanceOf(Agent)
    } finally {
      if (original === undefined) delete (process.versions as Record<string, string | undefined>).bun
      else (process.versions as Record<string, string | undefined>).bun = original
    }
  })
})
