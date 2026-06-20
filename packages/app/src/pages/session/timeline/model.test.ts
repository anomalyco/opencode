import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message, Part, UserMessage } from "@opencode-ai/sdk/v2"
import { isInternalUserMessage, loadOlderTimeline, selectUserMessages, selectVisibleUserMessages } from "./model"

const user = (id: string) => ({ id, role: "user" }) as UserMessage
const assistant = (id: string) => ({ id, role: "assistant" }) as AssistantMessage
const textPart = (messageID: string, input: { synthetic?: boolean; text?: string } = {}) =>
  ({
    id: `prt_${messageID}_${input.synthetic ? "synthetic" : "real"}`,
    sessionID: "ses",
    messageID,
    type: "text",
    text: input.text ?? "continue",
    synthetic: input.synthetic,
  }) as Part

describe("timeline model", () => {
  test("selects users and applies the revert boundary", () => {
    const messages: Message[] = [user("msg_1"), assistant("msg_2"), user("msg_3"), user("msg_5")]
    const users = selectUserMessages(messages)

    expect(users.map((message) => message.id)).toEqual(["msg_1", "msg_3", "msg_5"])
    expect(selectVisibleUserMessages(users, "msg_5").map((message) => message.id)).toEqual(["msg_1", "msg_3"])
    expect(selectVisibleUserMessages(users)).toBe(users)
  })

  test("hides synthetic-only internal continuation user messages", () => {
    const real = user("msg_1")
    const internal = user("msg_2")

    expect(
      selectVisibleUserMessages([real, internal], undefined, {
        msg_1: [textPart("msg_1", { text: "real prompt" })],
        msg_2: [textPart("msg_2", { synthetic: true, text: "continue\n<!-- OMO_INTERNAL_INITIATOR -->" })],
      }),
    ).toEqual([real])
    expect(isInternalUserMessage(internal, { msg_2: [textPart("msg_2", { synthetic: true })] })).toBe(true)
  })

  test("keeps mixed real and synthetic user messages visible", () => {
    const mixed = user("msg_1")
    expect(
      selectVisibleUserMessages([mixed], undefined, {
        msg_1: [textPart("msg_1", { synthetic: true }), textPart("msg_1", { text: "real prompt" })],
      }),
    ).toEqual([mixed])
  })

  test("loads pages until a visible user turn is added", async () => {
    let loaded = 10
    let visible = 2
    let calls = 0
    const anchors: Array<string | boolean> = []

    await loadOlderTimeline({
      sessionID: () => "ses_test",
      loaded: () => loaded,
      visible: () => visible,
      more: () => true,
      loading: () => false,
      loadMore: async () => {
        calls += 1
        loaded += 3
        if (calls === 2) visible += 1
      },
      before: () => anchors.push("before"),
      after: (done) => anchors.push("after", done),
    })

    expect(calls).toBe(2)
    expect(anchors).toEqual(["before", "after", false, "after", true])
  })

  test("stops when a page adds no raw messages", async () => {
    let calls = 0
    await loadOlderTimeline({
      sessionID: () => "ses_test",
      loaded: () => 10,
      visible: () => 2,
      more: () => true,
      loading: () => false,
      loadMore: async () => {
        calls += 1
      },
    })

    expect(calls).toBe(1)
  })

  test("does not restore an anchor after the session changes", async () => {
    let sessionID = "ses_old"
    let restore = 0

    await loadOlderTimeline({
      sessionID: () => sessionID,
      loaded: () => 10,
      visible: () => 2,
      more: () => true,
      loading: () => false,
      loadMore: async () => {
        sessionID = "ses_new"
      },
      after: () => {
        restore += 1
      },
    })

    expect(restore).toBe(0)
  })

  test("releases the anchor when loading history fails", async () => {
    let restore = 0

    await expect(
      loadOlderTimeline({
        sessionID: () => "ses_test",
        loaded: () => 10,
        visible: () => 2,
        more: () => true,
        loading: () => false,
        loadMore: async () => {
          throw new Error("history failed")
        },
        after: () => {
          restore += 1
        },
      }),
    ).rejects.toThrow("history failed")

    expect(restore).toBe(1)
  })
})
