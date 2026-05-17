import { describe, expect, test } from "bun:test"
import { createRunBackgroundWaitState, shouldExitNonInteractiveLoop } from "@/cli/cmd/run"

function parentIdle() {
  return {
    type: "session.status",
    properties: {
      sessionID: "parent",
      status: { type: "idle" },
    },
  } as const
}

function childIdle() {
  return {
    type: "session.status",
    properties: {
      sessionID: "child",
      status: { type: "idle" },
    },
  } as const
}

function parentAssistant() {
  return {
    type: "message.updated",
    properties: {
      sessionID: "parent",
      info: { role: "assistant" },
    },
  } as const
}

function backgroundTaskStarted() {
  return {
    type: "message.part.updated",
    properties: {
      part: {
        sessionID: "parent",
        type: "tool",
        tool: "task",
        state: {
          status: "completed",
          metadata: {
            background: true,
            sessionId: "child",
          },
        },
      },
    },
  } as const
}

describe("non-interactive run background tasks", () => {
  test("does not exit on parent idle while a background task is still running", () => {
    const state = createRunBackgroundWaitState()

    expect(shouldExitNonInteractiveLoop(state, backgroundTaskStarted(), "parent")).toBe(false)
    expect(shouldExitNonInteractiveLoop(state, parentIdle(), "parent")).toBe(false)
  })

  test("exits after the background task finishes and the parent idles again", () => {
    const state = createRunBackgroundWaitState()

    expect(shouldExitNonInteractiveLoop(state, backgroundTaskStarted(), "parent")).toBe(false)
    expect(shouldExitNonInteractiveLoop(state, parentIdle(), "parent")).toBe(false)
    expect(shouldExitNonInteractiveLoop(state, childIdle(), "parent")).toBe(false)
    expect(shouldExitNonInteractiveLoop(state, parentAssistant(), "parent")).toBe(false)
    expect(shouldExitNonInteractiveLoop(state, parentIdle(), "parent")).toBe(true)
  })
})
