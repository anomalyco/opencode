import { describe, expect, it } from "bun:test"
import type { Part, Session } from "@opencode-ai/sdk/v2/client"
import { isAutoSpeakable } from "./tts-filter"

function textPart(
  overrides: Partial<{
    text: string
    synthetic: boolean
    ignored: boolean
    time: { start: number; end?: number }
  }>,
): Part {
  return {
    type: "text",
    id: "p1",
    sessionID: "s1",
    messageID: "m1",
    text: "hello world",
    time: { start: 0, end: 1000 },
    synthetic: false,
    ignored: false,
    ...overrides,
  } as unknown as Part
}

function parentSession(): Session {
  return {
    id: "s1",
    slug: "s1",
    projectID: "proj",
    directory: "/",
    title: "test",
    version: "1",
    time: { created: 0, updated: 0 },
  } as Session
}

function subSession(): Session {
  return { ...parentSession(), parentID: "parent-session-id" }
}

describe("isAutoSpeakable", () => {
  it("speaks completed text from parent session with all conditions met", () => {
    const result = isAutoSpeakable(textPart({}), parentSession())
    expect(result.speakable).toBe(true)
    expect(result.reason).toBe("speakable")
  })

  it("filters reasoning parts with reason filtered_type", () => {
    const part = {
      type: "reasoning",
      id: "p1",
      sessionID: "s1",
      messageID: "m1",
      text: "thinking...",
      time: { start: 0, end: 1000 },
    } as unknown as Part
    const result = isAutoSpeakable(part, parentSession())
    expect(result.speakable).toBe(false)
    expect(result.reason).toBe("filtered_type")
  })

  it("filters tool parts with reason filtered_type", () => {
    const part = {
      type: "tool",
      id: "p1",
      sessionID: "s1",
      messageID: "m1",
    } as unknown as Part
    const result = isAutoSpeakable(part, parentSession())
    expect(result.speakable).toBe(false)
    expect(result.reason).toBe("filtered_type")
  })

  it("filters subtask parts with reason filtered_type", () => {
    const part = {
      type: "subtask",
      id: "p1",
      sessionID: "s1",
      messageID: "m1",
    } as unknown as Part
    const result = isAutoSpeakable(part, parentSession())
    expect(result.speakable).toBe(false)
    expect(result.reason).toBe("filtered_type")
  })

  it("filters synthetic text parts with reason filtered_synthetic", () => {
    const result = isAutoSpeakable(textPart({ synthetic: true }), parentSession())
    expect(result.speakable).toBe(false)
    expect(result.reason).toBe("filtered_synthetic")
  })

  it("filters ignored text parts with reason filtered_ignored", () => {
    const result = isAutoSpeakable(textPart({ ignored: true }), parentSession())
    expect(result.speakable).toBe(false)
    expect(result.reason).toBe("filtered_ignored")
  })

  it("filters incomplete parts (no time.end) with reason filtered_incomplete", () => {
    const result = isAutoSpeakable(textPart({ time: { start: 0 } }), parentSession())
    expect(result.speakable).toBe(false)
    expect(result.reason).toBe("filtered_incomplete")
  })

  it("filters empty text parts with reason filtered_empty", () => {
    const result = isAutoSpeakable(textPart({ text: "" }), parentSession())
    expect(result.speakable).toBe(false)
    expect(result.reason).toBe("filtered_empty")
  })

  it("filters whitespace-only text with reason filtered_empty", () => {
    const result = isAutoSpeakable(textPart({ text: "   " }), parentSession())
    expect(result.speakable).toBe(false)
    expect(result.reason).toBe("filtered_empty")
  })

  it("filters when session is undefined with reason filtered_no_session", () => {
    const result = isAutoSpeakable(textPart({}), undefined)
    expect(result.speakable).toBe(false)
    expect(result.reason).toBe("filtered_no_session")
  })

  it("filters sub-agent sessions with reason filtered_subagent", () => {
    const result = isAutoSpeakable(textPart({}), subSession())
    expect(result.speakable).toBe(false)
    expect(result.reason).toBe("filtered_subagent")
  })
})
