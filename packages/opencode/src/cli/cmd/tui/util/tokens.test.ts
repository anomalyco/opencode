import { describe, expect, test } from "bun:test"
import {
  MIN_TOKENS_PER_SECOND_ELAPSED_MS,
  totalGeneratedTokens,
  isValidForTokensPerSecond,
  calculateTokensPerSecond,
} from "./tokens"

describe("totalGeneratedTokens", () => {
  test("sums output and reasoning tokens", () => {
    expect(totalGeneratedTokens({ output: 100, reasoning: 50 })).toBe(150)
  })

  test("handles zero tokens", () => {
    expect(totalGeneratedTokens({ output: 0, reasoning: 0 })).toBe(0)
  })
})

describe("isValidForTokensPerSecond", () => {
  const validMessage = {
    finish: "stop",
    tokens: { output: 100, reasoning: 50 },
    time: { firstToken: 1000, completed: 2000 },
  }

  test("returns true for valid message", () => {
    expect(isValidForTokensPerSecond(validMessage)).toBe(true)
  })

  test("returns false for summary messages", () => {
    expect(isValidForTokensPerSecond({ ...validMessage, summary: true })).toBe(false)
  })

  test("returns false for tool-calls finish reason", () => {
    expect(isValidForTokensPerSecond({ ...validMessage, finish: "tool-calls" })).toBe(false)
  })

  test("returns false for unknown finish reason", () => {
    expect(isValidForTokensPerSecond({ ...validMessage, finish: "unknown" })).toBe(false)
  })

  test("returns false for null/undefined finish", () => {
    expect(isValidForTokensPerSecond({ ...validMessage, finish: null })).toBe(false)
    expect(isValidForTokensPerSecond({ ...validMessage, finish: undefined })).toBe(false)
  })

  test("returns false for zero tokens", () => {
    expect(
      isValidForTokensPerSecond({
        ...validMessage,
        tokens: { output: 0, reasoning: 0 },
      }),
    ).toBe(false)
  })

  test("returns false for missing timestamps", () => {
    expect(
      isValidForTokensPerSecond({
        ...validMessage,
        time: { firstToken: undefined, completed: 2000 },
      }),
    ).toBe(false)
    expect(
      isValidForTokensPerSecond({
        ...validMessage,
        time: { firstToken: 1000, completed: undefined },
      }),
    ).toBe(false)
  })

  test("returns false for elapsed time below threshold", () => {
    expect(
      isValidForTokensPerSecond({
        ...validMessage,
        time: { firstToken: 1000, completed: 1000 + MIN_TOKENS_PER_SECOND_ELAPSED_MS - 1 },
      }),
    ).toBe(false)
  })

  test("returns true for elapsed time at threshold", () => {
    expect(
      isValidForTokensPerSecond({
        ...validMessage,
        time: { firstToken: 1000, completed: 1000 + MIN_TOKENS_PER_SECOND_ELAPSED_MS },
      }),
    ).toBe(true)
  })
})

describe("calculateTokensPerSecond", () => {
  test("calculates correct rate", () => {
    expect(calculateTokensPerSecond({ totalTokens: 100, elapsedMs: 1000 })).toBe(100)
    expect(calculateTokensPerSecond({ totalTokens: 50, elapsedMs: 500 })).toBe(100)
    expect(calculateTokensPerSecond({ totalTokens: 150, elapsedMs: 1000 })).toBe(150)
  })

  test("rounds to nearest integer", () => {
    expect(calculateTokensPerSecond({ totalTokens: 100, elapsedMs: 333 })).toBe(300)
  })

  test("returns undefined for zero tokens", () => {
    expect(calculateTokensPerSecond({ totalTokens: 0, elapsedMs: 1000 })).toBe(undefined)
  })

  test("returns undefined for elapsed time below default threshold", () => {
    expect(
      calculateTokensPerSecond({
        totalTokens: 100,
        elapsedMs: MIN_TOKENS_PER_SECOND_ELAPSED_MS - 1,
      }),
    ).toBe(undefined)
  })

  test("respects custom minElapsedMs", () => {
    expect(
      calculateTokensPerSecond({
        totalTokens: 100,
        elapsedMs: 100,
        minElapsedMs: 50,
      }),
    ).toBe(1000)
  })

  test("returns undefined for non-finite results", () => {
    expect(calculateTokensPerSecond({ totalTokens: 100, elapsedMs: 0, minElapsedMs: 0 })).toBe(undefined)
  })
})
