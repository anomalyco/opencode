import { describe, expect, test } from "bun:test"
import { replayLocalRows, replaySession } from "@/cli/cmd/run/session-replay"
import type { SessionMessages } from "@/cli/cmd/run/session.shared"
import type { RunProvider } from "@/cli/cmd/run/types"

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

function assistantInfo(
  id: string,
  input: {
    parentID?: string
    modelID?: string
    providerID?: string
    time?: { created: number; completed?: number }
  } = {},
) {
  return {
    id,
    sessionID: "session-1",
    role: "assistant" as const,
    time: input.time ?? { created: 2 },
    parentID: input.parentID ?? "msg-user-1",
    modelID: input.modelID ?? "gpt-5",
    providerID: input.providerID ?? "openai",
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

function assistantMessage(
  id: string,
  text: string,
  input: {
    parentID?: string
    modelID?: string
    providerID?: string
    time?: { created: number; completed?: number }
  } = {},
): SessionMessages[number] {
  const time = input.time ?? {
    created: 200,
    completed: 3000,
  }

  return {
    info: assistantInfo(id, {
      ...input,
      time,
    }),
    parts: [
      {
        id: `${id}-text`,
        sessionID: "session-1",
        messageID: id,
        type: "text",
        text,
        time: {
          start: time.created,
          end: time.completed,
        },
      },
    ],
  }
}

const provider = (name: string): RunProvider => ({
  id: "openai",
  name: "OpenAI",
  source: "api",
  env: [],
  options: {},
  models: {
    "gpt-5": {
      id: "gpt-5",
      providerID: "openai",
      api: {
        id: "openai",
        url: "https://openai.test",
        npm: "@ai-sdk/openai",
      },
      name,
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        interleaved: false,
      },
      cost: {
        input: 0,
        output: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      limit: {
        context: 128000,
        output: 8192,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2026-01-01",
    },
  },
})

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

function shellUserMessage(id: string): SessionMessages[number] {
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
        text: "The following tool was executed by the user",
        synthetic: true,
      },
    ],
  }
}

function shellAssistantMessage(id: string, parentID: string): SessionMessages[number] {
  return {
    info: assistantInfo(id, {
      parentID,
      time: {
        created: 200,
        completed: 3000,
      },
    }),
    parts: [
      {
        id: `${id}-tool`,
        sessionID: "session-1",
        messageID: id,
        type: "tool",
        callID: `${id}-call`,
        tool: "bash",
        state: {
          status: "completed",
          input: {
            command: "ls",
          },
          output: "account.ts\n",
          title: "",
          metadata: {
            output: "account.ts\n",
          },
          time: {
            start: 200,
            end: 3000,
          },
        },
      },
    ],
  }
}

describe("run session replay", () => {
  test("replays persisted user, assistant, and turn summary history into scrollback commits", () => {
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
      expect.objectContaining({
        kind: "system",
        text: "▣ Build · gpt-5 · 2.8s",
        phase: "final",
        source: "system",
        messageID: "msg-1",
        summary: {
          agent: "Build",
          model: "gpt-5",
          duration: "2.8s",
        },
      }),
    ])
    expect(out.patch).toEqual(
      expect.objectContaining({
        phase: "idle",
        status: "",
      }),
    )
  })

  test("uses provider model names for replayed turn summaries when available", () => {
    const out = replaySession({
      messages: [
        userMessage("msg-user-1", "Hello, whats the weather today?"),
        assistantMessage("msg-1", "What city or ZIP code should I check?"),
      ],
      permissions: [],
      questions: [],
      thinking: true,
      limits: {},
      providers: [provider("Little Frank")],
    })

    expect(out.commits.at(-1)).toEqual(
      expect.objectContaining({
        kind: "system",
        text: "▣ Build · Little Frank · 2.8s",
        summary: {
          agent: "Build",
          model: "Little Frank",
          duration: "2.8s",
        },
      }),
    )
  })

  test("replays one turn summary for the final assistant in a multi-step turn", () => {
    const out = replaySession({
      messages: [
        userMessage("msg-user-1", "Plan and then answer"),
        assistantMessage("msg-step-1", "Working", {
          parentID: "msg-user-1",
          time: { created: 200, completed: 900 },
        }),
        assistantMessage("msg-step-2", "Done", {
          parentID: "msg-user-1",
          time: { created: 1000, completed: 3000 },
        }),
      ],
      permissions: [],
      questions: [],
      thinking: true,
      limits: {},
    })

    expect(out.commits.filter((commit) => commit.summary)).toEqual([
      expect.objectContaining({
        kind: "system",
        text: "▣ Build · gpt-5 · 2.0s",
        messageID: "msg-step-2",
      }),
    ])
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

  test("does not replay turn summaries for shell-mode commands", () => {
    const out = replaySession({
      messages: [
        shellUserMessage("msg-shell-user-1"),
        shellAssistantMessage("msg-shell-assistant-1", "msg-shell-user-1"),
      ],
      permissions: [],
      questions: [],
      thinking: true,
      limits: {},
    })

    expect(out.commits.some((commit) => commit.summary)).toBe(false)
    expect(out.commits).toContainEqual(
      expect.objectContaining({
        kind: "tool",
        text: "account.ts\n",
        tool: "bash",
        toolState: "completed",
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

    expect(
      replayLocalRows([userMessage("msg-user-2", "successful")], [persisted], [{ commit: failed }, { commit: error }]),
    ).toEqual([failed, error, persisted])
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

    expect(
      replayLocalRows(
        [userMessage("msg-user-1", "failed after persistence")],
        [persisted],
        [{ commit: persisted }, { commit: error }],
      ),
    ).toEqual([persisted, error])
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
      replayLocalRows(
        [userMessage("msg-user-1", "start")],
        [first, complete],
        [
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
        ],
      ),
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
      replayLocalRows(
        [],
        [answer],
        [
          { commit: prompt },
          {
            commit: error,
            after: { kind: "assistant", text: "partial answer", phase: "progress", messageID: "msg-2" },
          },
        ],
      ),
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
      replayLocalRows(
        [userMessage("msg-user-1", "run ls")],
        [prompt, running, completed],
        [
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
        ],
      ),
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
      replayLocalRows(
        [userMessage("msg-user-1", "before"), userMessage("msg-user-3", "after")],
        [first, second],
        [{ commit: error }],
      ),
    ).toEqual([first, error, second])
  })
})
