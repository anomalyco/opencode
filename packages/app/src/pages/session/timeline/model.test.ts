import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message, UserMessage } from "@opencode-ai/sdk/v2"
import { loadOlderTimeline, selectUserMessages, selectVisibleUserMessages } from "./model"

const user = (id: string) => ({ id, role: "user" }) as UserMessage
const assistant = (id: string) => ({ id, role: "assistant" }) as AssistantMessage

describe("timeline model", () => {
  test("selects users and applies the revert boundary", () => {
    const messages: Message[] = [user("msg_1"), assistant("msg_2"), user("msg_3"), user("msg_5")]
    const users = selectUserMessages(messages)

    expect(users.map((message) => message.id)).toEqual(["msg_1", "msg_3", "msg_5"])
    expect(selectVisibleUserMessages(users, "msg_5").map((message) => message.id)).toEqual(["msg_1", "msg_3"])
    expect(selectVisibleUserMessages(users)).toBe(users)
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
