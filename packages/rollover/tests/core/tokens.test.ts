import { describe, expect, test } from "bun:test"
import { estimateTokens, estimateMessageTokens } from "../../src/core/tokens"
import type { NMessage } from "../../src/core/types"

describe("estimateTokens", () => {
  test("empty string is 0", () => {
    expect(estimateTokens("")).toBe(0)
  })

  test("plain ascii divides by 4, ceil", () => {
    expect(estimateTokens("abcd")).toBe(1)
    expect(estimateTokens("abcde")).toBe(2)
  })

  test("turkish characters count by code unit like any other", () => {
    // "şğüı ç" is 6 code units (space included) → ceil(6/4) = 2
    expect(estimateTokens("şğüı ç")).toBe(2)
  })

  test("long string", () => {
    expect(estimateTokens("x".repeat(4000))).toBe(1000)
  })

  test("single char", () => {
    expect(estimateTokens("ş")).toBe(1)
  })

  test("json serialization path uses the same estimator", () => {
    const input = { path: "app/services/pricing.py", edit: "single_line" }
    expect(estimateTokens(JSON.stringify(input))).toBe(Math.ceil(JSON.stringify(input).length / 4))
  })
})

describe("estimateMessageTokens", () => {
  const msg = (over: Partial<NMessage>): NMessage => ({
    id: "m1",
    role: "user",
    parts: [],
    createdAt: 0,
    ...over,
  })

  test("empty message is 0", () => {
    expect(estimateMessageTokens(msg({}))).toBe(0)
  })

  test("counts text parts", () => {
    const m = msg({ parts: [{ type: "text", text: "abcd" }, { type: "text", text: "ef" }] })
    expect(estimateMessageTokens(m)).toBe(2)
  })

  test("counts tool input json and output", () => {
    const m = msg({
      role: "assistant",
      parts: [{ type: "tool", tool: "edit", input: { path: "a.ts" }, output: "done" }],
    })
    const expected = Math.ceil((JSON.stringify({ path: "a.ts" }).length + "done".length) / 4)
    expect(estimateMessageTokens(m)).toBe(expected)
  })

  test("other parts contribute nothing", () => {
    const m = msg({ parts: [{ type: "other" }] })
    expect(estimateMessageTokens(m)).toBe(0)
  })

  test("consistent with estimateTokens", () => {
    const m = msg({ parts: [{ type: "text", text: "şğüı ç şğüı ç" }] })
    expect(estimateMessageTokens(m)).toBe(estimateTokens("şğüı ç şğüı ç"))
  })
})
