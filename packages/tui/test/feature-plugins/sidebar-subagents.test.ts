import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2"
import {
  activeSubagents,
  deriveSubagents,
  recentSubagents,
  subagentActivity,
} from "../../src/feature-plugins/sidebar/subagents"

const messages = [{ id: "message-1" }]
const noStatus = () => undefined
const busyStatus = () => ({ type: "busy" as const })

describe("sidebar subagents", () => {
  test("returns no entries when the session has no task parts", () => {
    expect(activeSubagents(messages, () => [], noStatus)).toEqual([])
  })

  test("derives running and completed subagents", () => {
    expect(
      activeSubagents(
        messages,
        () =>
          [
            {
              type: "tool",
              tool: "task",
              state: {
                status: "running",
                input: { description: "Research APIs" },
                metadata: { sessionId: "child-running" },
              },
            },
            {
              type: "tool",
              tool: "task",
              state: {
                status: "completed",
                input: { description: "Review changes" },
                title: "Review changes",
                metadata: { sessionId: "child-completed" },
              },
            },
          ] as unknown as Part[],
        (sessionID) => (sessionID === "child-running" ? busyStatus() : undefined),
      ),
    ).toEqual([{ description: "Research APIs", status: "active", session_id: "child-running" }])
  })

  test("marks errored subagents as failed", () => {
    expect(
      activeSubagents(
        messages,
        () =>
          [
            {
              type: "tool",
              tool: "task",
              state: {
                status: "error",
                input: { description: "Run checks" },
                error: "failed",
                metadata: { sessionId: "child-error" },
              },
            },
          ] as unknown as Part[],
        noStatus,
      ),
    ).toEqual([])
  })

  test("keeps pending subagents without a session id non-navigable", () => {
    expect(
      activeSubagents(
        messages,
        () =>
          [
            {
              type: "tool",
              tool: "task",
              state: {
                status: "pending",
                input: { description: "Start worker" },
                raw: "{}",
              },
            },
          ] as unknown as Part[],
        noStatus,
      ),
    ).toEqual([{ description: "Start worker", status: "pending", session_id: undefined }])
  })

  test("deduplicates one child session across messages", () => {
    expect(
      activeSubagents(
        [{ id: "message-1" }, { id: "message-2" }],
        () =>
          [
            {
              type: "tool",
              tool: "task",
              state: {
                status: "running",
                input: { description: "Research APIs" },
                metadata: { sessionId: "child-1" },
              },
            },
          ] as unknown as Part[],
        busyStatus,
      ),
    ).toEqual([{ description: "Research APIs", status: "active", session_id: "child-1" }])
  })

  test("keeps the latest status when a child session is resumed", () => {
    const parts = [
      {
        type: "tool",
        tool: "task",
        state: {
          status: "running",
          input: { description: "Research APIs" },
          metadata: { sessionId: "child-1" },
        },
      },
      {
        type: "tool",
        tool: "task",
        state: {
          status: "completed",
          input: { description: "Research APIs" },
          title: "Research APIs",
          metadata: { sessionId: "child-1" },
        },
      },
    ] as unknown as Part[]

    expect(
      deriveSubagents([{ id: "message-1" }, { id: "message-2" }], (messageID) => [
        parts[messageID === "message-1" ? 0 : 1]!,
      ]),
    ).toEqual([{ description: "Research APIs", status: "done", session_id: "child-1" }])
    expect(
      activeSubagents(
        [{ id: "message-1" }, { id: "message-2" }],
        (messageID) => [parts[messageID === "message-1" ? 0 : 1]!],
        noStatus,
      ),
    ).toEqual([])
  })

  test("keeps multiple pending entries without session ids", () => {
    expect(
      activeSubagents(
        messages,
        () =>
          [
            {
              type: "tool",
              tool: "task",
              state: { status: "pending", input: { description: "Start worker one" }, raw: "{}" },
            },
            {
              type: "tool",
              tool: "task",
              state: { status: "pending", input: { description: "Start worker two" }, raw: "{}" },
            },
          ] as unknown as Part[],
        noStatus,
      ),
    ).toEqual([
      { description: "Start worker one", status: "pending", session_id: undefined },
      { description: "Start worker two", status: "pending", session_id: undefined },
    ])
  })

  test("renders only in-flight entries from a mixed session", () => {
    expect(
      activeSubagents(
        messages,
        () =>
          [
            {
              type: "tool",
              tool: "task",
              state: {
                status: "completed",
                input: { description: "Finished one" },
                title: "Finished one",
                metadata: { sessionId: "child-done-1" },
              },
            },
            {
              type: "tool",
              tool: "task",
              state: {
                status: "completed",
                input: { description: "Finished two" },
                title: "Finished two",
                metadata: { sessionId: "child-done-2" },
              },
            },
            {
              type: "tool",
              tool: "task",
              state: { status: "running", input: { description: "Working" }, metadata: { sessionId: "child-running" } },
            },
            {
              type: "tool",
              tool: "task",
              state: { status: "pending", input: { description: "Waiting" }, raw: "{}" },
            },
          ] as unknown as Part[],
        (sessionID) => (sessionID === "child-running" ? { type: "busy" as const } : undefined),
      ),
    ).toEqual([
      { description: "Working", status: "active", session_id: "child-running" },
      { description: "Waiting", status: "pending", session_id: undefined },
    ])
  })

  test("includes a completed background task while its child session is busy", () => {
    expect(
      activeSubagents(
        messages,
        () =>
          [
            {
              type: "tool",
              tool: "task",
              state: {
                status: "completed",
                input: { description: "Background research" },
                title: "Background research",
                metadata: { sessionId: "child-busy" },
              },
            },
          ] as unknown as Part[],
        busyStatus,
      ),
    ).toEqual([{ description: "Background research", status: "active", session_id: "child-busy" }])
  })
})

describe("sidebar subagent history", () => {
  const noChildSession = () => undefined
  const noChildMessages = () => []

  test("excludes children that are still active", () => {
    const parts = [
      {
        type: "tool",
        tool: "task",
        state: {
          status: "completed",
          input: { description: "Background research" },
          output: "",
          title: "Background research",
          metadata: { sessionId: "child-busy" },
          time: { start: 10, end: 20 },
        },
      },
      {
        type: "tool",
        tool: "task",
        state: {
          status: "completed",
          input: { description: "Finished work" },
          output: "",
          title: "Finished work",
          metadata: { sessionId: "child-idle" },
          time: { start: 30, end: 40 },
        },
      },
    ] as unknown as Part[]
    const getStatus = (sessionID: string) => (sessionID === "child-busy" ? busyStatus() : undefined)

    expect(
      recentSubagents(messages, () => parts, getStatus, { session: noChildSession, messages: noChildMessages }),
    ).toEqual([{ description: "Finished work", status: "done", session_id: "child-idle", activity: 40 }])
    expect(activeSubagents(messages, () => parts, getStatus)).toEqual([
      { description: "Background research", status: "active", session_id: "child-busy" },
    ])
  })

  test("caps history at the ten most recent subagents", () => {
    const parts = Array.from({ length: 12 }, (_, index) => ({
      type: "tool",
      tool: "task",
      state: {
        status: "completed",
        input: { description: `Child ${index}` },
        output: "",
        title: `Child ${index}`,
        metadata: { sessionId: `child-${index}` },
        time: { start: index, end: index + 1 },
      },
    })) as unknown as Part[]
    const sessions = new Map(
      Array.from({ length: 12 }, (_, index): [string, { time: { updated: number } }] => [
        `child-${index}`,
        { time: { updated: index * 10 } },
      ]),
    )

    const history = recentSubagents(messages, () => parts, noStatus, {
      session: (sessionID) => sessions.get(sessionID),
      messages: noChildMessages,
    })

    expect(history).toHaveLength(10)
    expect(history[0]).toEqual({ description: "Child 11", status: "done", session_id: "child-11", activity: 110 })
    expect(history[9]).toEqual({ description: "Child 2", status: "done", session_id: "child-2", activity: 20 })
    expect(history.some((entry) => entry.session_id === "child-1")).toBe(false)
    expect(history.some((entry) => entry.session_id === "child-0")).toBe(false)
  })

  test("sorts by child activity rather than parent part time", () => {
    const parts = [
      {
        type: "tool",
        tool: "task",
        state: {
          status: "completed",
          input: { description: "Early dispatch" },
          output: "",
          title: "Early dispatch",
          metadata: { sessionId: "child-early" },
          time: { start: 100, end: 200 },
        },
      },
      {
        type: "tool",
        tool: "task",
        state: {
          status: "completed",
          input: { description: "Late dispatch" },
          output: "",
          title: "Late dispatch",
          metadata: { sessionId: "child-late" },
          time: { start: 300, end: 400 },
        },
      },
    ] as unknown as Part[]
    const sessions = new Map<string, { time: { updated: number } }>([
      ["child-early", { time: { updated: 5000 } }],
      ["child-late", { time: { updated: 300 } }],
    ])

    expect(
      recentSubagents(messages, () => parts, noStatus, {
        session: (sessionID) => sessions.get(sessionID),
        messages: noChildMessages,
      }),
    ).toEqual([
      { description: "Early dispatch", status: "done", session_id: "child-early", activity: 5000 },
      { description: "Late dispatch", status: "done", session_id: "child-late", activity: 400 },
    ])
  })

  test("ranks by message completion when session updated time is older", () => {
    const parts = [
      {
        type: "tool",
        tool: "task",
        state: {
          status: "completed",
          input: { description: "Long runner" },
          output: "",
          title: "Long runner",
          metadata: { sessionId: "child-long" },
          time: { start: 10, end: 50 },
        },
      },
      {
        type: "tool",
        tool: "task",
        state: {
          status: "completed",
          input: { description: "Quick runner" },
          output: "",
          title: "Quick runner",
          metadata: { sessionId: "child-quick" },
          time: { start: 60, end: 100 },
        },
      },
    ] as unknown as Part[]
    const sessions = new Map<string, { time: { updated: number } }>([
      ["child-long", { time: { updated: 100 } }],
      ["child-quick", { time: { updated: 800 } }],
    ])
    const childMessages = new Map<string, Message[]>([
      ["child-long", [{ role: "assistant", time: { created: 400, completed: 900 } } as unknown as Message]],
    ])

    expect(
      recentSubagents(messages, () => parts, noStatus, {
        session: (sessionID) => sessions.get(sessionID),
        messages: (sessionID) => childMessages.get(sessionID) ?? [],
      }),
    ).toEqual([
      { description: "Long runner", status: "done", session_id: "child-long", activity: 900 },
      { description: "Quick runner", status: "done", session_id: "child-quick", activity: 800 },
    ])
  })

  test("shows a resumed child once, in history when idle and in active when busy", () => {
    const parts = [
      {
        type: "tool",
        tool: "task",
        state: {
          status: "running",
          input: { description: "Research APIs" },
          metadata: { sessionId: "child-1" },
          time: { start: 10 },
        },
      },
      {
        type: "tool",
        tool: "task",
        state: {
          status: "completed",
          input: { description: "Research APIs" },
          output: "",
          title: "Research APIs",
          metadata: { sessionId: "child-1" },
          time: { start: 20, end: 30 },
        },
      },
    ] as unknown as Part[]
    const sessionMessages = [{ id: "message-1" }, { id: "message-2" }]
    const getParts = (messageID: string) => [parts[messageID === "message-1" ? 0 : 1]!]

    expect(activeSubagents(sessionMessages, getParts, busyStatus)).toEqual([
      { description: "Research APIs", status: "active", session_id: "child-1" },
    ])
    expect(
      recentSubagents(sessionMessages, getParts, busyStatus, { session: noChildSession, messages: noChildMessages }),
    ).toEqual([])
    expect(activeSubagents(sessionMessages, getParts, noStatus)).toEqual([])
    expect(
      recentSubagents(sessionMessages, getParts, noStatus, { session: noChildSession, messages: noChildMessages }),
    ).toEqual([{ description: "Research APIs", status: "done", session_id: "child-1", activity: 30 }])
  })

  test("marks history failed from the child's errored newest assistant message", () => {
    const parts = [
      {
        type: "tool",
        tool: "task",
        state: {
          status: "completed",
          input: { description: "Run checks" },
          output: "",
          title: "Run checks",
          metadata: { sessionId: "child-1" },
          time: { start: 1, end: 2 },
        },
      },
    ] as unknown as Part[]
    const erroredLast = [
      { role: "assistant", time: { created: 5, completed: 6 } },
      { role: "assistant", time: { created: 7, completed: 8 }, error: { name: "RunError", message: "boom" } },
    ] as unknown as Message[]
    const erroredEarlier = [
      { role: "assistant", time: { created: 5, completed: 6 }, error: { name: "RunError", message: "boom" } },
      { role: "assistant", time: { created: 7, completed: 8 } },
    ] as unknown as Message[]

    expect(
      recentSubagents(messages, () => parts, noStatus, { session: noChildSession, messages: () => erroredLast }),
    ).toEqual([{ description: "Run checks", status: "failed", session_id: "child-1", activity: 8 }])
    expect(
      recentSubagents(messages, () => parts, noStatus, { session: noChildSession, messages: () => erroredEarlier }),
    ).toEqual([{ description: "Run checks", status: "done", session_id: "child-1", activity: 8 }])
  })

  test("marks history failed from an errored parent part", () => {
    const parts = [
      {
        type: "tool",
        tool: "task",
        state: {
          status: "error",
          input: { description: "Run checks" },
          error: "failed",
          metadata: { sessionId: "child-1" },
          time: { start: 1, end: 2 },
        },
      },
    ] as unknown as Part[]

    expect(
      recentSubagents(messages, () => parts, noStatus, { session: noChildSession, messages: noChildMessages }),
    ).toEqual([{ description: "Run checks", status: "failed", session_id: "child-1", activity: 2 }])
  })

  test("keeps entries without a session id out of history", () => {
    const parts = [
      {
        type: "tool",
        tool: "task",
        state: { status: "pending", input: { description: "Start worker" }, raw: "{}" },
      },
      {
        type: "tool",
        tool: "task",
        state: {
          status: "running",
          input: { description: "Working" },
          time: { start: 5 },
        },
      },
    ] as unknown as Part[]

    expect(
      recentSubagents(messages, () => parts, noStatus, { session: noChildSession, messages: noChildMessages }),
    ).toEqual([])
  })

  test("falls back to child message times when session info is unavailable", () => {
    const parts = [
      {
        type: "tool",
        tool: "task",
        state: {
          status: "completed",
          input: { description: "First" },
          output: "",
          title: "First",
          metadata: { sessionId: "child-a" },
          time: { start: 1, end: 2 },
        },
      },
      {
        type: "tool",
        tool: "task",
        state: {
          status: "completed",
          input: { description: "Second" },
          output: "",
          title: "Second",
          metadata: { sessionId: "child-b" },
          time: { start: 3, end: 4 },
        },
      },
    ] as unknown as Part[]
    const childMessages = new Map<string, Message[]>([
      ["child-a", [{ role: "assistant", time: { created: 100, completed: 200 } } as unknown as Message]],
      ["child-b", [{ role: "user", time: { created: 50 } } as unknown as Message]],
    ])

    expect(
      recentSubagents(messages, () => parts, noStatus, {
        session: noChildSession,
        messages: (sessionID) => childMessages.get(sessionID) ?? [],
      }),
    ).toEqual([
      { description: "First", status: "done", session_id: "child-a", activity: 200 },
      { description: "Second", status: "done", session_id: "child-b", activity: 50 },
    ])
  })

  test("breaks activity ties by later dispatch first", () => {
    const parts = [
      {
        type: "tool",
        tool: "task",
        state: {
          status: "completed",
          input: { description: "First" },
          output: "",
          title: "First",
          metadata: { sessionId: "child-first" },
          time: { start: 1, end: 10 },
        },
      },
      {
        type: "tool",
        tool: "task",
        state: {
          status: "completed",
          input: { description: "Second" },
          output: "",
          title: "Second",
          metadata: { sessionId: "child-second" },
          time: { start: 2, end: 20 },
        },
      },
    ] as unknown as Part[]
    const sessions = new Map<string, { time: { updated: number } }>([
      ["child-first", { time: { updated: 100 } }],
      ["child-second", { time: { updated: 100 } }],
    ])

    expect(
      recentSubagents(messages, () => parts, noStatus, {
        session: (sessionID) => sessions.get(sessionID),
        messages: noChildMessages,
      }),
    ).toEqual([
      { description: "Second", status: "done", session_id: "child-second", activity: 100 },
      { description: "First", status: "done", session_id: "child-first", activity: 100 },
    ])
  })
})

describe("sidebar subagent activity", () => {
  const oneAssistant = [{ id: "m1", role: "assistant" } as unknown as Message]

  test("running tool with title reports tool and title", () => {
    const parts = [
      {
        type: "tool",
        tool: "read",
        state: { status: "running", title: "src/foo.ts", input: {}, time: { start: 0 } },
      },
    ] as unknown as Part[]
    expect(subagentActivity(undefined, oneAssistant, () => parts)).toBe("read: src/foo.ts")
  })

  test("running tool without title falls back to the first available input target", () => {
    const parts = [
      {
        type: "tool",
        tool: "bash",
        state: { status: "running", input: { command: "bun test" }, time: { start: 0 } },
      },
    ] as unknown as Part[]
    expect(subagentActivity(undefined, oneAssistant, () => parts)).toBe("bash: bun test")
  })

  test("running tool without title or input target falls back to calling", () => {
    const parts = [
      {
        type: "tool",
        tool: "task",
        state: { status: "running", input: {}, time: { start: 0 } },
      },
    ] as unknown as Part[]
    expect(subagentActivity(undefined, oneAssistant, () => parts)).toBe("calling task")
  })

  test("retry status reports attempt count", () => {
    const retry = { type: "retry" as const, attempt: 2, message: "boom", next: 0 }
    expect(subagentActivity(retry, [], () => [])).toBe("retrying 2")
  })

  test("completed turn with no running part surfaces the latest completed tool", () => {
    const parts = [
      {
        type: "tool",
        tool: "edit",
        state: { status: "completed", title: "src/foo.ts", input: {}, output: "", time: { start: 1, end: 2 } },
      },
    ] as unknown as Part[]
    expect(subagentActivity(undefined, oneAssistant, () => parts)).toBe("edit: src/foo.ts")
  })

  test("in-progress reasoning stays quiet", () => {
    const parts = [{ type: "reasoning", text: "...", time: { start: 0 } }] as unknown as Part[]
    expect(subagentActivity(undefined, oneAssistant, () => parts)).toBeUndefined()
  })

  test("reasoning or text after a completed tool hides the finished tool", () => {
    const read = {
      type: "tool",
      tool: "read",
      state: { status: "completed", title: "old.ts", input: {}, output: "", time: { start: 1, end: 2 } },
    }
    const thinking = [read, { type: "reasoning", text: "...", time: { start: 3 } }] as unknown as Part[]
    const writing = [read, { type: "text", text: "done", time: { start: 3, end: 4 } }] as unknown as Part[]
    expect(subagentActivity(undefined, oneAssistant, () => thinking)).toBeUndefined()
    expect(subagentActivity(undefined, oneAssistant, () => writing)).toBeUndefined()
  })

  test("newest part wins when an older message holds a running tool", () => {
    const partsByMessage = (messageID: string) =>
      messageID === "m1"
        ? ([
            {
              type: "tool",
              tool: "read",
              state: { status: "running", title: "older.ts", input: {}, time: { start: 1 } },
            },
          ] as unknown as Part[])
        : ([
            {
              type: "tool",
              tool: "bash",
              state: { status: "completed", title: "newer", input: {}, output: "", time: { start: 2, end: 3 } },
            },
          ] as unknown as Part[])
    const messages = [
      { id: "m1", role: "assistant" },
      { id: "m2", role: "assistant" },
    ] as unknown as Message[]
    expect(subagentActivity(undefined, messages, partsByMessage)).toBe("bash: newer")
  })

  test("truncates long activity to roughly forty-eight characters", () => {
    const long = "x".repeat(80)
    const parts = [
      {
        type: "tool",
        tool: "read",
        state: { status: "running", title: long, input: {}, time: { start: 0 } },
      },
    ] as unknown as Part[]
    const out = subagentActivity(undefined, oneAssistant, () => parts)!
    expect(out.length).toBeLessThanOrEqual(48)
    expect(out.endsWith("…")).toBe(true)
  })

  test("no activity returns undefined", () => {
    expect(subagentActivity(undefined, [], () => [])).toBeUndefined()
    expect(subagentActivity(undefined, oneAssistant, () => [])).toBeUndefined()
  })
})

describe("sidebar active section stale-label probe", () => {
  const partsById = (id: string, source: Map<string, Part[]>): Part[] => source.get(id) ?? []

  test("a newer user message hides any older completed label", () => {
    const older = { id: "old", role: "assistant" } as unknown as Message
    const newer = { id: "new", role: "user" } as unknown as Message
    const source = new Map<string, Part[]>([
      [
        "old",
        [
          {
            type: "tool",
            tool: "read",
            state: {
              status: "completed",
              title: "old.ts",
              input: {},
              output: "",
              time: { start: 1, end: 2 },
            },
          },
        ] as unknown as Part[],
      ],
      ["new", [{ type: "text", text: "follow-up" } as unknown as Part]],
    ])
    const messages = [older, newer]
    expect(subagentActivity({ type: "busy" as const }, messages, (id) => partsById(id, source))).toBeUndefined()
  })

  test("a newer pending tool reports the calling verb, not the older completed label", () => {
    const older = { id: "old", role: "assistant" } as unknown as Message
    const newer = { id: "new", role: "assistant" } as unknown as Message
    const source = new Map<string, Part[]>([
      [
        "old",
        [
          {
            type: "tool",
            tool: "read",
            state: {
              status: "completed",
              title: "old.ts",
              input: {},
              output: "",
              time: { start: 1, end: 2 },
            },
          },
        ] as unknown as Part[],
      ],
      [
        "new",
        [
          {
            type: "tool",
            tool: "bash",
            state: { status: "pending", input: {}, raw: "{}" },
          },
        ] as unknown as Part[],
      ],
    ])
    const messages = [older, newer]
    expect(subagentActivity({ type: "busy" as const }, messages, (id) => partsById(id, source))).toBe("calling bash")
  })

  test("a newer errored tool hides every older completed label", () => {
    const older = { id: "old", role: "assistant" } as unknown as Message
    const newer = { id: "new", role: "assistant" } as unknown as Message
    const source = new Map<string, Part[]>([
      [
        "old",
        [
          {
            type: "tool",
            tool: "read",
            state: {
              status: "completed",
              title: "old.ts",
              input: {},
              output: "",
              time: { start: 1, end: 2 },
            },
          },
        ] as unknown as Part[],
      ],
      [
        "new",
        [
          {
            type: "tool",
            tool: "bash",
            state: { status: "error", input: {}, error: "boom", time: { start: 3, end: 4 } },
          },
        ] as unknown as Part[],
      ],
    ])
    const messages = [older, newer]
    expect(subagentActivity({ type: "busy" as const }, messages, (id) => partsById(id, source))).toBeUndefined()
  })
})
