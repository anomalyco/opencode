import { test, expect, describe } from "bun:test"
import { extractResponseText } from "../../src/cli/cmd/github"
import type { MessageV2 } from "../../src/session/message-v2"

// Helper to create minimal valid parts
function createTextPart(text: string): MessageV2.Part {
  return {
    id: "1",
    sessionID: "s",
    messageID: "m",
    type: "text" as const,
    text,
  }
}

function createReasoningPart(text: string): MessageV2.Part {
  return {
    id: "1",
    sessionID: "s",
    messageID: "m",
    type: "reasoning" as const,
    text,
    time: { start: 0 },
  }
}

function createToolPart(tool: string, title: string, status: "completed" | "running" = "completed"): MessageV2.Part {
  if (status === "completed") {
    return {
      id: "1",
      sessionID: "s",
      messageID: "m",
      type: "tool" as const,
      callID: "c1",
      tool,
      state: {
        status: "completed",
        input: {},
        output: "",
        title,
        metadata: {},
        time: { start: 0, end: 1 },
      },
    }
  }
  return {
    id: "1",
    sessionID: "s",
    messageID: "m",
    type: "tool" as const,
    callID: "c1",
    tool,
    state: {
      status: "running",
      input: {},
      time: { start: 0 },
    },
  }
}

function createStepStartPart(): MessageV2.Part {
  return {
    id: "1",
    sessionID: "s",
    messageID: "m",
    type: "step-start" as const,
  }
}

describe("extractResponseText", () => {
  test("returns text from text part", () => {
    const parts = [createTextPart("Hello world")]
    expect(extractResponseText(parts)).toBe("Hello world")
  })

  test("returns last text part when multiple exist", () => {
    const parts = [createTextPart("First"), createTextPart("Last")]
    expect(extractResponseText(parts)).toBe("Last")
  })

  test("returns text even when tool parts follow", () => {
    const parts = [createTextPart("I'll help with that."), createToolPart("todowrite", "3 todos")]
    expect(extractResponseText(parts)).toBe("I'll help with that.")
  })

  test("returns null for reasoning-only response (signals summary needed)", () => {
    const parts = [createReasoningPart("Let me think about this...")]
    expect(extractResponseText(parts)).toBeNull()
  })

  test("returns null for tool-only response (signals summary needed)", () => {
    // This is the exact scenario from the bug report - todowrite with no text
    const parts = [createToolPart("todowrite", "8 todos")]
    expect(extractResponseText(parts)).toBeNull()
  })

  test("returns null for multiple completed tools", () => {
    const parts = [
      createToolPart("read", "src/file.ts"),
      createToolPart("edit", "src/file.ts"),
      createToolPart("bash", "bun test"),
    ]
    expect(extractResponseText(parts)).toBeNull()
  })

  test("ignores running tool parts (throws since no completed tools)", () => {
    const parts = [createToolPart("bash", "", "running")]
    expect(() => extractResponseText(parts)).toThrow("Failed to parse response")
  })

  test("throws with part types on empty array", () => {
    expect(() => extractResponseText([])).toThrow("Part types found: [none]")
  })

  test("throws with part types on unhandled parts", () => {
    const parts = [createStepStartPart()]
    expect(() => extractResponseText(parts)).toThrow("Part types found: [step-start]")
  })

  test("prefers text over reasoning when both present", () => {
    const parts = [createReasoningPart("Internal thinking..."), createTextPart("Final answer")]
    expect(extractResponseText(parts)).toBe("Final answer")
  })

  test("prefers text over tools when both present", () => {
    const parts = [createToolPart("read", "src/file.ts"), createTextPart("Here's what I found")]
    expect(extractResponseText(parts)).toBe("Here's what I found")
  })
})
