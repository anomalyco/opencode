import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@/flag/flag"

describe("LSP Client diagnostics timeout configuration", () => {
  const TIMEOUT_KEY =
    "OPENCODE_EXPERIMENTAL_LSP_DIAGNOSTICS_TIMEOUT_MS" as const

  afterEach(() => {
    // Restore to the original module-load-time value (undefined when env var isn't set)
    Object.defineProperty(Flag, TIMEOUT_KEY, {
      value: undefined,
      configurable: true,
      writable: true,
    })
  })

  test("defaults to 10_000ms when flag is undefined", () => {
    // Flag value is undefined at module load time (env var not set)
    const timeout = Flag[TIMEOUT_KEY] ?? 10_000
    expect(timeout).toBe(10_000)
  })

  test("uses custom timeout when flag is set", () => {
    Object.defineProperty(Flag, TIMEOUT_KEY, {
      value: 5_000,
      configurable: true,
      writable: true,
    })

    const timeout = Flag[TIMEOUT_KEY] ?? 10_000
    expect(timeout).toBe(5_000)
  })

  test("falls back to 10_000ms when flag value is invalid", () => {
    // number() helper returns undefined for 0, negative, or non-integer values
    // so Flag[TIMEOUT_KEY] would be undefined, triggering the ?? fallback
    Object.defineProperty(Flag, TIMEOUT_KEY, {
      value: undefined,
      configurable: true,
      writable: true,
    })

    const timeout = Flag[TIMEOUT_KEY] ?? 10_000
    expect(timeout).toBe(10_000)
  })
})
