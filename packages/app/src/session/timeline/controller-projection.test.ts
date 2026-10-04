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
    expect(visible.map((message) => message.id)).toEqual([
      SessionMessage.ID.make("msg_1", { disableChecks: true }),
      SessionMessage.ID.make("msg_2", { disableChecks: true }),
      SessionMessage.ID.make("msg_5", { disableChecks: true }),
      SessionMessage.ID.make("msg_3", { disableChecks: true }),
    ])
    expect(source.map((message) => message.id)).toEqual([
      SessionMessage.ID.make("msg_1", { disableChecks: true }),
      SessionMessage.ID.make("msg_2", { disableChecks: true }),
      SessionMessage.ID.make("msg_3", { disableChecks: true }),
      SessionMessage.ID.make("msg_5", { disableChecks: true }),
    ])
    expect(visible[2]).toBe(work)

    createRoot((dispose) => {
      const projection = createTimelineProjection({
        sessionMessages: () => visible,
        status: () => ({ type: "busy" }),
        reasoningMode: () => "compact",
        shellToolDefaultOpen: () => false,
        editToolDefaultOpen: () => false,
        timelineDetail: () => timelinePresets[2].value,
        pendingUserMessageIDs: () => new Set([steer.id]),
      })
      expect(projection.activeMessageID()).toBe(SessionMessage.ID.make("msg_1", { disableChecks: true }))
      expect(projection.rows().map((row) => [row._tag, row.userMessageID])).toEqual([
        ["UserMessage", SessionMessage.ID.make("msg_1", { disableChecks: true })],
        ["AssistantPart", SessionMessage.ID.make("msg_1", { disableChecks: true })],
        ["TurnGap", SessionMessage.ID.make("msg_3", { disableChecks: true })],
        ["UserMessage", SessionMessage.ID.make("msg_3", { disableChecks: true })],
      ])
      expect(
        projection
          .assistantMessagesByParent()
          .get(SessionMessage.ID.make("msg_1", { disableChecks: true }))
          ?.map((message) => message.id),
      ).toEqual([
        SessionMessage.ID.make("msg_2", { disableChecks: true }),
        SessionMessage.ID.make("msg_5", { disableChecks: true }),
      ])
      expect(projection.assistantMessagesByParent().has(steer.id)).toBe(false)
      expect([...projection.messageRowIndex()]).toEqual([
        [SessionMessage.ID.make("msg_1", { disableChecks: true }), 0],
        [SessionMessage.ID.make("msg_3", { disableChecks: true }), 2],
      ])
      expect([...projection.messageLastRowIndex()]).toEqual([
        [SessionMessage.ID.make("msg_1", { disableChecks: true }), 1],
        [SessionMessage.ID.make("msg_3", { disableChecks: true }), 3],
      ])
      expect([...projection.lastAssistantGroupKey()]).toEqual([
        [SessionMessage.ID.make("msg_1", { disableChecks: true }), "context:msg_5:tool_read"],
      ])
      expect(projection.rowByKey().get("user-message:msg_1")).toBe(projection.rows()[0])
      expect(projection.rowByKey().size).toBe(projection.rows().length)
      dispose()
    })
  })

  test("moves a queued input after existing work when changed to steer", () => {
    const source = [...messages.slice(0, 3), work]
    expect(visibleTimelineMessages(source, [{ ...steer, delivery: "queue" }]).map((message) => message.id)).toEqual([
      SessionMessage.ID.make("msg_1", { disableChecks: true }),
      SessionMessage.ID.make("msg_2", { disableChecks: true }),
      SessionMessage.ID.make("msg_5", { disableChecks: true }),
    ])
    expect(visibleTimelineMessages(source, [steer]).map((message) => message.id)).toEqual([
      SessionMessage.ID.make("msg_1", { disableChecks: true }),
      SessionMessage.ID.make("msg_2", { disableChecks: true }),
      SessionMessage.ID.make("msg_5", { disableChecks: true }),
      SessionMessage.ID.make("msg_3", { disableChecks: true }),
    ])
    const delivered = [messages[0], messages[1], work, messages[2]]
    expect(visibleTimelineMessages(delivered, [])).toBe(delivered)
  })

  test("preserves steer order and excludes reverted steers", () => {
    const source = [...messages, work]
    const pending = [steer, { ...steer, id: SessionMessage.ID.make("msg_4", { disableChecks: true }) }]
    expect(visibleTimelineMessages(source, pending).map((message) => message.id)).toEqual([
      SessionMessage.ID.make("msg_1", { disableChecks: true }),
      SessionMessage.ID.make("msg_2", { disableChecks: true }),
      SessionMessage.ID.make("msg_5", { disableChecks: true }),
      SessionMessage.ID.make("msg_3", { disableChecks: true }),
      SessionMessage.ID.make("msg_4", { disableChecks: true }),
    ])
    expect(
      visibleTimelineMessages(source, pending, SessionMessage.ID.make("msg_4", { disableChecks: true })).map(
        (message) => message.id,
      ),
    ).toEqual([
      SessionMessage.ID.make("msg_1", { disableChecks: true }),
      SessionMessage.ID.make("msg_2", { disableChecks: true }),
      SessionMessage.ID.make("msg_3", { disableChecks: true }),
    ])
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

    expect(visibleTimelineMessages(messages, pending).map((message) => message.id)).toEqual([
      SessionMessage.ID.make("msg_1", { disableChecks: true }),
      SessionMessage.ID.make("msg_2", { disableChecks: true }),
      SessionMessage.ID.make("msg_4", { disableChecks: true }),
    ])
  })

  test("hides the staged revert boundary and later messages", () => {
    expect(
      visibleTimelineMessages(messages, [], SessionMessage.ID.make("msg_4", { disableChecks: true })).map(
        (message) => message.id,
      ),
    ).toEqual([
      SessionMessage.ID.make("msg_1", { disableChecks: true }),
      SessionMessage.ID.make("msg_2", { disableChecks: true }),
      SessionMessage.ID.make("msg_3", { disableChecks: true }),
    ])
    expect(visibleTimelineMessages(messages, [], "msg_0")).toEqual([])
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
