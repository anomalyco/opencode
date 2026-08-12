import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message } from "@opencode-ai/sdk/v2"
import { assistantContextTokens, isDefaultTitle, latestAssistantContextMessage } from "../../src/util/session"

describe("util.session", () => {
  test("recognizes generated parent and child titles", () => {
    expect(isDefaultTitle("New session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("Child session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("New session - custom")).toBeFalse()
  })

  test("uses provider total for assistant context when available", () => {
    const message = {
      tokens: {
        total: 34_452,
        input: 30_000,
        output: 4_000,
        reasoning: 452,
        cache: {
          read: 32_000,
          write: 700,
        },
      },
    } as AssistantMessage

    expect(assistantContextTokens(message)).toBe(34_452)
  })

  test("sums assistant tokens when provider total is unavailable", () => {
    const message = {
      tokens: {
        input: 30_000,
        output: 4_000,
        reasoning: 452,
        cache: {
          read: 32_000,
          write: 700,
        },
      },
    } as AssistantMessage

    expect(assistantContextTokens(message)).toBe(67_152)
  })

  test("prefers previous reported usage over a later interrupt estimate", () => {
    const completed = {
      id: "completed",
      role: "assistant",
      tokens: {
        total: 143_725,
        input: 143_000,
        output: 725,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    } as AssistantMessage
    const estimated = {
      id: "estimated",
      role: "assistant",
      error: { name: "MessageAbortedError" },
      tokens: {
        input: 13_000,
        output: 278,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    } as AssistantMessage

    expect(latestAssistantContextMessage([completed, estimated] as Message[])?.id).toBe("completed")
  })

  test("follows a later smaller reported usage (provider compacted its context)", () => {
    const beforeCompaction = {
      id: "before",
      role: "assistant",
      tokens: {
        total: 156_044,
        input: 106,
        output: 8_740,
        reasoning: 0,
        cache: { read: 124_001, write: 22_516 },
      },
    } as AssistantMessage
    const afterCompaction = {
      id: "after",
      role: "assistant",
      tokens: {
        total: 29_240,
        input: 10,
        output: 450,
        reasoning: 0,
        cache: { read: 21_158, write: 7_622 },
      },
    } as AssistantMessage

    expect(latestAssistantContextMessage([beforeCompaction, afterCompaction] as Message[])?.id).toBe("after")
  })

  test("follows a reported total on an aborted turn", () => {
    const completed = {
      id: "completed",
      role: "assistant",
      tokens: {
        total: 143_725,
        input: 143_000,
        output: 725,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    } as AssistantMessage
    const aborted = {
      id: "aborted",
      role: "assistant",
      error: { name: "MessageAbortedError" },
      tokens: {
        total: 13_278,
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    } as AssistantMessage

    expect(latestAssistantContextMessage([completed, aborted] as Message[])?.id).toBe("aborted")
  })

  test("uses an interrupt estimate when no reported assistant usage exists", () => {
    const estimated = {
      id: "estimated",
      role: "assistant",
      error: { name: "MessageAbortedError" },
      tokens: {
        input: 13_000,
        output: 278,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    } as AssistantMessage

    expect(latestAssistantContextMessage([estimated] as Message[])?.id).toBe("estimated")
  })
})
