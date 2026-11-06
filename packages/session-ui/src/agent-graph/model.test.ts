import type {
  AgentID,
  SessionID,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from "@opencode/client/promise"
import { describe, expect, test } from "bun:test"
import { agentGraph, messagesFor, subtreeUsage, totalTokens, usageByAgent, type TunnelMessage } from "./model"

const model = { id: "model", providerID: "provider" }

const tokens = (total: number) => ({ input: total, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })

const session = (id: string, fields: Partial<SessionInfo> = {}): SessionInfo => ({
  id,
  projectID: "prj",
  cost: 0,
  tokens: tokens(0),
  time: { created: 1000, updated: 1000 },
  location: { directory: "/tmp/project" },
  ...fields,
})

// The `subagent` tool part that names a child session (packages/core/src/tool/plugin/subagent.ts).
const subagent = (child: string, fields: Partial<SessionMessageAssistantTool> = {}): SessionMessageAssistantTool => ({
  type: "tool",
  id: `call_${child}`,
  name: "subagent",
  state: {
    status: "completed",
    input: { agent: "explore", description: "Find the bug" },
    content: [{ type: "text", text: "done" }],
    metadata: { sessionID: child },
  },
  time: { created: 1000, ran: 1100, completed: 1200 },
  ...fields,
})

const assistant = (
  content: SessionMessageAssistant["content"],
  fields: Partial<SessionMessageAssistant> = {},
): SessionMessageAssistant => ({
  id: "msg_1",
  type: "assistant",
  agent: "build",
  model,
  content,
  time: { created: 1000 },
  ...fields,
})

const message = (fields: Partial<TunnelMessage>): TunnelMessage => ({
  id: "msg_1",
  from: { sessionID: "ses_child", agent: "explore" },
  to: { sessionID: "ses_root", agent: "build" },
  kind: "message",
  body: "Found it",
  time: { created: 2000 },
  sequence: 1,
  ...fields,
})

const graph = (sessions: SessionInfo[], sessionID: SessionID | undefined, extra: Partial<Parameters<typeof agentGraph>[0]> = {}) =>
  agentGraph({
    sessions,
    sessionID,
    status: () => "idle",
    agents: [
      { id: "build", name: "Build" },
      { id: "explore", name: "Explore", color: "#f00" },
    ],
    ...extra,
  })

describe("agentGraph", () => {
  test("returns an empty graph for an unknown or missing session", () => {
    const root = session("ses_root")

    expect(graph([root], "ses_missing")).toEqual({ rootID: undefined, nodes: [], edges: [] })
    expect(graph([root], undefined)).toEqual({ rootID: undefined, nodes: [], edges: [] })
    expect(graph([], "ses_root")).toEqual({ rootID: undefined, nodes: [], edges: [] })
  })

  test("maps one root session to a single idle node", () => {
    const root = session("ses_root", { title: "Main thread", agent: "build", cost: 3, tokens: tokens(100) })

    expect(graph([root], "ses_root")).toEqual({
      rootID: "ses_root",
      nodes: [
        {
          id: "ses_root",
          parentID: undefined,
          label: "Main thread",
          agent: "build",
          agentName: "Build",
          agentColor: undefined,
          status: "idle",
          model: undefined,
          tokens: 100,
          cost: 3,
          description: undefined,
          started: 1000,
        },
      ],
      edges: [],
    })
  })

  test("walks up to the family root and lays out its descendants breadth-first", () => {
    const root = session("ses_root")
    const child = session("ses_child", { parentID: "ses_root" })
    const grandchild = session("ses_grand", { parentID: "ses_child" })
    const other = session("ses_other")

    expect(graph([other, grandchild, child, root], "ses_grand").nodes.map((node) => node.id)).toEqual([
      "ses_root",
      "ses_child",
      "ses_grand",
    ])
  })

  test("labels spawn edges from subagent tool parts and keeps the family running state", () => {
    const root = session("ses_root", { title: "Main thread", agent: "build" })
    const child = session("ses_child", { parentID: "ses_root" })

    // The child has no title yet, so the spawning call's description names it.
    const value = graph([root, child], "ses_root", {
      status: (id) => (id === "ses_child" ? "running" : "idle"),
      messages: (id) => (id === "ses_root" ? [assistant([subagent("ses_child")])] : []),
    })

    expect(value.nodes.map((node) => [node.id, node.status, node.label])).toEqual([
      ["ses_root", "idle", "Main thread"],
      ["ses_child", "running", "Find the bug"],
    ])
    expect(value.nodes[1]).toMatchObject({ agent: undefined, description: "Find the bug", started: 1100 })
    expect(value.edges).toEqual([
      { type: "spawn", from: "ses_root", to: "ses_child", agent: "explore", label: "Find the bug", started: 1100 },
    ])
  })

  test("the latest subagent call for a child wins the edge label", () => {
    const root = session("ses_root", { agent: "build" })
    const child = session("ses_child", { parentID: "ses_root" })
    const retry = subagent("ses_child", {
      id: "call_2",
      state: { status: "completed", input: { agent: "plan", description: "Narrow it down" }, content: [{ type: "text", text: "done" }], metadata: { sessionID: "ses_child" } },
    })

    const value = graph([root, child], "ses_root", {
      messages: (id) => (id === "ses_root" ? [assistant([subagent("ses_child")], { id: "msg_1" }), assistant([retry], { id: "msg_2" })] : []),
    })

    expect(value.edges).toEqual([
      { type: "spawn", from: "ses_root", to: "ses_child", agent: "plan", label: "Narrow it down", started: 1100 },
    ])
  })

  test("aggregates tunnel messages per ordered pair and kind, keeping the count and the last", () => {
    const root = session("ses_root", { agent: "build" })
    const child = session("ses_child", { parentID: "ses_root", agent: "explore" })
    const sibling = session("ses_sib", { parentID: "ses_root" })
    const toParent = message({ kind: "report" })
    const lastReport = message({ id: "msg_2", kind: "report", body: "Fixed it", time: { created: 2500 }, sequence: 2 })

    const value = graph([root, child, sibling], "ses_child", {
      tunnelMessages: [
        message({ id: "msg_3", from: { sessionID: "ses_root", agent: "build" }, to: { sessionID: "ses_sib" }, kind: "message", body: "Go", time: { created: 3000 }, sequence: 2 }),
        toParent,
        lastReport,
        // Between a family member and a session outside the family: no edge.
        message({ id: "msg_4", to: { sessionID: "ses_other" }, body: "Off screen" }),
      ],
    })

    expect(value.edges.filter((edge) => edge.type === "message")).toEqual([
      { type: "message", from: "ses_child", to: "ses_root", kind: "report", count: 2, last: lastReport },
      {
        type: "message",
        from: "ses_root",
        to: "ses_sib",
        kind: "message",
        count: 1,
        last: message({ id: "msg_3", from: { sessionID: "ses_root", agent: "build" }, to: { sessionID: "ses_sib" }, kind: "message", body: "Go", time: { created: 3000 }, sequence: 2 }),
      },
    ])
  })

  test("messagesFor lists a pair's messages oldest first, ordered by time then sequence", () => {
    const items = [
      message({ id: "msg_2", time: { created: 2000 }, sequence: 3 }),
      message({ id: "msg_1", time: { created: 2000 }, sequence: 1 }),
      message({ id: "msg_0", time: { created: 1000 }, sequence: 9 }),
      message({ id: "msg_x", from: { sessionID: "ses_root" }, to: { sessionID: "ses_child" } }),
    ]

    expect(messagesFor(items, "ses_child", "ses_root").map((item) => item.id)).toEqual(["msg_0", "msg_1", "msg_2"])
  })

  test("a malformed parent cycle terminates and still yields its nodes", () => {
    const a = session("ses_a", { parentID: "ses_b" })
    const b = session("ses_b", { parentID: "ses_a" })

    expect(graph([a, b], "ses_a").nodes.map((node) => node.id).sort()).toEqual(["ses_a", "ses_b"])
  })
})

describe("usageByAgent", () => {
  const step = (agent: AgentID, cost?: number, total?: number): SessionMessageInfo => ({
    id: "msg_step",
    type: "assistant",
    agent,
    model,
    content: [],
    cost,
    tokens: total === undefined ? undefined : tokens(total),
    time: { created: 1000 },
  })

  test("folds assistant steps, tokens and cost per agent, skipping other message types", () => {
    const user = { id: "msg_user", type: "user" } as unknown as SessionMessageInfo

    const value = usageByAgent([step("build", 2, 100), user, step("explore", 1, 50), step("build", 3, 30)])

    expect(value).toEqual([
      { agent: "build", steps: 2, tokens: 130, cost: 5 },
      { agent: "explore", steps: 1, tokens: 50, cost: 1 },
    ])
  })

  test("missing usage reads as zero", () => {
    expect(usageByAgent([step("build")])).toEqual([{ agent: "build", steps: 1, tokens: 0, cost: 0 }])
  })
})

describe("subtreeUsage", () => {
  test("rolls up tokens, cost and session count of the subtree including the root", () => {
    const root = session("ses_root", { cost: 1, tokens: tokens(10) })
    const child = session("ses_child", { parentID: "ses_root", cost: 2, tokens: tokens(20) })
    const grandchild = session("ses_grand", { parentID: "ses_child", cost: 4, tokens: tokens(40) })
    const unrelated = session("ses_other", { cost: 8, tokens: tokens(80) })

    expect(subtreeUsage([unrelated, grandchild, child, root], "ses_child")).toEqual({ sessions: 2, tokens: 60, cost: 6 })
    expect(subtreeUsage([unrelated, grandchild, child, root], "ses_root")).toEqual({ sessions: 3, tokens: 70, cost: 7 })
  })

  test("an unknown root reads as zero", () => {
    expect(subtreeUsage([session("ses_root")], "ses_missing")).toEqual({ sessions: 0, tokens: 0, cost: 0 })
    expect(subtreeUsage([session("ses_root")], undefined)).toEqual({ sessions: 0, tokens: 0, cost: 0 })
  })
})

describe("totalTokens", () => {
  test("sums input, output, reasoning and cache reads and writes", () => {
    expect(totalTokens({ input: 1, output: 2, reasoning: 4, cache: { read: 8, write: 16 } })).toBe(31)
  })
})
