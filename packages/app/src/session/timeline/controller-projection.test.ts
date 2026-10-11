import { SessionID } from "@opencode/schema/session-id"
import { Provider } from "@opencode/schema/provider"
import { Model } from "@opencode/schema/model"
import { Agent } from "@opencode/schema/agent"
import { SessionMessage } from "@opencode/schema/session-message"
import { describe, expect, test } from "bun:test"
import type { SessionInboxInfo, SessionMessageInfo } from "@opencode/client/promise"
import { createRoot } from "solid-js"
import { applyTimelineMessageHandoff, visibleTimelineMessages } from "./controller-projection"
import { createTimelineProjection } from "./projection"
import { timelinePresets } from "@opencode/session-ui/timeline/detail"

const messages = [
  { id: SessionMessage.ID.make("msg_1", { disableChecks: true }), type: "user", text: "first", time: { created: 1 } },
  {
    id: SessionMessage.ID.make("msg_2", { disableChecks: true }),
    type: "assistant",
    agent: Agent.ID.make("build", { disableChecks: true }),
    model: {
      id: Model.ID.make("model", { disableChecks: true }),
      providerID: Provider.ID.make("provider", { disableChecks: true }),
    },
    content: [],
    time: { created: 2 },
  },
  { id: SessionMessage.ID.make("msg_3", { disableChecks: true }), type: "user", text: "queued", time: { created: 3 } },
  {
    id: SessionMessage.ID.make("msg_4", { disableChecks: true }),
    type: "user",
    text: "reverted",
    time: { created: 4 },
  },
] satisfies SessionMessageInfo[]

describe("visibleTimelineMessages", () => {
  const steer = {
    id: SessionMessage.ID.make("msg_3", { disableChecks: true }),
    sessionID: SessionID.make("ses_1", { disableChecks: true }),
    time: { created: 3 },
    type: "user",
    delivery: "steer",
    payload: { text: "queued" },
  } satisfies SessionInboxInfo

  const work = {
    id: SessionMessage.ID.make("msg_5", { disableChecks: true }),
    type: "assistant",
    agent: Agent.ID.make("build", { disableChecks: true }),
    model: {
      id: Model.ID.make("model", { disableChecks: true }),
      providerID: Provider.ID.make("provider", { disableChecks: true }),
    },
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
    expect<unknown>(source.map((message) => message.id)).toEqual(["msg_1", "msg_2", "msg_3", "msg_5"])
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
      expect<unknown>(projection.activeMessageID()).toBe("msg_1")
      expect<unknown>(projection.rows().map((row) => [row._tag, row.userMessageID])).toEqual([
        ["UserMessage", "msg_1"],
        ["AssistantPart", "msg_1"],
        ["TurnGap", "msg_3"],
        ["UserMessage", "msg_3"],
      ])
      expect(
        projection
          .assistantMessagesByParent()
          .get(SessionMessage.ID.make("msg_1", { disableChecks: true }))
          ?.map((message) => message.id),
      ).toEqual(["msg_2", "msg_5"])
      expect(projection.assistantMessagesByParent().has(steer.id)).toBe(false)
      expect<unknown>([...projection.messageRowIndex()]).toEqual([
        ["msg_1", 0],
        ["msg_3", 2],
      ])
      expect<unknown>([...projection.messageLastRowIndex()]).toEqual([
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
    expect<unknown>(
      visibleTimelineMessages(source, [{ ...steer, delivery: "queue" }]).map((message) => message.id),
    ).toEqual(["msg_1", "msg_2", "msg_5"])
    expect<unknown>(visibleTimelineMessages(source, [steer]).map((message) => message.id)).toEqual([
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
    const pending = [steer, { ...steer, id: SessionMessage.ID.make("msg_4", { disableChecks: true }) }]
    expect<unknown>(visibleTimelineMessages(source, pending).map((message) => message.id)).toEqual([
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
      id: SessionMessage.ID.make("msg_4a", { disableChecks: true }),
      sessionID: SessionID.make("ses_1", { disableChecks: true }),
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
    expect<unknown>(pendingOrder.map((message) => message.id)).toEqual([
      "msg_1",
      "msg_2",
      "msg_5",
      "msg_3",
      "msg_4",
      "msg_4a",
    ])
    expect<unknown>(
      visibleTimelineMessages(source, pending, SessionMessage.ID.make("msg_4", { disableChecks: true })).map(
        (message) => message.id,
      ),
    ).toEqual(["msg_1", "msg_2", "msg_3"])
  })

  test("hides queued inputs until delivery", () => {
    const pending = [
      {
        id: SessionMessage.ID.make("msg_3", { disableChecks: true }),
        sessionID: SessionID.make("ses_1", { disableChecks: true }),
        time: { created: 3 },
        type: "user",
        delivery: "queue",
        payload: { text: "queued" },
      },
    ] satisfies SessionInboxInfo[]

    expect(visibleTimelineMessages(messages, pending).map((message) => message.id)).toEqual(["msg_1", "msg_2", "msg_4"])
  })

  test("hides the staged revert boundary and later messages", () => {
    expect(
      visibleTimelineMessages(messages, [], SessionMessage.ID.make("msg_4", { disableChecks: true })).map(
        (message) => message.id,
      ),
    ).toEqual(["msg_1", "msg_2", "msg_3"])
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
  const handoff = {
    id: SessionMessage.ID.make("msg_image", { disableChecks: true }),
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

  test("shows a promoted image-only prompt before client admission", () => {
    expect(applyTimelineMessageHandoff([], handoff)).toEqual([handoff])
  })

  test("adds attachments to the client's optimistic row", () => {
    const optimistic = {
      id: SessionMessage.ID.make(handoff.id, { disableChecks: true }),
      type: "user",
      text: "",
      time: { created: 2 },
    } satisfies SessionMessageInfo
    expect(applyTimelineMessageHandoff([optimistic], handoff)).toEqual([{ ...optimistic, files: handoff.files }])
  })

  test("keeps the durable attachment payload", () => {
    const durable = {
      ...handoff,
      files: [{ data: "YQ==", mime: "image/png", source: { type: "inline" } }],
    } satisfies SessionMessageInfo

    expect(applyTimelineMessageHandoff([durable], handoff)).toEqual([durable])
  })
})
