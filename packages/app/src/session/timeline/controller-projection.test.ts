import { describe, expect, test } from "bun:test"
import type { SessionInboxInfo, SessionMessageInfo } from "@opencode/client/promise"
import { createRoot } from "solid-js"
import { applyTimelineMessageHandoff, visibleTimelineMessages } from "./controller-projection"
import { createTimelineProjection } from "./projection"
import { timelinePresets } from "@opencode/session-ui/timeline/detail"

const messages = [
  { id: "msg_1", type: "user", text: "first", time: { created: 1 } },
  {
    id: "msg_2",
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content: [],
    time: { created: 2 },
  },
  { id: "msg_3", type: "user", text: "queued", time: { created: 3 } },
  { id: "msg_4", type: "user", text: "reverted", time: { created: 4 } },
] satisfies SessionMessageInfo[]

describe("visibleTimelineMessages", () => {
  const steer = {
    id: "msg_3",
    sessionID: "ses_1",
    time: { created: 3 },
    type: "user",
    delivery: "steer",
    payload: { text: "queued" },
  } satisfies SessionInboxInfo

  const work = {
    id: "msg_5",
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content: [
      {
        type: "tool",
        id: "tool_read",
        name: "read",
        state: {
          status: "completed",
          input: { filePath: "src/example.ts" },
          content: [{ type: "text", text: "export const example = true" }],
          metadata: {},
        },
        time: { created: 5, completed: 6 },
      },
    ],
    time: { created: 5, completed: 6 },
  } satisfies SessionMessageInfo

  test("keeps work above an undelivered steer without adding a thinking row", () => {
    const source = [...messages.slice(0, 3), work]
    const visible = visibleTimelineMessages(source, [steer])
    expect(visible.map((message) => message.id)).toEqual(["msg_1", "msg_2", "msg_5", "msg_3"])
    expect(source.map((message) => message.id)).toEqual(["msg_1", "msg_2", "msg_3", "msg_5"])
    expect(visible[2]).toBe(work)

    createRoot((dispose) => {
      const projection = createTimelineProjection({
        sessionMessages: () => visible,
        status: () => ({ type: "busy" }),
        reasoningMode: () => "compact",
        shellToolDefaultOpen: () => false,
        editToolDefaultOpen: () => false,
        timelineDetail: () => timelinePresets[2].value,
        pendingInputIDs: () => new Set([steer.id]),
      })

      expect(projection.activeMessageID()).toBe("msg_1")
      expect(projection.rows().map((row) => [row._tag, row.userMessageID])).toEqual([
        ["UserMessage", "msg_1"],
        ["AssistantPart", "msg_1"],
        ["TurnGap", "msg_3"],
        ["UserMessage", "msg_3"],
      ])
      expect(
        projection
          .assistantMessagesByParent()
          .get("msg_1")
          ?.map((message) => message.id),
      ).toEqual(["msg_2", "msg_5"])
      expect(projection.assistantMessagesByParent().has(steer.id)).toBe(false)
      expect([...projection.messageRowIndex()]).toEqual([
        ["msg_1", 0],
        ["msg_3", 2],
      ])
      expect([...projection.messageLastRowIndex()]).toEqual([
        ["msg_1", 1],
        ["msg_3", 3],
      ])
      expect([...projection.lastAssistantGroupKey()]).toEqual([["msg_1", "context:msg_5:tool_read"]])
      expect(projection.rowByKey().get("user-message:msg_1")).toBe(projection.rows()[0])
      expect(projection.rowByKey().size).toBe(projection.rows().length)
      dispose()
    })
  })

  test("moves a queued input after existing work when changed to steer", () => {
    const source = [...messages.slice(0, 3), work]
    expect(visibleTimelineMessages(source, [{ ...steer, delivery: "queue" }]).map((message) => message.id)).toEqual([
      "msg_1",
      "msg_2",
      "msg_5",
    ])
    expect(visibleTimelineMessages(source, [steer]).map((message) => message.id)).toEqual([
      "msg_1",
      "msg_2",
      "msg_5",
      "msg_3",
    ])
    const delivered = [messages[0], messages[1], work, messages[2]]
    expect(visibleTimelineMessages(delivered, [])).toBe(delivered)
  })

  test("preserves pending input order and excludes reverted steers", () => {
    const source = [...messages, work]
    const pending = [steer, { ...steer, id: "msg_4" }]
    expect(visibleTimelineMessages(source, pending).map((message) => message.id)).toEqual([
      "msg_1",
      "msg_2",
      "msg_5",
      "msg_3",
      "msg_4",
    ])

    // A notice admitted after the steers, before the next step, sinks with them in admission order. The
    // server delivers steers in that order and the store moves each delivered input to the end, so the
    // rendered order does not change at delivery.
    const notice = {
      id: "msg_4a",
      sessionID: "ses_1",
      time: { created: 4 },
      type: "synthetic",
      delivery: "steer",
      payload: { text: "", description: "Task finished" },
    } satisfies SessionInboxInfo

    const noticeMessage = {
      id: notice.id,
      type: "synthetic",
      ...notice.payload,
      time: notice.time,
    } satisfies SessionMessageInfo

    const pendingOrder = visibleTimelineMessages([...messages, noticeMessage, work], [...pending, notice])

    // The order the server delivers in: active work, then steers and notices by admission.
    expect(pendingOrder.map((message) => message.id)).toEqual(["msg_1", "msg_2", "msg_5", "msg_3", "msg_4", "msg_4a"])
    expect(visibleTimelineMessages(source, pending, "msg_4").map((message) => message.id)).toEqual([
      "msg_1",
      "msg_2",
      "msg_3",
    ])
  })

  test("hides queued inputs until delivery", () => {
    const pending = [
      {
        id: "msg_3",
        sessionID: "ses_1",
        time: { created: 3 },
        type: "user",
        delivery: "queue",
        payload: { text: "queued" },
      },
    ] satisfies SessionInboxInfo[]

    expect(visibleTimelineMessages(messages, pending).map((message) => message.id)).toEqual(["msg_1", "msg_2", "msg_4"])
  })

  test("hides the staged revert boundary and later messages", () => {
    expect(visibleTimelineMessages(messages, [], "msg_4").map((message) => message.id)).toEqual([
      "msg_1",
      "msg_2",
      "msg_3",
    ])
    expect(visibleTimelineMessages(messages, [], "msg_0")).toEqual([])
  })

  test("keeps a pre-promotion failed idle marker after the pending input that triggered it", () => {
    const failed = [
      { id: "msg_3", type: "user", text: "queued", time: { created: 3 } },
      {
        id: "msg_idle",
        type: "idle",
        outcome: "failed",
        error: { type: "unknown", message: 'Agent not found: "build"' },
        time: { created: 4 },
      },
    ] satisfies SessionMessageInfo[]

    expect(visibleTimelineMessages(failed, [steer]).map((message) => message.id)).toEqual(["msg_3", "msg_idle"])
  })
})

describe("applyTimelineMessageHandoff", () => {
  const message = {
    id: "msg_image",
    type: "user",
    text: "",
    files: [
      {
        data: "",
        mime: "image/png",
        source: { type: "uri", uri: "blob:image" },
        name: "image.png",
      },
    ],
    time: { created: 1 },
  } satisfies SessionMessageInfo

  const selection = { agent: "plan", model: { id: "next", providerID: "provider", variant: "high" } }
  const handoff = { message, selection }
  const switched = { agent: "plan", model: selection.model }

  test("shows a promoted image-only prompt before client admission", () => {
    expect(applyTimelineMessageHandoff([], handoff, switched)).toEqual([message])
  })

  test("adds attachments to the client's optimistic row", () => {
    const optimistic = { id: message.id, type: "user", text: "", time: { created: 2 } } satisfies SessionMessageInfo
    expect(applyTimelineMessageHandoff([optimistic], handoff, switched)).toEqual([
      { ...optimistic, files: message.files },
    ])
  })

  test("keeps the durable attachment payload", () => {
    const durable = {
      ...message,
      files: [{ data: "YQ==", mime: "image/png", source: { type: "inline" } }],
    } satisfies SessionMessageInfo

    const source = [durable]

    expect(applyTimelineMessageHandoff(source, handoff, switched)).toBe(source)
  })

  const agent = {
    id: "msg_image_agent",
    type: "agent-switched",
    agent: "plan",
    previous: "build",
    time: { created: 1 },
  } satisfies SessionMessageInfo

  const model = {
    id: "msg_image_model",
    type: "model-switched",
    model: selection.model,
    time: { created: 1 },
  } satisfies SessionMessageInfo

  // The session takes each switch from its echo, which also lands the durable notice.
  test.each([
    {
      name: "both switches pending",
      session: { agent: "build", model: { id: "old", providerID: "provider" } },
      notices: [agent, model],
    },
    {
      name: "only a variant change",
      session: { agent: "plan", model: { ...selection.model, variant: undefined } },
      notices: [model],
    },
    {
      name: "the agent echoed",
      session: { agent: "plan", model: { id: "old", providerID: "provider" } },
      notices: [model],
    },
    { name: "both echoed", session: switched, notices: [] },
  ])("projects the prompt's switches ahead of it: $name", (row) => {
    expect(applyTimelineMessageHandoff(messages.slice(0, 2), handoff, row.session)).toEqual([
      ...messages.slice(0, 2),
      ...row.notices,
      message,
    ])
  })

  test("projects pending switches ahead of the client's optimistic row", () => {
    const optimistic = { ...message, files: [] } satisfies SessionMessageInfo
    const session = { agent: "build", model: selection.model }

    expect(applyTimelineMessageHandoff([messages[0], optimistic], handoff, session)).toEqual([
      messages[0],
      agent,
      message,
    ])
  })
})
