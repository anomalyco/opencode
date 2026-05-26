import { describe, expect, test } from "bun:test"
import { replaySession } from "@/cli/cmd/run/session-replay"
import type { SessionMessages } from "@/cli/cmd/run/session.shared"

function userMessage(id: string, text: string): SessionMessages[number] {
  return {
    info: {
      id,
      sessionID: "session-1",
      role: "user",
      time: {
        created: 1,
      },
      agent: "build",
      model: {
        providerID: "openai",
        modelID: "gpt-5",
      },
    },
    parts: [
      {
        id: `${id}-text`,
        sessionID: "session-1",
        messageID: id,
        type: "text",
        text,
      },
    ],
  }
}

function assistantInfo(id: string) {
  return {
    id,
    sessionID: "session-1",
    role: "assistant" as const,
    time: {
      created: 2,
    },
    parentID: "msg-user-1",
    modelID: "gpt-5",
    providerID: "openai",
    mode: "chat",
    agent: "build",
    path: {
      cwd: "/tmp",
      root: "/tmp",
    },
    cost: 0,
    tokens: {
      input: 1,
      output: 1,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
  }
}

function assistantMessage(id: string, text: string): SessionMessages[number] {
  return {
    info: assistantInfo(id),
    parts: [
      {
        id: `${id}-text`,
        sessionID: "session-1",
        messageID: id,
        type: "text",
        text,
        time: {
          start: 2,
          end: 3,
        },
      },
    ],
  }
}

function runningToolMessage(id: string): SessionMessages[number] {
  return {
    info: assistantInfo(id),
    parts: [
      {
        id: `${id}-tool`,
        sessionID: "session-1",
        messageID: id,
        type: "tool",
        callID: `${id}-call`,
        tool: "bash",
        state: {
          status: "running",
          input: {
            command: "pwd",
          },
          time: {
            start: 2,
          },
        },
      },
    ],
  }
}

describe("run session replay", () => {
  test("replays persisted user and assistant history into scrollback commits", () => {
    const out = replaySession({
      messages: [
        userMessage("msg-user-1", "Hello, whats the weather today?"),
        assistantMessage("msg-1", "What city or ZIP code should I check?"),
      ],
      permissions: [],
      questions: [],
      thinking: true,
      limits: {},
    })

    expect(out.commits).toEqual([
      expect.objectContaining({
        kind: "user",
        text: "Hello, whats the weather today?",
        phase: "start",
        source: "system",
        messageID: "msg-user-1",
      }),
      expect.objectContaining({
        kind: "assistant",
        text: "What city or ZIP code should I check?",
        phase: "progress",
        source: "assistant",
        messageID: "msg-1",
      }),
    ])
    expect(out.patch).toEqual(
      expect.objectContaining({
        phase: "idle",
        status: "",
      }),
    )
  })

  test("keeps the footer in a running state for resumed active tools", () => {
    const out = replaySession({
      messages: [runningToolMessage("msg-1")],
      permissions: [],
      questions: [],
      thinking: true,
      limits: {},
    })

    expect(out.patch).toEqual(
      expect.objectContaining({
        phase: "running",
        status: "running bash",
      }),
    )
  })
})
