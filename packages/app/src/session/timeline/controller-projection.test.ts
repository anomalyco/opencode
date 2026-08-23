import { describe, expect, test } from "bun:test"
import type { SessionInboxInfo, SessionMessageInfo } from "@opencode-ai/client/promise"
import { applyTimelineMessageHandoff, visibleTimelineMessages } from "./controller-projection"

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
  test("hides queued inputs until delivery", () => {
    const pending = [
      {
        id: "msg_3",
        sessionID: "ses_1",
        timeCreated: 3,
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
})

describe("applyTimelineMessageHandoff", () => {
  const handoff = {
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

  test("shows a promoted image-only prompt before client admission", () => {
    expect(applyTimelineMessageHandoff([], handoff)).toEqual([handoff])
  })

  test("adds attachments to the client's optimistic row", () => {
    const optimistic = { id: handoff.id, type: "user", text: "", time: { created: 2 } } satisfies SessionMessageInfo
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
