import { describe, expect, test } from "bun:test"
import type { Message, Part, SessionStatus, Todo } from "@opencode-ai/sdk/v2"
import { deriveSessionRecap, type SessionMessageWithParts } from "../../../src/cli/cmd/tui/component/session-recap"

function userMessage(id: string, summaryBody?: string): Message {
  return {
    id,
    sessionID: "ses_1",
    role: "user",
    time: { created: 1 },
    summary: summaryBody ? { body: summaryBody, diffs: [] } : undefined,
    agent: "default",
    model: {
      providerID: "anthropic",
      modelID: "claude",
    },
  }
}

function assistantMessage(id: string, input: { summary?: boolean; error?: string } = {}): Message {
  return {
    id,
    sessionID: "ses_1",
    role: "assistant",
    time: { created: 2, completed: 3 },
    parentID: "msg_u_1",
    modelID: "claude",
    providerID: "anthropic",
    mode: "default",
    agent: "default",
    path: { cwd: "/tmp", root: "/tmp" },
    summary: input.summary,
    cost: 0,
    tokens: {
      input: 1,
      output: 1,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    error: input.error
      ? {
          name: "UnknownError",
          data: { message: input.error },
        }
      : undefined,
  }
}

function textPart(messageID: string, text: string): Part {
  return {
    id: `part_${messageID}`,
    sessionID: "ses_1",
    messageID,
    type: "text",
    text,
  }
}

describe("deriveSessionRecap", () => {
  test("prefers latest assistant summary for done", () => {
    const messages: SessionMessageWithParts[] = [
      {
        info: userMessage("msg_u_1"),
        parts: [],
      },
      {
        info: assistantMessage("msg_a_1", { summary: true }),
        parts: [textPart("msg_a_1", "Completed migration and wired the recap panel.")],
      },
    ]
    const todos: Todo[] = [{ content: "Ship PR", status: "pending", priority: "high" }]
    const recap = deriveSessionRecap({ messages, todos })

    expect(recap.done).toContain("Completed migration")
    expect(recap.next).toBe("Ship PR")
    expect(recap.blocked).toBe("None.")
  })

  test("uses active work status as blocked when busy", () => {
    const messages: SessionMessageWithParts[] = [
      {
        info: assistantMessage("msg_a_1"),
        parts: [textPart("msg_a_1", "Working on follow-up checks.")],
      },
    ]
    const todos: Todo[] = []
    const status: SessionStatus = { type: "busy" }
    const recap = deriveSessionRecap({ messages, todos, status })

    expect(recap.blocked).toBe("Session is currently running.")
  })

  test("falls back to user summary body for done", () => {
    const messages: SessionMessageWithParts[] = [
      {
        info: userMessage("msg_u_1", "Refined plan and identified remaining deployment risks."),
        parts: [],
      },
    ]
    const recap = deriveSessionRecap({ messages, todos: [] })

    expect(recap.done).toContain("Refined plan")
    expect(recap.next).toBe("No pending tasks.")
  })

  test("skips markdown headings and prefers accomplished section content", () => {
    const messages: SessionMessageWithParts[] = [
      {
        info: assistantMessage("msg_a_2", { summary: true }),
        parts: [
          textPart(
            "msg_a_2",
            [
              "## Goal",
              "Ship the recap feature.",
              "",
              "## Accomplished",
              "Wired the selected-session recap block into the sessions dialog.",
            ].join("\n"),
          ),
        ],
      },
    ]

    const recap = deriveSessionRecap({ messages, todos: [] })
    expect(recap.done).toBe("Wired the selected-session recap block into the sessions dialog.")
  })
})
