import { describe, expect, test } from "bun:test"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { claudeACPFooter } from "../../src/util/claude-acp"
import { assistantContextTokens, isDefaultTitle, latestAssistantContextMessage } from "../../src/util/session"

const assistant = (tokens: Partial<AssistantMessage["tokens"]> = {}, id = "assistant") => {
  return {
    id,
    role: "assistant",
    tokens: {
      input: 30_000,
      output: 4_000,
      reasoning: 452,
      cache: { read: 32_000, write: 700 },
      ...tokens,
    },
  } as AssistantMessage
}

describe("util.session", () => {
  test("recognizes generated parent and child titles", () => {
    expect(isDefaultTitle("New session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("Child session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("New session - custom")).toBeFalse()
  })

  test("uses provider total for assistant context when available", () => {
    expect(assistantContextTokens(assistant({ total: 34_452 }))).toBe(34_452)
  })

  test("sums assistant tokens when provider total is unavailable", () => {
    expect(assistantContextTokens(assistant())).toBe(67_152)
  })

  test("follows a later smaller reported usage (provider compacted its context)", () => {
    const beforeCompaction = assistant({ total: 156_044 }, "before")
    const afterCompaction = assistant({ total: 29_240, output: 0 }, "after")

    expect(latestAssistantContextMessage([beforeCompaction, afterCompaction])?.id).toBe("after")
  })

  test("shows non-default Claude effort and fast mode", () => {
    expect(claudeACPFooter({ claudeACP: { config: { effort: "high", fast: "on" } } })).toEqual(["high", "fast"])
    expect(claudeACPFooter({ claudeACP: { config: { effort: "default", fast: "off" } } })).toEqual([])
  })
})
