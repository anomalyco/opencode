import { describe, expect, test } from "bun:test"
import type { JsonValue, SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import {
  childHref,
  childrenOf,
  childStatus,
  deriveStatus,
  filterAgents,
  formatElapsed,
  formatRelative,
  formatTokens,
  latestActivity,
  lastResponse,
  partBackgrounded,
  sortAgents,
  stripSubagentSuffix,
  subagentDescriptions,
  subagentTasks,
  taskStatus,
  tokenTotal,
  treeCost,
  childrenCost,
  toolSessionID,
} from "./status"

function tool(
  state: SessionMessageAssistantTool["state"],
  overrides?: Partial<Pick<SessionMessageAssistantTool, "id" | "name">>,
): SessionMessageAssistantTool {
  return {
    type: "tool",
    id: "part-1",
    name: "subagent",
    time: { created: 1 },
    state,
    ...overrides,
  }
}

function assistant(parts: SessionMessageAssistantTool[]) {
  return {
    id: "message-1",
    type: "assistant" as const,
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content: parts,
    time: { created: 1 },
  }
}

function completedMessage(parts: SessionMessageAssistantTool[]) {
  return { ...assistant(parts), time: { created: 1, completed: 2 } }
}

describe("taskStatus", () => {
  test("running and streaming parts are running", () => {
    expect(taskStatus(tool({ status: "running", input: {}, metadata: {} }))).toBe("running")
    expect(taskStatus(tool({ status: "streaming", input: "..." }))).toBe("running")
  })
  test("completed parts are completed", () => {
    expect(
      taskStatus(tool({ status: "completed", input: {}, content: [{ type: "text", text: "done" }] })),
    ).toBe("completed")
  })
  test("aborted errors are cancelled", () => {
    expect(
      taskStatus(tool({ status: "error", input: {}, error: { type: "aborted", message: "stopped" } })),
    ).toBe("cancelled")
  })
  test("interrupted metadata is cancelled", () => {
    expect(
      taskStatus(
        tool({
          status: "error",
          input: {},
          error: { type: "failed", message: "x" },
          metadata: { interrupted: true },
        }),
      ),
    ).toBe("cancelled")
  })
  test("other errors are errors", () => {
    expect(taskStatus(tool({ status: "error", input: {}, error: { type: "failed", message: "boom" } }))).toBe("error")
  })
})

describe("partBackgrounded", () => {
  test("completed parts with a running metadata status are backgrounded", () => {
    expect(
      partBackgrounded(
        tool({ status: "completed", input: {}, content: [{ type: "text", text: "x" }], metadata: { status: "running" } }),
      ),
    ).toBe(true)
    expect(
      partBackgrounded(tool({ status: "completed", input: {}, content: [{ type: "text", text: "x" }] })),
    ).toBe(false)
    expect(partBackgrounded(tool({ status: "running", input: {}, metadata: {} }))).toBe(false)
  })
})

describe("toolSessionID", () => {
  test("reads sessionID then the legacy sessionId spelling", () => {
    expect(toolSessionID(tool({ status: "running", input: {}, metadata: { sessionID: "child-1" } }))).toBe("child-1")
    expect(toolSessionID(tool({ status: "running", input: {}, metadata: { sessionId: "child-2" } }))).toBe("child-2")
  })
  test("missing and blank ids are undefined", () => {
    expect(toolSessionID(tool({ status: "streaming", input: "..." }))).toBeUndefined()
    expect(toolSessionID(tool({ status: "running", input: {}, metadata: { sessionID: "  " } }))).toBeUndefined()
  })
})

describe("subagentTasks", () => {
  test("keys terminal parts by child id with last write winning", () => {
    const first = tool({ status: "running", input: {}, metadata: { sessionID: "child" } }, { id: "a" })

    const second = tool(
      {
        status: "completed",
        input: {},
        content: [{ type: "text", text: "done" }],
        metadata: { sessionID: "child" },
      },
      { id: "b" },
    )

    const shell = tool({ status: "running", input: {}, metadata: {} }, { id: "c", name: "shell" })
    const tasks = subagentTasks([completedMessage([first]), assistant([shell, second])])
    expect(tasks.parts.get("child")).toBe(second)
    expect(tasks.parts.has("c")).toBe(false)
  })
  test("running parts outside the latest uncompleted message are stale", () => {
    const stale = tool({ status: "running", input: {}, metadata: { sessionID: "old" } })
    const tasks = subagentTasks([completedMessage([stale]), assistant([])])
    expect(tasks.parts.has("old")).toBe(false)
    expect(tasks.blocking).toEqual([])
  })
  test("running parts surface as blocking calls", () => {
    const claimed = tool(
      { status: "running", input: { description: "Explore" }, metadata: { sessionID: "child" } },
      { id: "a" },
    )

    const unclaimed = tool({ status: "running", input: { description: "Fresh call" }, metadata: {} }, { id: "b" })
    const tasks = subagentTasks([assistant([claimed, unclaimed])])
    expect(tasks.parts.get("child")).toBe(claimed)
    expect(tasks.blocking).toEqual([
      { partID: "a", childID: "child", label: "Explore" },
      { partID: "b", childID: undefined, label: "Fresh call" },
    ])
  })
  test("backgrounded completions drop once the synthetic notice lands", () => {
    const backgrounded = tool(
      {
        status: "completed",
        input: {},
        content: [{ type: "text", text: "done" }],
        metadata: { sessionID: "child", status: "running" },
      },
      { id: "a" },
    )

    const notice = { id: "n1", type: "synthetic", metadata: { source: "subagent", childID: "child" }, text: "", time: { created: 2 } } as const
    expect(subagentTasks([completedMessage([backgrounded])]).parts.has("child")).toBe(true)
    expect(subagentTasks([completedMessage([backgrounded]), notice]).parts.has("child")).toBe(false)
  })
  test("legacy task parts join too", () => {
    const legacy = tool({ status: "running", input: {}, metadata: { sessionID: "old" } }, { name: "task" })
    const tasks = subagentTasks([assistant([legacy])])
    expect(tasks.parts.has("old")).toBe(true)
    expect(tasks.blocking).toHaveLength(1)
  })
})

describe("subagentDescriptions", () => {
  test("maps child ids to task descriptions", () => {
    const part = tool({ status: "running", input: { description: "Explore auth" }, metadata: { sessionID: "child" } })
    expect(subagentDescriptions([assistant([part])]).get("child")).toBe("Explore auth")
  })
})

describe("childrenOf", () => {
  test("filters by parent and sorts by id", () => {
    const sessions = [{ id: "b", parentID: "parent" }, { id: "root" }, { id: "a", parentID: "parent" }]
    expect(childrenOf(sessions, "parent").map((session) => session.id)).toEqual(["a", "b"])
  })
})

describe("deriveStatus", () => {
  test("a running part means work in flight", () => {
    expect(deriveStatus({ part: "running", backgrounded: false, running: false, outcome: undefined })).toBe("busy")
  })
  test("a backgrounded completion without an outcome is still active", () => {
    expect(deriveStatus({ part: "completed", backgrounded: true, running: false, outcome: undefined })).toBe("busy")
  })
  test("the outcome settles everything else", () => {
    expect(deriveStatus({ part: "completed", backgrounded: true, running: false, outcome: "succeeded" })).toBe("completed")
    expect(deriveStatus({ part: "completed", backgrounded: false, running: false, outcome: "failed" })).toBe("error")
    expect(deriveStatus({ part: undefined, running: true, outcome: undefined, backgrounded: false })).toBe("busy")
    expect(deriveStatus({ part: "cancelled", backgrounded: false, running: false, outcome: "succeeded" })).toBe("completed")
  })
  test("terminal parts and outcomes fall through in order", () => {
    expect(deriveStatus({ part: "completed", backgrounded: false, running: false, outcome: undefined })).toBe("completed")
    expect(deriveStatus({ part: undefined, running: false, outcome: "interrupted", backgrounded: false })).toBe("cancelled")
    expect(deriveStatus({ part: undefined, running: false, outcome: "failed", backgrounded: false })).toBe("error")
    expect(deriveStatus({ part: undefined, running: false, outcome: "succeeded", backgrounded: false })).toBe("completed")
    expect(deriveStatus({ part: undefined, running: false, outcome: undefined, backgrounded: false })).toBe("idle")
  })
})

describe("childStatus", () => {
  test("joins part, liveness and outcome", () => {
    const running = tool({ status: "running", input: {}, metadata: { sessionID: "c" } })
    expect(childStatus({ part: running, running: false, outcome: undefined })).toBe("busy")

    const backgrounded = tool({
      status: "completed",
      input: {},
      content: [{ type: "text", text: "x" }],
      metadata: { sessionID: "c", status: "running" },
    })

    expect(childStatus({ part: backgrounded, running: false, outcome: undefined })).toBe("busy")
    expect(childStatus({ part: backgrounded, running: false, outcome: "succeeded" })).toBe("completed")
    expect(childStatus({ part: undefined, running: false, outcome: undefined })).toBe("idle")
  })
})

describe("formatting", () => {
  test("tree cost adds the owner once plus every child", () => {
    expect(treeCost(159.13, [{ cost: 0.5 }, { cost: 0.25 }, { cost: 0 }])).toBeCloseTo(159.88, 2)
    expect(treeCost(undefined, [])).toBe(0)
    expect(treeCost(10, [])).toBe(10)
  })
  test("children cost never includes the owner", () => {
    expect(childrenCost([{ cost: 0.5 }, { cost: 0.25 }, { cost: 0 }])).toBeCloseTo(0.75, 2)
    expect(childrenCost([])).toBe(0)
  })
  test("token totals include every bucket", () => {
    expect(tokenTotal({ input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } })).toBe(15)
  })
  test("token labels compact thousands", () => {
    expect(formatTokens(999)).toBe("999")
    expect(formatTokens(1500)).toBe("1.5k")
    expect(formatTokens(2_500_000)).toBe("2.5M")
  })
  test("child links address the same server route", () => {
    expect(childHref("test", "child-1")).toBe("/server/dGVzdA/session/child-1")
  })
  test("titles lose the subagent suffix", () => {
    expect(stripSubagentSuffix("Explore auth (@build subagent)")).toBe("Explore auth")
    expect(stripSubagentSuffix("Plain title")).toBe("Plain title")
  })
})

describe("sortAgents", () => {
  const sessions = [
    { id: "a", cost: 3, tokens: { input: 1, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, title: "Zulu", time: { created: 1000 } },
    { id: "b", cost: 1, tokens: { input: 9, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, title: "Alpha", time: { created: 3000 } },
    { id: "c", cost: 2, tokens: { input: 5, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, title: "Mike", time: { created: 2000 } },
  ]

  const name = (id: string) => sessions.find((session) => session.id === id)?.title ?? id

  test("recent defaults to newest first", () => {
    expect(sortAgents(sessions, { sort: "recent", ascending: false, name }).map((session) => session.id)).toEqual([
      "b",
      "c",
      "a",
    ])
    expect(sortAgents(sessions, { sort: "recent", ascending: true, name }).map((session) => session.id)).toEqual([
      "a",
      "c",
      "b",
    ])
  })
  test("cost, tokens and name order correctly", () => {
    expect(sortAgents(sessions, { sort: "cost", ascending: false, name }).map((session) => session.id)).toEqual([
      "a",
      "c",
      "b",
    ])
    expect(sortAgents(sessions, { sort: "tokens", ascending: false, name }).map((session) => session.id)).toEqual([
      "b",
      "c",
      "a",
    ])
    expect(sortAgents(sessions, { sort: "name", ascending: true, name }).map((session) => session.id)).toEqual([
      "b",
      "c",
      "a",
    ])
  })
})

describe("filterAgents", () => {
  const sessions = [
    { id: "abc", cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, title: "Explore auth", time: { created: 1 }, model: { id: "m1", providerID: "test" } },
  ]

  test("matches titles, models and ids case-insensitively", () => {
    const name = () => "Explore auth"
    expect(filterAgents(sessions, "", name)).toHaveLength(1)
    expect(filterAgents(sessions, "explore", name)).toHaveLength(1)
    expect(filterAgents(sessions, "TEST/M1", name)).toHaveLength(1)
    expect(filterAgents(sessions, "ABC", name)).toHaveLength(1)
    expect(filterAgents(sessions, "missing", name)).toHaveLength(0)
  })
})

describe("clocks", () => {
  test("elapsed compacts hours, minutes and seconds", () => {
    expect(formatElapsed(0, 45_000)).toBe("45s")
    expect(formatElapsed(0, 756_000)).toBe("12m 36s")
    expect(formatElapsed(0, 11_139_000)).toBe("3h 05m 39s")
  })
  test("relative stamps degrade gracefully", () => {
    expect(formatRelative(0, 2_000, "en")).toBe("2s ago")
    expect(formatRelative(0, 1_080_000, "en")).toBe("18m ago")
    expect(formatRelative(0, 10_800_000, "en")).toBe("3h ago")
  })
})

describe("transcript detail", () => {
  const activityPart = (id: string, name: string, input: { [x: string]: JsonValue }, at: number) => ({
    type: "tool",
    id,
    name,
    state: { status: "completed", input, content: [{ type: "text", text: "x" }] },
    time: { created: at, completed: at },
  }) satisfies SessionMessageAssistantTool

  const assistantMessage = (id: string, content: SessionMessageAssistant["content"], at: number, done: boolean) => ({
    id,
    type: "assistant",
    agent: "build",
    model: { id: "m", providerID: "p" },
    content,
    time: done ? { created: at, completed: at + 500 } : { created: at },
  }) satisfies SessionMessageInfo

  test("latest activity walks newest tool calls first", () => {
    const messages = [
      assistantMessage(
        "m1",
        [
          activityPart("a", "edit", { path: "src/a.ts" }, 1000),
          activityPart("b", "grep", { pattern: "session" }, 2000),
        ],
        1000,
        true,
      ),
    ]

    expect(latestActivity(messages)).toEqual([
      { tool: "grep", target: "session", at: 2000 },
      { tool: "edit", target: "src/a.ts", at: 1000 },
    ])
    expect(latestActivity(messages, 1)).toHaveLength(1)
  })

  test("last response returns the newest assistant text", () => {
    const messages = [
      assistantMessage("m1", [{ type: "text", text: "First." }], 1000, true),
      assistantMessage("m2", [{ type: "text", text: "Second." }], 2000, true),
    ]

    expect(lastResponse(messages)).toBe("Second.")
    expect(lastResponse([])).toBeUndefined()
  })
})
