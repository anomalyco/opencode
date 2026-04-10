import { describe, expect, test } from "bun:test"
import { DEFAULT_CONTEXT_LIMIT, DEFAULT_OUTPUT_LIMIT } from "../../src/provider/constants"

describe("provider constants", () => {
  test("DEFAULT_CONTEXT_LIMIT should be a positive number", () => {
    expect(DEFAULT_CONTEXT_LIMIT).toBeGreaterThan(0)
    expect(Number.isFinite(DEFAULT_CONTEXT_LIMIT)).toBe(true)
  })

  test("DEFAULT_OUTPUT_LIMIT should be a positive number", () => {
    expect(DEFAULT_OUTPUT_LIMIT).toBeGreaterThan(0)
    expect(Number.isFinite(DEFAULT_OUTPUT_LIMIT)).toBe(true)
  })

  test("DEFAULT_CONTEXT_LIMIT should be greater than DEFAULT_OUTPUT_LIMIT", () => {
    expect(DEFAULT_CONTEXT_LIMIT).toBeGreaterThan(DEFAULT_OUTPUT_LIMIT)
  })

  test("DEFAULT_CONTEXT_LIMIT should be 128000", () => {
    expect(DEFAULT_CONTEXT_LIMIT).toBe(128_000)
  })

  test("DEFAULT_OUTPUT_LIMIT should be 8192", () => {
    expect(DEFAULT_OUTPUT_LIMIT).toBe(8192)
  })
})
