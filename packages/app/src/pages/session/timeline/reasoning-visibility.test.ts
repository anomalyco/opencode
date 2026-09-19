import { describe, expect, mock, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import { normalizeSessionMessages } from "@/utils/session-message"

// The real module pulls in a Vite worker import (markdown.worker.ts?worker&url)
// that cannot resolve outside a bundler. These stubs mirror the actual exported
// renderable() and groupParts() logic for the part types exercised in these tests.
mock.module("@opencode-ai/session-ui/message-part", () => ({
  renderable: (part: { type: string; text?: string; tool?: string; state?: { status?: string } }, showReasoning?: boolean) => {
    if (part.type === "tool") {
      if (part.tool === "question") return part.state?.status !== "pending" && part.state?.status !== "running"
      return true
    }
    if (part.type === "text") return !!part.text?.trim()
    if (part.type === "reasoning") return (showReasoning ?? true) && !!part.text?.trim()
    return false
  },
  groupParts: (refs: Array<{ messageID: string; part: { id: string } }>) =>
    refs.map((ref) => ({
      type: "part" as const,
      key: ref.part.id,
      ref: { messageID: ref.messageID, partID: ref.part.id },
    })),
}))

const { Timeline, TimelineRow } = await import("./rows")

describe("reasoning visibility in timeline rows", () => {
  test("hides reasoning parts when showReasoningSummaries is false", () => {
    const source = [
      { id: "msg_1", type: "user", text: "first", time: { created: 1 } },
      {
        id: "msg_2",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "reasoning", text: "thinking process" }],
        time: { created: 2, completed: 3 },
      },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const messages = new Map(normalized.messages.map((message) => [message.id, message]))

    const result = Timeline.constructSessionMessageRows(
      source,
      (messageID) => messages.get(messageID),
      (messageID) => normalized.parts.get(messageID) ?? [],
      false,
      "idle",
      true,
      normalized.messages.filter((message) => message.role === "user"),
    )

    expect(result.rows.map(TimelineRow.key)).toEqual(["user-message:msg_1"])
  })

  test("shows reasoning parts when showReasoningSummaries is true", () => {
    const source = [
      { id: "msg_1", type: "user", text: "first", time: { created: 1 } },
      {
        id: "msg_2",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "reasoning", text: "let me think about this" }],
        time: { created: 2, completed: 3 },
      },
      {
        id: "msg_3",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "answer" }],
        time: { created: 4, completed: 5 },
      },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const messages = new Map(normalized.messages.map((message) => [message.id, message]))

    const result = Timeline.constructSessionMessageRows(
      source,
      (messageID) => messages.get(messageID),
      (messageID) => normalized.parts.get(messageID) ?? [],
      true,
      "idle",
      true,
      normalized.messages.filter((message) => message.role === "user"),
    )

    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_1",
      "assistant-part:msg_1:msg_2:reasoning:0",
      "assistant-part:msg_1:msg_3:text:0",
    ])
  })

  test("reasoning parts are shown as AssistantPart rows for toggle rendering", () => {
    const source = [
      { id: "msg_1", type: "user", text: "first", time: { created: 1 } },
      {
        id: "msg_2",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [
          { type: "reasoning", text: "analyzing the problem" },
          { type: "text", text: "solution" },
        ],
        time: { created: 2, completed: 3 },
      },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const messages = new Map(normalized.messages.map((message) => [message.id, message]))

    const result = Timeline.constructSessionMessageRows(
      source,
      (messageID) => messages.get(messageID),
      (messageID) => normalized.parts.get(messageID) ?? [],
      true,
      "idle",
      true,
      normalized.messages.filter((message) => message.role === "user"),
    )

    const reasoningRow = result.rows.find(
      (row): row is InstanceType<typeof TimelineRow.AssistantPart> =>
        row._tag === "AssistantPart" && row.group.type === "part" && row.group.key.includes("reasoning"),
    )
    expect(reasoningRow).toBeDefined()
    expect(reasoningRow!.group.type).toBe("part")
  })

  test("showThinking row appears during busy status with no reasoning parts yet", () => {
    const source = [
      { id: "msg_1", type: "user", text: "first", time: { created: 1 } },
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)

    const result = Timeline.constructSessionMessageRows(
      source,
      () => normalized.messages.find((m) => m.id === "msg_1"),
      () => [],
      true,
      "busy",
      true,
      normalized.messages.filter((message) => message.role === "user"),
    )

    const thinkingRow = result.rows.find((row) => row._tag === "Thinking")
    expect(thinkingRow).toBeDefined()
  })
})
