import { describe, expect, test } from "bun:test"
import { continuationPrompt } from "@/loop/continuation"

const BASE = "keep working through the task list"

describe("continuationPrompt", () => {
  test("first iteration returns the base prompt unchanged", () => {
    expect(continuationPrompt(BASE, undefined)).toBe(BASE)
  })

  test("normal progress returns the base prompt unchanged", () => {
    expect(continuationPrompt(BASE, { toolCalls: 4, outputLength: 900, wasNearIdentical: false })).toBe(BASE)
  })

  test("stall (no tools, short output) prepends the execute directive", () => {
    const out = continuationPrompt(BASE, { toolCalls: 0, outputLength: 20, wasNearIdentical: false })
    expect(out).toContain("used no tools")
    expect(out).toContain(BASE)
    expect(out.endsWith(BASE)).toBe(true)
  })

  test("empty output prepends the empty-response directive", () => {
    const out = continuationPrompt(BASE, { toolCalls: 0, outputLength: 0, wasNearIdentical: false })
    expect(out).toContain("previous response was empty")
    expect(out).toContain(BASE)
  })

  test("spinning (tools but near-identical output) prepends the reassess directive", () => {
    const out = continuationPrompt(BASE, { toolCalls: 3, outputLength: 500, wasNearIdentical: true })
    expect(out).toContain("repeating the same actions")
    expect(out).toContain(BASE)
  })

  test("a substantive no-tool answer is not treated as a stall", () => {
    expect(continuationPrompt(BASE, { toolCalls: 0, outputLength: 400, wasNearIdentical: false })).toBe(BASE)
  })
})
