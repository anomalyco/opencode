import { describe, expect, test } from "bun:test"
import type { Event } from "@opencode-ai/sdk/v2"
import { createSessionData, flushInterrupted, reduceSessionData } from "@/cli/cmd/run/session-data"
import type { StreamCommit } from "@/cli/cmd/run/types"

function reduce(data: ReturnType<typeof createSessionData>, event: unknown, thinking = true) {
  return reduceSessionData({
    data,
    event: event as Event,
    sessionID: "session-1",
    thinking,
    limits: {},
  })
}

function assistant(id: string, extra: Record<string, unknown> = {}) {
  return {
    type: "message.updated",
    properties: {
      sessionID: "session-1",
      info: {
        id,
        role: "assistant",
        providerID: "openai",
        modelID: "gpt-5",
        tokens: {
          input: 1,
          output: 1,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        ...extra,
      },
    },
  }
}

function user(id: string) {
  return {
    type: "message.updated",
    properties: {
      sessionID: "session-1",
      info: {
        id,
        role: "user",
      },
    },
  }
}

function text(input: { id: string; messageID: string; text: string; time?: Record<string, number> }) {
  return {
    type: "message.part.updated",
    properties: {
      part: {
        id: input.id,
        messageID: input.messageID,
        sessionID: "session-1",
        type: "text",
        text: input.text,
        ...(input.time ? { time: input.time } : {}),
      },
    },
  }
}

function reasoning(input: { id: string; messageID: string; text: string; time?: Record<string, number> }) {
  return {
    type: "message.part.updated",
    properties: {
      part: {
        id: input.id,
        messageID: input.messageID,
        sessionID: "session-1",
        type: "reasoning",
        text: input.text,
        ...(input.time ? { time: input.time } : {}),
      },
    },
  }
}

function delta(messageID: string, partID: string, value: string) {
  return {
    type: "message.part.delta",
    properties: {
      sessionID: "session-1",
      messageID,
      partID,
      field: "text",
      delta: value,
    },
  }
}

function tool(input: { id: string; messageID: string; tool: string; state: Record<string, unknown>; callID?: string }) {
  return {
    type: "message.part.updated",
    properties: {
      part: {
        id: input.id,
        messageID: input.messageID,
        sessionID: "session-1",
        type: "tool",
        tool: input.tool,
        ...(input.callID ? { callID: input.callID } : {}),
        state: input.state,
      },
    },
  }
}

describe("run session data", () => {
  test("buffers delayed assistant text until the role is known", () => {
    let data = createSessionData()
    data = reduce(data, delta("msg-1", "txt-1", "hello")).data
    data = reduce(data, assistant("msg-1")).data

    const out = reduce(
      data,
      text({
        id: "txt-1",
        messageID: "msg-1",
        text: "",
        time: { end: 1 },
      }),
    )

    expect(out.commits).toEqual([
      expect.objectContaining({
        kind: "assistant",
        text: "hello",
        partID: "txt-1",
      }),
    ])
  })

  test("keeps leading whitespace buffered until real assistant content arrives", () => {
    let data = createSessionData()
    data = reduce(data, assistant("msg-1")).data
    data = reduce(data, text({ id: "txt-1", messageID: "msg-1", text: "", time: { start: 1 } })).data

    let out = reduce(data, delta("msg-1", "txt-1", " "))
    expect(out.commits).toEqual([])

    out = reduce(out.data, delta("msg-1", "txt-1", "Found"))
    expect(out.commits).toEqual([
      expect.objectContaining({
        kind: "assistant",
        text: " Found",
      }),
    ])
  })

  test("drops delayed text once the message resolves to a user role", () => {
    let data = createSessionData()
    data = reduce(data, text({ id: "txt-user-1", messageID: "msg-user-1", text: "HELLO", time: { end: 1 } })).data

    const out = reduce(data, user("msg-user-1"))

    expect(out.commits).toEqual([])
    expect(out.data.ids.has("txt-user-1")).toBe(true)
  })

  test("suppresses reasoning commits when thinking is disabled", () => {
    const out = reduce(
      createSessionData(),
      reasoning({
        id: "reason-1",
        messageID: "msg-1",
        text: "hidden",
        time: { end: 1 },
      }),
      false,
    )

    expect(out.commits).toEqual([])
    expect(out.data.ids.has("reason-1")).toBe(true)
  })

  test("keeps permission precedence over queued questions", () => {
    let data = createSessionData()
    data = reduce(data, {
      type: "permission.asked",
      properties: {
        id: "perm-1",
        sessionID: "session-1",
        permission: "read",
        patterns: ["/tmp/file.txt"],
        metadata: {},
        always: [],
      },
    }).data

    const ask = reduce(data, {
      type: "question.asked",
      properties: {
        id: "question-1",
        sessionID: "session-1",
        questions: [
          {
            question: "Mode?",
            header: "Mode",
            options: [{ label: "chunked", description: "Incremental output" }],
            multiple: false,
          },
        ],
      },
    })

    expect(ask.footer).toEqual({
      patch: { status: "awaiting permission" },
      view: {
        type: "permission",
        request: expect.objectContaining({ id: "perm-1" }),
      },
    })

    expect(
      reduce(ask.data, {
        type: "permission.replied",
        properties: {
          sessionID: "session-1",
          requestID: "perm-1",
          reply: "reject",
        },
      }).footer,
    ).toEqual({
      patch: { status: "awaiting answer" },
      view: {
        type: "question",
        request: expect.objectContaining({ id: "question-1" }),
      },
    })
  })

  test("refreshes the active permission view when tool input arrives later", () => {
    const data = reduce(createSessionData(), {
      type: "permission.asked",
      properties: {
        id: "perm-1",
        sessionID: "session-1",
        permission: "bash",
        patterns: ["src/**/*.ts"],
        metadata: {},
        always: [],
        tool: {
          messageID: "msg-1",
          callID: "call-1",
        },
      },
    }).data

    const out = reduce(
      data,
      tool({
        id: "tool-1",
        messageID: "msg-1",
        callID: "call-1",
        tool: "bash",
        state: {
          status: "running",
          input: {
            command: "git status --short",
          },
        },
      }),
    )

    expect(out.footer).toEqual({
      view: {
        type: "permission",
        request: expect.objectContaining({
          id: "perm-1",
          metadata: expect.objectContaining({
            input: {
              command: "git status --short",
            },
          }),
        }),
      },
    })
  })

  test("strips bash echo only from the first assistant flush", () => {
    let data = createSessionData()
    data = reduce(data, assistant("msg-1")).data
    data = reduce(
      data,
      tool({
        id: "tool-1",
        messageID: "msg-1",
        tool: "bash",
        state: {
          status: "completed",
          input: {
            command: "printf hi",
          },
          output: "echoed\n",
          time: { start: 1, end: 2 },
        },
      }),
    ).data

    const first = reduce(
      data,
      text({
        id: "txt-1",
        messageID: "msg-1",
        text: "echoed\nanswer",
      }),
    )

    expect(first.commits).toEqual([
      expect.objectContaining({
        kind: "assistant",
        text: "answer",
      }),
    ])

    expect(reduce(first.data, delta("msg-1", "txt-1", "\nechoed\nagain")).commits).toEqual([
      expect.objectContaining({
        kind: "assistant",
        text: "\nechoed\nagain",
      }),
    ])
  })

  test("synthesizes a glob start before an error when the running update is missed", () => {
    expect(
      reduce(
        createSessionData(),
        tool({
          id: "tool-1",
          messageID: "msg-1",
          tool: "glob",
          state: {
            status: "error",
            input: {
              pattern: "**/*tool*",
              path: "/tmp/demo/run",
            },
            error: "No such file or directory: '/tmp/demo/run'",
          },
        }),
      ).commits,
    ).toEqual([
      expect.objectContaining({
        kind: "tool",
        tool: "glob",
        phase: "start",
        partID: "tool-1",
        text: "running glob",
        toolState: "running",
      }),
      expect.objectContaining({
        kind: "tool",
        tool: "glob",
        phase: "final",
        partID: "tool-1",
        text: "No such file or directory: '/tmp/demo/run'",
        toolState: "error",
        toolError: "No such file or directory: '/tmp/demo/run'",
      }),
    ])
  })

  test("flushInterrupted emits one interrupted final per live part", () => {
    const data = reduce(
      createSessionData(),
      text({
        id: "txt-1",
        messageID: "msg-1",
        text: "unfinished",
      }),
    ).data

    const first: StreamCommit[] = []
    flushInterrupted(data, first)
    expect(first).toEqual([
      expect.objectContaining({ kind: "assistant", text: "unfinished", phase: "progress" }),
      expect.objectContaining({ kind: "assistant", phase: "final", interrupted: true }),
    ])

    const next: StreamCommit[] = []
    flushInterrupted(data, next)
    expect(next).toEqual([])
  })

  test("surfaces session errors as error commits", () => {
    const out = reduce(createSessionData(), {
      type: "session.error",
      properties: {
        sessionID: "session-1",
        error: {
          name: "UnknownError",
          data: {
            message: "permission denied",
          },
        },
      },
    })

    expect(out.commits).toEqual([
      expect.objectContaining({
        kind: "error",
        text: "permission denied",
      }),
    ])
  })
})
