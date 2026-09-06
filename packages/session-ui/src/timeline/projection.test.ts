import { describe, expect, test } from "bun:test"
import type {
  ModelRef,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from "@opencode-ai/client/promise"
import { createStore } from "solid-js/store"
import { createTimelineProjection, reuseTimelineRows, Timeline, TimelineRow, type PartGroup } from "./projection"

const context = (key: string, partIDs: string[], identity: { userMessageID?: string; messageID?: string } = {}) =>
  new TimelineRow.AssistantPart({
    userMessageID: identity.userMessageID ?? "user-1",
    group: {
      key,
      type: "context",
      refs: partIDs.map((partID) => ({ messageID: identity.messageID ?? "assistant-1", partID })),
    } satisfies PartGroup,
    previousAssistantPart: false,
  })

const patch = (key: string, partIDs: string[], userMessageID = "user-1") =>
  new TimelineRow.AssistantPart({
    userMessageID,
    group: {
      key,
      type: "file",
      refs: partIDs.map((partID) => ({ messageID: "assistant-1", partID })),
    } satisfies PartGroup,
    previousAssistantPart: false,
  })

const part = (key: string, partID: string) =>
  new TimelineRow.AssistantPart({
    userMessageID: "user-1",
    group: {
      key,
      type: "part",
      ref: { messageID: "assistant-1", partID },
    } satisfies PartGroup,
    previousAssistantPart: false,
  })

const user = (userMessageID = "user-1") => new TimelineRow.UserMessage({ userMessageID })
const keys = (rows: TimelineRow.TimelineRow[]) => rows.map(TimelineRow.key)

describe("Timeline.resolveContent", () => {
  const assistant = (content: SessionMessageAssistant["content"]): SessionMessageAssistant => ({
    id: "assistant",
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content,
    time: { created: 0 },
  })
  const tool = (id: string): SessionMessageAssistantTool => ({
    id,
    type: "tool",
    name: "read",
    state: { status: "running", input: {}, metadata: {} },
    time: { created: 0 },
  })

  test("resolves interleaved ordinals and current store references", () => {
    const [store, setStore] = createStore({
      message: assistant([
        { type: "text", text: "" },
        { type: "reasoning", text: "", time: { created: 0 } },
        tool("read"),
        { type: "text", text: "answer" },
        { type: "reasoning", text: "thought", time: { created: 0 } },
      ]),
    })
    expect(Timeline.resolveContent(store.message, "assistant:text:0")).toBe(store.message.content[0])
    expect(Timeline.resolveContent(store.message, "assistant:reasoning:0")).toBe(store.message.content[1])
    expect(Timeline.resolveContent(store.message, "read")).toBe(store.message.content[2])
    expect(Timeline.resolveContent(store.message, "assistant:text:1")).toBe(store.message.content[3])
    expect(Timeline.resolveContent(store.message, "assistant:reasoning:1")).toBe(store.message.content[4])
    const original = store.message.content[3]
    setStore("message", "content", 3, { type: "text", text: "updated" })
    expect(Timeline.resolveContent(store.message, "assistant:text:1")).toBe(original)
    expect(Timeline.resolveContent(store.message, "assistant:text:1")).toMatchObject({ text: "updated" })

    setStore("message", "content", () => [{ type: "text" as const, text: "replacement" }, tool("replacement-tool")])
    expect(Timeline.resolveContent(store.message, "assistant:text:0")).toBe(store.message.content[0])
    expect(Timeline.resolveContent(store.message, "replacement-tool")).toBe(store.message.content[1])
    expect(Timeline.resolveContent(store.message, "read")).toBeUndefined()
    expect(Timeline.resolveContent(store.message, "assistant:text:1")).toBeUndefined()
  })

  test("stops reading as soon as the part is found", () => {
    const message = assistant([tool("first")])
    message.content.push({
      get type(): "text" {
        throw new Error("read past the matching part")
      },
      text: "later",
    })
    expect(Timeline.resolveContent(message, "first")).toBe(message.content[0])
  })
})

describe("reuseTimelineRows", () => {
  test.each([
    {
      name: "reuses an unchanged context group",
      previous: [context("context:a", ["a", "b"])],
      rows: [context("context:a", ["a", "b"])],
      expected: ["assistant-part:context:context:a"],
      reused: [[0, 0]],
    },
    {
      name: "preserves the group key when a member is appended",
      previous: [context("context:a", ["a"])],
      rows: [context("context:a", ["a", "b"])],
      expected: ["assistant-part:context:context:a"],
      reused: [],
    },
    {
      name: "preserves a patch group key when a member is appended",
      previous: [patch("patch:a", ["a"])],
      rows: [patch("patch:a", ["a", "b"])],
      expected: ["assistant-part:file:patch:a"],
      reused: [],
    },
    {
      name: "preserves the group key when the first member is removed",
      previous: [context("context:a", ["a", "b"])],
      rows: [context("context:b", ["b"])],
      expected: ["assistant-part:context:context:a"],
      reused: [],
    },
    {
      name: "lets only the natural owner retain an old key after a split",
      previous: [context("context:a", ["a", "b"])],
      rows: [context("context:a", ["a"]), context("context:b", ["b"])],
      expected: ["assistant-part:context:context:a", "assistant-part:context:context:b"],
      reused: [],
    },
    {
      name: "preserves the file group identity when its first member becomes standalone",
      previous: [patch("part:a", ["a", "b"])],
      rows: [part("part:a", "a"), patch("part:b", ["b"])],
      expected: ["assistant-part:part:part:a", "assistant-part:file:part:a"],
      reused: [],
    },
    {
      name: "preserves the file group identity before a later standalone member",
      previous: [patch("part:a", ["a", "b"])],
      rows: [patch("part:b", ["b"]), part("part:a", "a")],
      expected: ["assistant-part:file:part:a", "assistant-part:part:part:a"],
      reused: [],
    },
    {
      name: "chooses the earliest prior key when groups merge",
      previous: [context("context:a", ["a"]), context("context:b", ["b"])],
      rows: [context("context:b", ["b", "a"])],
      expected: ["assistant-part:context:context:a"],
      reused: [],
    },
    {
      name: "reserves an old key for its natural owner when two new groups compete",
      previous: [context("context:a", ["a", "b"])],
      rows: [context("context:b", ["b"]), context("context:a", ["a"])],
      expected: ["assistant-part:context:context:b", "assistant-part:context:context:a"],
      reused: [],
    },
    {
      // A history prepend can regroup a page-boundary turn under its real user
      // message; the same parts must keep their identity across that move.
      name: "reuses context identity when the same parts move to another user message",
      previous: [context("context:a", ["a", "b"], { userMessageID: "user-1" })],
      rows: [context("context:b", ["b"], { userMessageID: "user-2" })],
      expected: ["assistant-part:context:context:a"],
      reused: [],
    },
    {
      name: "does not reuse context identity across assistant messages",
      previous: [context("context:assistant-1:a", ["a"], { messageID: "assistant-1" })],
      rows: [context("context:assistant-2:a", ["a"], { messageID: "assistant-2" })],
      expected: ["assistant-part:context:context:assistant-2:a"],
      reused: [],
    },
    {
      name: "reuses an unaffected ordinary row",
      previous: [user()],
      rows: [user()],
      expected: ["user-message:user-1"],
      reused: [[0, 0]],
    },
    {
      name: "does not create accidental key collisions",
      previous: [context("context:a", ["a", "b", "c"])],
      rows: [context("context:b", ["b"]), context("context:a", ["a"]), context("context:c", ["c"])],
      expected: [
        "assistant-part:context:context:b",
        "assistant-part:context:context:a",
        "assistant-part:context:context:c",
      ],
      reused: [],
    },
  ])("$name", ({ previous, rows, expected, reused }) => {
    const result = reuseTimelineRows([...previous], [...rows])

    expect(keys(result)).toEqual([...expected])
    expect(new Set(keys(result)).size).toBe(result.length)
    reused.forEach(([resultIndex, previousIndex]) => expect(result[resultIndex]).toBe(previous[previousIndex]))
  })
})

describe("createTimelineProjection", () => {
  test("builds current message, parent, context, and row indexes", () => {
    const selectedModel = { id: "selected", providerID: "provider" } satisfies ModelRef
    const assistantModel = { id: "assistant", providerID: "provider", variant: "fast" } satisfies ModelRef
    const messages = [
      { id: "agent", type: "agent-switched", agent: "explore", time: { created: 1 } },
      { id: "model", type: "model-switched", model: selectedModel, time: { created: 2 } },
      { id: "user-1", type: "user", text: "first", time: { created: 3 } },
      {
        id: "assistant-1",
        type: "assistant",
        agent: "build",
        model: assistantModel,
        content: [{ type: "text", text: "answer" }],
        time: { created: 4, completed: 5 },
      },
      {
        id: "user-2",
        type: "user",
        text: "second",
        metadata: {
          agent: "review",
          model: { modelID: "override", providerID: "custom", variant: "precise" },
        },
        time: { created: 6 },
      },
    ] satisfies SessionMessageInfo[]

    const result = createTimelineProjection({
      sessionMessages: messages,
      status: { type: "busy" },
      reasoningMode: "full",
    })

    expect(result.activeMessageID).toBe("user-2")
    expect(result.messageByID).toBe(result.sessionMessageByID)
    expect(result.sessionMessageByID.get("assistant-1")).toBe(messages[3])
    expect(result.assistantMessagesByParent.get("user-1")?.map((message) => message.id)).toEqual(["assistant-1"])
    expect(result.assistantMessagesByParent.has("user-2")).toBe(false)
    expect(result.userContextByID.get("user-1")).toEqual({ agent: "build", model: assistantModel })
    expect(result.userContextByID.get("user-2")).toEqual({
      agent: "review",
      model: { id: "override", providerID: "custom", variant: "precise" },
    })
    expect(result.messageRowIndex.get("user-1")).toBe(0)
    expect(result.messageLastRowIndex.get("user-1")).toBe(3)
    expect(result.lastAssistantGroupKey.get("user-1")).toBe("part:assistant-1:assistant-1:text:0")
    expect(result.rowByKey.get("user-message:user-1")).toBe(result.rows[2])
  })

  test("reuses a stable projected row array", () => {
    const messages = [
      { id: "user-1", type: "user", text: "first", time: { created: 1 } },
      {
        id: "assistant-1",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "answer" }],
        time: { created: 2, completed: 3 },
      },
    ] satisfies SessionMessageInfo[]
    const first = createTimelineProjection({
      sessionMessages: messages,
      status: { type: "idle" },
      reasoningMode: "full",
    })
    const second = createTimelineProjection({
      sessionMessages: messages,
      status: { type: "idle" },
      reasoningMode: "full",
      previousRows: first.rows,
    })

    expect(second.rows).toBe(first.rows)
    expect(second.rows[0]).toBe(first.rows[0])
    expect(second.rows[1]).toBe(first.rows[1])
  })

  test("indexes a leading partial assistant turn under its projected turn ID", () => {
    const messages = [
      {
        id: "assistant-1",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "partial answer" }],
        time: { created: 2, completed: 3 },
      },
      {
        id: "assistant-2",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "final answer" }],
        time: { created: 4, completed: 5 },
      },
    ] satisfies SessionMessageInfo[]

    const result = createTimelineProjection({
      sessionMessages: messages,
      status: { type: "idle" },
      reasoningMode: "full",
    })

    expect(result.assistantMessagesByParent.get("assistant-1")?.map((message) => message.id)).toEqual([
      "assistant-1",
      "assistant-2",
    ])
  })
})
