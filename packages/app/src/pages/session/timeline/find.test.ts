import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2"
import { TimelineRow } from "./timeline-row"
import { matchRowKeys, rowSearchText } from "./find"

function textPart(id: string, text: string, synthetic = false): Part {
  return {
    id,
    messageID: "msg",
    sessionID: "ses",
    type: "text",
    text,
    synthetic,
  } as Part
}

function reasoningPart(id: string, text: string): Part {
  return {
    id,
    messageID: "msg",
    sessionID: "ses",
    type: "reasoning",
    text,
  } as Part
}

function toolPart(id: string, input?: unknown): Part {
  return {
    id,
    messageID: "msg",
    sessionID: "ses",
    type: "tool",
    tool: "bash",
    state: input === undefined ? { status: "running" } : { status: "completed", input },
  } as Part
}

const partsByMessage = new Map<string, Part[]>()

const getParts = (messageID: string) => partsByMessage.get(messageID) ?? []
const getPart = (messageID: string, partID: string) => getParts(messageID).find((part) => part.id === partID)

function reset(parts: Record<string, Part[]>) {
  partsByMessage.clear()
  for (const [id, list] of Object.entries(parts)) partsByMessage.set(id, list)
}

describe("rowSearchText", () => {
  test("joins non-synthetic user text parts", () => {
    reset({ user1: [textPart("p1", "hello"), textPart("p2", "world", true), textPart("p3", "again")] })
    const row = new TimelineRow.UserMessage({ userMessageID: "user1", anchor: true })
    expect(rowSearchText(row, getParts, getPart)).toBe("hello\nagain")
  })

  test("includes projected message text for user rows", () => {
    reset({ user1: [textPart("p1", "part text")] })
    const row = new TimelineRow.UserMessage({ userMessageID: "user1", anchor: true })
    const getUserText = (id: string) => (id === "user1" ? "projected prompt" : undefined)
    expect(rowSearchText(row, getParts, getPart, getUserText)).toBe("projected prompt\npart text")
    reset({})
    expect(rowSearchText(row, getParts, getPart, getUserText)).toBe("projected prompt")
  })

  test("reads text and reasoning for single-part assistant groups", () => {
    reset({ asst1: [textPart("p1", "answer"), reasoningPart("p2", "thinking")] })
    const text = new TimelineRow.AssistantPart({
      userMessageID: "user1",
      group: { type: "part", key: "part:asst1:p1", ref: { messageID: "asst1", partID: "p1" } },
      previousAssistantPart: false,
    })
    expect(rowSearchText(text, getParts, getPart)).toBe("answer")
    const reasoning = new TimelineRow.AssistantPart({
      userMessageID: "user1",
      group: { type: "part", key: "part:asst1:p2", ref: { messageID: "asst1", partID: "p2" } },
      previousAssistantPart: true,
    })
    expect(rowSearchText(reasoning, getParts, getPart)).toBe("thinking")
  })

  test("skips tool groups and tool parts without input", () => {
    reset({ asst1: [toolPart("p1")] })
    const tool = new TimelineRow.AssistantPart({
      userMessageID: "user1",
      group: { type: "part", key: "part:asst1:p1", ref: { messageID: "asst1", partID: "p1" } },
      previousAssistantPart: false,
    })
    expect(rowSearchText(tool, getParts, getPart)).toBe("")
    const context = new TimelineRow.AssistantPart({
      userMessageID: "user1",
      group: { type: "context", key: "context:p1", refs: [{ messageID: "asst1", partID: "p1" }] },
      previousAssistantPart: false,
    })
    expect(rowSearchText(context, getParts, getPart)).toBe("")
  })

  test("searches tool input values", () => {
    reset({ asst1: [toolPart("p1", { command: "echo findmarker", timeout: 30 })] })
    const tool = new TimelineRow.AssistantPart({
      userMessageID: "user1",
      group: { type: "part", key: "part:asst1:p1", ref: { messageID: "asst1", partID: "p1" } },
      previousAssistantPart: false,
    })
    expect(rowSearchText(tool, getParts, getPart)).toBe("echo findmarker")
  })

  test("uses error row text and ignores structural rows", () => {
    const error = new TimelineRow.Error({ userMessageID: "user1", text: "boom" })
    expect(rowSearchText(error, getParts, getPart)).toBe("boom")
    const gap = new TimelineRow.TurnGap({ userMessageID: "user1" })
    expect(rowSearchText(gap, getParts, getPart)).toBe("")
  })
})

describe("matchRowKeys", () => {
  test("matches rows case-insensitively in timeline order", () => {
    reset({
      user1: [textPart("p1", "Deploy the App")],
      asst1: [textPart("p2", "done")],
      user2: [textPart("p3", "another app mention")],
    })
    const rows = [
      new TimelineRow.UserMessage({ userMessageID: "user1", anchor: true }),
      new TimelineRow.AssistantPart({
        userMessageID: "user1",
        group: { type: "part", key: "part:asst1:p2", ref: { messageID: "asst1", partID: "p2" } },
        previousAssistantPart: false,
      }),
      new TimelineRow.UserMessage({ userMessageID: "user2", anchor: true }),
    ]
    expect(matchRowKeys(rows, "app", getParts, getPart)).toEqual(["user-message:user1", "user-message:user2"])
  })

  test("returns empty for blank or unmatched queries", () => {
    reset({ user1: [textPart("p1", "hello")] })
    const rows = [new TimelineRow.UserMessage({ userMessageID: "user1", anchor: true })]
    expect(matchRowKeys(rows, "   ", getParts, getPart)).toEqual([])
    expect(matchRowKeys(rows, "zzz", getParts, getPart)).toEqual([])
  })
})
