import { describe, expect, test } from "bun:test"
import { replaySession } from "./session-replay"
import type { SessionMessages } from "./session.shared"

const sessionID = "ses_replay_interrupted"
const userID = "msg_user"
const assistantID = "msg_assistant"

const messages: SessionMessages = [
  {
    info: {
      id: userID,
      sessionID,
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "provider", modelID: "model" },
    },
    parts: [{ id: "prt_user", sessionID, messageID: userID, type: "text", text: "check health" }],
  },
  {
    info: {
      id: assistantID,
      sessionID,
      role: "assistant",
      time: { created: 2 },
      agent: "build",
      parentID: userID,
      modelID: "model",
      providerID: "provider",
      mode: "build",
      path: { cwd: "/project", root: "/project" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [
      {
        id: "prt_tool",
        sessionID,
        messageID: assistantID,
        type: "tool",
        callID: "call_health",
        tool: "bash",
        state: {
          status: "running",
          input: { command: "bun ops prod health" },
          title: "bun ops prod health",
          time: { start: 3 },
        },
      },
    ],
  },
]

describe("replaySession", () => {
  test("keeps replayed active work running by default", () => {
    const replay = replaySession({
      messages,
      permissions: [],
      questions: [],
      thinking: true,
      limits: {},
    })

    expect(replay.patch?.phase).toBe("running")
    expect(replay.commits).not.toContainEqual(
      expect.objectContaining({
        partID: "prt_tool",
        interrupted: true,
      }),
    )
  })

  test("settles replayed active work when the session is no longer running", () => {
    const replay = replaySession({
      messages,
      permissions: [],
      questions: [],
      thinking: true,
      limits: {},
      settleActive: true,
    })

    expect(replay.patch?.phase).toBe("idle")
    expect(replay.commits).toContainEqual(
      expect.objectContaining({
        kind: "tool",
        phase: "final",
        partID: "prt_tool",
        interrupted: true,
      }),
    )
  })
})
