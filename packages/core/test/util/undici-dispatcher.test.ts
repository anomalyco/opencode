import { describe, expect, test } from "bun:test"
import { createUndiciDispatcher } from "@opencode-ai/core/util/undici-dispatcher"

describe("createUndiciDispatcher", () => {
  test("positive number returns an Agent with matching headersTimeout and bodyTimeout", () => {
    const agent = createUndiciDispatcher(600_000) as InstanceType<typeof import("undici").Agent> | undefined
    if (!agent) return // Bun — dispatcher is always undefined
    expect((agent as unknown as { headersTimeout: number }).headersTimeout).toBe(600_000)
    expect((agent as unknown as { bodyTimeout: number }).bodyTimeout).toBe(600_000)
  })

  test("false returns an Agent with headersTimeout and bodyTimeout set to 0", () => {
    const agent = createUndiciDispatcher(false) as InstanceType<typeof import("undici").Agent> | undefined
    if (!agent) return // Bun
    expect((agent as unknown as { headersTimeout: number }).headersTimeout).toBe(0)
    expect((agent as unknown as { bodyTimeout: number }).bodyTimeout).toBe(0)
  })

  test("undefined returns undefined (undici defaults apply)", () => {
    expect(createUndiciDispatcher(undefined)).toBeUndefined()
  })

  test("0 returns undefined (not a positive number)", () => {
    expect(createUndiciDispatcher(0)).toBeUndefined()
  })

  test("negative number returns undefined", () => {
    expect(createUndiciDispatcher(-1)).toBeUndefined()
  })

  test("null returns undefined", () => {
    expect(createUndiciDispatcher(null)).toBeUndefined()
  })

  test("string returns undefined", () => {
    expect(createUndiciDispatcher("300000")).toBeUndefined()
  })

  test("Bun guard: returns undefined when process.versions.bun is set", () => {
    const original = (process.versions as Record<string, string | undefined>).bun
    ;(process.versions as Record<string, string | undefined>).bun = "1.0.0"
    try {
      expect(createUndiciDispatcher(600_000)).toBeUndefined()
    } finally {
      if (original === undefined) delete (process.versions as Record<string, string | undefined>).bun
      else (process.versions as Record<string, string | undefined>).bun = original
    }
  })
})
