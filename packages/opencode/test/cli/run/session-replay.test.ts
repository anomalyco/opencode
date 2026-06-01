import { describe, expect, test } from "bun:test"
import { replayLocalRows, replaySession } from "@/cli/cmd/run/session-replay"
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

  test("merges failed local rows ahead of later persisted prompts", () => {
    const persisted = {
      kind: "user",
      text: "successful",
      phase: "start",
      source: "system",
      messageID: "msg-user-2",
    } as const
    const failed = {
      kind: "user",
      text: "failed",
      phase: "start",
      source: "system",
      messageID: "msg-user-1",
    } as const
    const error = {
      kind: "error",
      text: "network unavailable",
      phase: "start",
      source: "system",
      messageID: "msg-user-1",
    } as const

    expect(replayLocalRows([userMessage("msg-user-2", "successful")], [persisted], [{ commit: failed }, { commit: error }])).toEqual([
      failed,
      error,
      persisted,
    ])
  })

  test("retains local errors but not duplicate local prompts once a prompt persists", () => {
    const persisted = {
      kind: "user",
      text: "failed after persistence",
      phase: "start",
      source: "system",
      messageID: "msg-user-1",
    } as const
    const error = {
      kind: "error",
      text: "connection closed",
      phase: "start",
      source: "system",
      messageID: "msg-user-1",
    } as const

    expect(replayLocalRows([userMessage("msg-user-1", "failed after persistence")], [persisted], [{ commit: persisted }, { commit: error }])).toEqual([
      persisted,
      error,
    ])
  })

  test("keeps a local turn failure below assistant output already visible for that turn", () => {
    const first = {
      kind: "user",
      text: "start",
      phase: "start",
      source: "system",
      messageID: "msg-user-1",
    } as const
    const answer = {
      kind: "assistant",
      text: "partial answer",
      phase: "progress",
      source: "assistant",
      messageID: "msg-assistant-1",
    } as const
    const error = {
      kind: "error",
      text: "stream failed",
      phase: "start",
      source: "system",
      messageID: "msg-user-1",
    } as const
    const second = {
      kind: "user",
      text: "retry",
      phase: "start",
      source: "system",
      messageID: "msg-user-2",
    } as const

    expect(
      replayLocalRows(
        [userMessage("msg-user-1", "start"), userMessage("msg-user-2", "retry")],
        [first, answer, second],
        [
          {
            commit: error,
            after: { kind: "assistant", text: "partial answer", phase: "progress", messageID: "msg-assistant-1" },
          },
        ],
      ),
    ).toEqual([first, answer, error, second])
  })

  test("keeps a local failure above assistant output received after the failure", () => {
    const first = {
      kind: "user",
      text: "start",
      phase: "start",
      source: "system",
      messageID: "msg-user-1",
    } as const
    const error = {
      kind: "error",
      text: "request failed",
      phase: "start",
      source: "system",
      messageID: "msg-user-1",
    } as const
    const late = {
      kind: "assistant",
      text: "late answer",
      phase: "progress",
      source: "assistant",
      messageID: "msg-assistant-1",
    } as const

    expect(replayLocalRows([userMessage("msg-user-1", "start")], [first, late], [{ commit: error }])).toEqual([
      first,
      error,
      late,
    ])
  })

  test("inserts a local failure between persisted output chunks spanning that failure", () => {
    const first = {
      kind: "user",
      text: "start",
      phase: "start",
      source: "system",
      messageID: "msg-user-1",
    } as const
    const complete = {
      kind: "assistant",
      text: "before after",
      phase: "progress",
      source: "assistant",
      messageID: "msg-assistant-1",
      partID: "part-1",
    } as const
    const error = {
      kind: "error",
      text: "stream failed",
      phase: "start",
      source: "system",
      messageID: "msg-user-1",
    } as const

    expect(
      replayLocalRows([userMessage("msg-user-1", "start")], [first, complete], [
        {
          commit: error,
          after: {
            kind: "assistant",
            text: "before ",
            phase: "progress",
            messageID: "msg-assistant-1",
            partID: "part-1",
            visible: "before ",
          },
        },
      ]),
    ).toEqual([first, { ...complete, text: "before " }, error, { ...complete, text: "after" }])
  })

  test("places an unpersisted failed prompt before live output from that turn", () => {
    const prompt = {
      kind: "user",
      text: "start",
      phase: "start",
      source: "system",
      messageID: "msg-1",
    } as const
    const answer = {
      kind: "assistant",
      text: "partial answer",
      phase: "progress",
      source: "assistant",
      messageID: "msg-2",
    } as const
    const error = {
      kind: "error",
      text: "stream failed",
      phase: "start",
      source: "system",
      messageID: "msg-1",
    } as const

    expect(
      replayLocalRows([], [answer], [
        { commit: prompt },
        {
          commit: error,
          after: { kind: "assistant", text: "partial answer", phase: "progress", messageID: "msg-2" },
        },
      ]),
    ).toEqual([prompt, answer, error])
  })

  test("anchors a failure after the visible start of a tool that later completes", () => {
    const prompt = {
      kind: "user",
      text: "run ls",
      phase: "start",
      source: "system",
      messageID: "msg-user-1",
    } as const
    const running = {
      kind: "tool",
      text: "running bash",
      phase: "start",
      source: "tool",
      messageID: "msg-assistant-1",
      partID: "part-tool-1",
      toolState: "running",
    } as const
    const completed = {
      kind: "tool",
      text: "file.txt",
      phase: "final",
      source: "tool",
      messageID: "msg-assistant-1",
      partID: "part-tool-1",
      toolState: "completed",
    } as const
    const error = {
      kind: "error",
      text: "connection lost",
      phase: "start",
      source: "system",
      messageID: "msg-user-1",
    } as const

    expect(
      replayLocalRows([userMessage("msg-user-1", "run ls")], [prompt, running, completed], [
        {
          commit: error,
          after: {
            kind: "tool",
            text: "running bash",
            phase: "start",
            messageID: "msg-assistant-1",
            partID: "part-tool-1",
            toolState: "running",
          },
        },
      ]),
    ).toEqual([prompt, running, error, completed])
  })

  test("retains an unpersisted local diagnostic before later persisted prompts", () => {
    const first = {
      kind: "user",
      text: "before",
      phase: "start",
      source: "system",
      messageID: "msg-user-1",
    } as const
    const error = {
      kind: "error",
      text: "failed to start new session",
      phase: "start",
      source: "system",
      messageID: "msg-user-2",
    } as const
    const second = {
      kind: "user",
      text: "after",
      phase: "start",
      source: "system",
      messageID: "msg-user-3",
    } as const

    expect(
      replayLocalRows([userMessage("msg-user-1", "before"), userMessage("msg-user-3", "after")], [first, second], [
        { commit: error },
      ]),
    ).toEqual([first, error, second])
  })
})
