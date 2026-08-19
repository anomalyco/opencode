import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message, UserMessage } from "@opencode-ai/sdk/v2"
import { isTimelineReady, loadOlderTimeline, selectUserMessages, selectVisibleUserMessages } from "./model"

const user = (id: string, created: number) => ({ id, role: "user", time: { created } }) as UserMessage
const assistant = (id: string, created: number) => ({ id, role: "assistant", time: { created } }) as AssistantMessage

describe("timeline model", () => {
  test("selects users and applies the revert boundary", () => {
    const messages: Message[] = [user("msg_1", 1), assistant("msg_2", 2), user("msg_3", 3), user("msg_5", 5)]
    const users = selectUserMessages(messages)

    expect(users.map((message) => message.id)).toEqual(["msg_1", "msg_3", "msg_5"])
    expect(selectVisibleUserMessages(messages, { messageID: "msg_5" }).map((message) => message.id)).toEqual([
      "msg_1",
      "msg_3",
    ])
    expect(selectVisibleUserMessages(messages).map((message) => message.id)).toEqual(["msg_1", "msg_3", "msg_5"])
  })

  test("uses message ordering, not ID ordering, for revert boundaries", () => {
    const messages: Message[] = [user("msg_9", 1), assistant("msg_2", 2), user("msg_1", 3)]

    expect(selectVisibleUserMessages(messages, { messageID: "msg_2" }).map((message) => message.id)).toEqual(["msg_9"])
  })

  test("keeps the boundary user visible for part-level revert boundaries", () => {
    const messages: Message[] = [user("msg_1", 1), user("msg_2", 2), assistant("msg_3", 3)]

    expect(
      selectVisibleUserMessages(messages, { messageID: "msg_2", partID: "prt_2" }).map((message) => message.id),
    ).toEqual(["msg_1", "msg_2"])
  })

  test("waits for an assistant-only load to hydrate its user root", () => {
    expect(isTimelineReady([assistant("msg_2", 2)], true)).toBe(false)
    expect(isTimelineReady([user("msg_1", 1), assistant("msg_2", 2)], true)).toBe(true)
    expect(isTimelineReady([user("msg_2", 2)], true, { messageID: "msg_2" })).toBe(false)
    expect(isTimelineReady([user("msg_1", 1), user("msg_2", 2)], true, { messageID: "msg_2" })).toBe(true)
    expect(isTimelineReady([], false)).toBe(true)
  })

  test("loads exactly one opaque cursor page", async () => {
    let calls = 0
    const anchors: Array<string | boolean> = []

    await loadOlderTimeline({
      sessionID: () => "ses_test",
      more: () => true,
      loading: () => false,
      loadMore: async () => {
        calls += 1
      },
      before: () => anchors.push("before"),
      after: (done) => anchors.push("after", done),
    })

    expect(calls).toBe(1)
    expect(anchors).toEqual(["before", "after", true])
  })

  test("stops when a page adds no raw messages", async () => {
    let calls = 0
    await loadOlderTimeline({
      sessionID: () => "ses_test",
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
