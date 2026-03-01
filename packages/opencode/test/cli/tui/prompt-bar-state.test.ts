import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Part } from "@opencode-ai/sdk/v2"
import { derivePromptBarState, type SessionStatusInfo } from "../../../src/cli/cmd/tui/util/prompt-bar-state"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseAssistant: AssistantMessage = {
  id: "msg_1",
  sessionID: "ses_1",
  role: "assistant",
  agent: "build",
  modelID: "claude-sonnet-4-20250514",
  providerID: "anthropic",
  mode: "",
  parentID: "msg_0",
  path: { cwd: "/test", root: "/test" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1000 },
}

const completedAssistant: AssistantMessage = {
  ...baseAssistant,
  time: { created: 1000, completed: 2000 },
}

const toolCallsAssistant: AssistantMessage = {
  ...baseAssistant,
  finish: "tool-calls",
}

const finalAssistant: AssistantMessage = {
  ...completedAssistant,
  finish: "stop",
}

function toolPart(status: "pending" | "running" | "completed" | "error"): Part {
  const base = {
    id: "part_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "tool" as const,
    callID: "call_1",
    tool: "bash",
  }
  if (status === "pending") {
    return {
      ...base,
      state: { status: "pending", input: { command: "ls" }, raw: "" },
    } as Part
  }
  if (status === "running") {
    return {
      ...base,
      state: { status: "running", input: { command: "ls" }, time: { start: 1000 } },
    } as Part
  }
  if (status === "completed") {
    return {
      ...base,
      state: {
        status: "completed",
        input: { command: "ls" },
        output: "file.txt",
        title: "List files",
        metadata: {},
        time: { start: 1000, end: 1100 },
      },
    } as Part
  }
  // error
  return {
    ...base,
    state: {
      status: "error",
      input: { command: "bad" },
      error: "Command failed",
      time: { start: 1000, end: 1050 },
    },
  } as Part
}

const idle: SessionStatusInfo = { type: "idle" }
const busy: SessionStatusInfo = { type: "busy" }
const retry: SessionStatusInfo = { type: "retry", attempt: 1, message: "rate limit", next: 5000 }

function inputFor({
  sessionStatus,
  assistant,
  parts,
  messages,
}: {
  sessionStatus?: SessionStatusInfo
  assistant?: AssistantMessage
  parts?: Part[]
  messages?: (AssistantMessage | { role: "user" } & Record<string, unknown>)[]
}) {
  const list = messages ?? (assistant ? [assistant] : [])
  return {
    sessionStatus,
    messages: list as AssistantMessage[],
    partsByMessageId: assistant ? { [assistant.id]: parts ?? [] } : {},
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("derivePromptBarState", () => {
  describe("idle — default when nothing is happening", () => {
    test("returns idle with no session status and no messages", () => {
      expect(derivePromptBarState(inputFor({}))).toBe("idle")
    })

    test("returns idle when session status is idle and no assistant message", () => {
      expect(derivePromptBarState(inputFor({ sessionStatus: idle }))).toBe("idle")
    })
  })

  describe("assistant_final — completed assistant message", () => {
    test("returns assistant_final when last message has final finish", () => {
      expect(derivePromptBarState(inputFor({ sessionStatus: idle, assistant: finalAssistant }))).toBe(
        "assistant_final",
      )
    })

    test("returns assistant_final even with completed tool parts when message is final", () => {
      const parts = [toolPart("completed")]
      expect(
        derivePromptBarState(inputFor({ sessionStatus: idle, assistant: finalAssistant, parts })),
      ).toBe("assistant_final")
    })
  })

  describe("tool_result — completed tool, message still streaming", () => {
    test("returns tool_result when tool completed and finish is tool-calls", () => {
      const parts = [toolPart("completed")]
      expect(
        derivePromptBarState(inputFor({ sessionStatus: idle, assistant: toolCallsAssistant, parts })),
      ).toBe("tool_result")
    })

    test("busy takes precedence over tool_result", () => {
      const parts = [toolPart("completed")]
      expect(
        derivePromptBarState(inputFor({ sessionStatus: busy, assistant: toolCallsAssistant, parts })),
      ).toBe("streaming")
    })
  })

  describe("busy — session is busy, no tool state", () => {
    test("returns busy when session is busy and no tool parts", () => {
      expect(derivePromptBarState(inputFor({ sessionStatus: busy, assistant: baseAssistant }))).toBe(
        "streaming",
      )
    })

    test("returns tool_running when session is busy and tool is pending", () => {
      const parts = [toolPart("pending")]
      expect(
        derivePromptBarState(inputFor({ sessionStatus: busy, assistant: baseAssistant, parts })),
      ).toBe("tool_running")
    })
  })

  describe("tool_error — warning-level tool failure", () => {
    test("returns tool_error when a tool part has error status", () => {
      const parts = [toolPart("error")]
      expect(derivePromptBarState(inputFor({ sessionStatus: idle, assistant: baseAssistant, parts }))).toBe(
        "warning",
      )
    })

    test("warning takes precedence over streaming", () => {
      const parts = [toolPart("error")]
      expect(derivePromptBarState(inputFor({ sessionStatus: busy, assistant: baseAssistant, parts }))).toBe(
        "warning",
      )
    })
  })

  describe("tool_running — a tool is actively running", () => {
    test("returns tool_running when a tool part is running", () => {
      const parts = [toolPart("running")]
      expect(derivePromptBarState(inputFor({ sessionStatus: busy, assistant: baseAssistant, parts }))).toBe(
        "tool_running",
      )
    })

    test("tool_running takes precedence over warning", () => {
      const parts = [toolPart("running"), toolPart("error")]
      expect(derivePromptBarState(inputFor({ sessionStatus: busy, assistant: baseAssistant, parts }))).toBe(
        "tool_running",
      )
    })

    test("tool_running takes precedence over streaming", () => {
      const parts = [toolPart("running")]
      expect(derivePromptBarState(inputFor({ sessionStatus: busy, assistant: baseAssistant, parts }))).toBe(
        "tool_running",
      )
    })
  })

  describe("retry — session is retrying", () => {
    test("returns warning when session status is retry", () => {
      expect(derivePromptBarState(inputFor({ sessionStatus: retry, assistant: baseAssistant }))).toBe(
        "warning",
      )
    })

    test("warning takes precedence over tool_running", () => {
      const parts = [toolPart("running")]
      expect(derivePromptBarState(inputFor({ sessionStatus: retry, assistant: baseAssistant, parts }))).toBe(
        "warning",
      )
    })

    test("warning takes precedence over streaming", () => {
      expect(derivePromptBarState(inputFor({ sessionStatus: retry, assistant: baseAssistant }))).toBe(
        "warning",
      )
    })
  })

  describe("error — fatal assistant error (excluding MessageAbortedError)", () => {
    test("returns error when assistant has a non-aborted error", () => {
      const msg: AssistantMessage = {
        ...baseAssistant,
        error: { name: "APIError", data: { message: "Unauthorized", isRetryable: false } },
      }
      expect(derivePromptBarState(inputFor({ sessionStatus: idle, assistant: msg }))).toBe("error")
    })

    test("error takes precedence over retry", () => {
      const msg: AssistantMessage = {
        ...baseAssistant,
        error: { name: "APIError", data: { message: "Server error", isRetryable: false } },
      }
      expect(derivePromptBarState(inputFor({ sessionStatus: retry, assistant: msg }))).toBe("error")
    })

    test("error takes precedence over tool_running", () => {
      const msg: AssistantMessage = {
        ...baseAssistant,
        error: { name: "APIError", data: { message: "Server error", isRetryable: false } },
      }
      const parts = [toolPart("running")]
      expect(derivePromptBarState(inputFor({ sessionStatus: busy, assistant: msg, parts }))).toBe("error")
    })
  })

  describe("MessageAbortedError exclusion", () => {
    test("does NOT return error for MessageAbortedError — falls through to assistant_final", () => {
      const msg: AssistantMessage = {
        ...finalAssistant,
        error: { name: "MessageAbortedError", data: { message: "Aborted by user" } },
      }
      expect(derivePromptBarState(inputFor({ sessionStatus: idle, assistant: msg }))).toBe(
        "assistant_final",
      )
    })

    test("MessageAbortedError with no finish falls through to idle", () => {
      const msg: AssistantMessage = {
        ...baseAssistant,
        error: { name: "MessageAbortedError", data: { message: "Aborted by user" } },
      }
      expect(derivePromptBarState(inputFor({ sessionStatus: idle, assistant: msg }))).toBe("idle")
    })

    test("MessageAbortedError with busy session falls through to busy", () => {
      const msg: AssistantMessage = {
        ...baseAssistant,
        error: { name: "MessageAbortedError", data: { message: "Aborted by user" } },
      }
      expect(derivePromptBarState(inputFor({ sessionStatus: busy, assistant: msg }))).toBe("streaming")
    })

    test("MessageAbortedError with running tool falls through to tool_running", () => {
      const msg: AssistantMessage = {
        ...baseAssistant,
        error: { name: "MessageAbortedError", data: { message: "Aborted by user" } },
      }
      const parts = [toolPart("running")]
      expect(derivePromptBarState(inputFor({ sessionStatus: busy, assistant: msg, parts }))).toBe(
        "tool_running",
      )
    })
  })

  describe("full precedence chain", () => {
    test("error > retry > tool_running > tool_error > busy > tool_result > assistant_final > idle", () => {
      const parts = [toolPart("running"), toolPart("error"), toolPart("completed")]

      // retry wins over tool_running + tool_error + tool_result
      expect(derivePromptBarState(inputFor({ sessionStatus: retry, assistant: baseAssistant, parts }))).toBe(
        "warning",
      )

      // Without retry, tool_running wins
      expect(derivePromptBarState(inputFor({ sessionStatus: busy, assistant: baseAssistant, parts }))).toBe(
        "tool_running",
      )

      // Without running tool, tool_error wins
      const noRunning = [toolPart("error"), toolPart("completed")]
      expect(derivePromptBarState(inputFor({ sessionStatus: busy, assistant: baseAssistant, parts: noRunning }))).toBe(
        "warning",
      )

      // Without error tool, busy wins over tool_result (busy > tool_result in precedence)
      const onlyCompleted = [toolPart("completed")]
      expect(derivePromptBarState(inputFor({ sessionStatus: busy, assistant: baseAssistant, parts: onlyCompleted }))).toBe(
        "streaming",
      )

      // Without busy, tool_result wins (idle session + completed tool + incomplete message)
      expect(derivePromptBarState(inputFor({ sessionStatus: idle, assistant: toolCallsAssistant, parts: onlyCompleted }))).toBe(
        "tool_result",
      )

      expect(derivePromptBarState(inputFor({ sessionStatus: idle, assistant: finalAssistant }))).toBe(
        "assistant_final",
      )

      // Nothing active → idle
      expect(derivePromptBarState(inputFor({ sessionStatus: idle }))).toBe("idle")
    })
  })
})
