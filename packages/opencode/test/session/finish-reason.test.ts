import { describe, expect, test } from "bun:test"
import { isTerminalFinishReason } from "../../src/session/prompt"

describe("isTerminalFinishReason", () => {
  test("tool-calls is non-terminal", () => {
    expect(isTerminalFinishReason("tool-calls")).toBe(false)
  })

  test("stop is terminal", () => {
    expect(isTerminalFinishReason("stop")).toBe(true)
  })

  test("length is terminal", () => {
    expect(isTerminalFinishReason("length")).toBe(true)
  })

  test("content-filter is terminal", () => {
    expect(isTerminalFinishReason("content-filter")).toBe(true)
  })

  test("error is terminal", () => {
    expect(isTerminalFinishReason("error")).toBe(true)
  })

  test("other is terminal", () => {
    expect(isTerminalFinishReason("other")).toBe(true)
  })

  test("unknown is terminal (non-standard providers like GLM-5 Turbo)", () => {
    expect(isTerminalFinishReason("unknown")).toBe(true)
  })

  test("end_turn is terminal (Anthropic)", () => {
    expect(isTerminalFinishReason("end_turn")).toBe(true)
  })

  test("empty string is terminal (defensive)", () => {
    expect(isTerminalFinishReason("")).toBe(true)
  })
})
