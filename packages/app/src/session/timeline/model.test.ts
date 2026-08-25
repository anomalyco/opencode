import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo, SessionMessageUser } from "@opencode-ai/client/promise"
import {
  enrichLeadingTurn,
  leadingTurnNeedsParent,
  loadOlderTimeline,
  selectUserMessages,
  selectVisibleUserMessages,
} from "./model"

const user = (id: string): SessionMessageUser => ({ id, type: "user", text: id, time: { created: 1 } })
const assistant = (id: string): SessionMessageAssistant => ({
  id,
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content: [],
  time: { created: 1 },
})

describe("timeline model", () => {
  test("selects users and applies the revert boundary", () => {
    const messages: SessionMessageInfo[] = [user("msg_a"), assistant("msg_ab"), user("msg_b"), user("msg_c")]
    const users = selectUserMessages(messages)

    expect(users.map((message) => message.id)).toEqual(["msg_a", "msg_b", "msg_c"])
    expect(selectVisibleUserMessages(users, "msg_b").map((message) => message.id)).toEqual(["msg_a"])
    expect(selectVisibleUserMessages(users.slice(2), "msg_b")).toEqual([])
    expect(selectVisibleUserMessages(users)).toBe(users)
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

  test("recognizes a leading partial assistant turn", () => {
    expect(leadingTurnNeedsParent([assistant("msg_assistant"), user("msg_next")])).toBe(true)
    expect(leadingTurnNeedsParent([user("msg_user"), assistant("msg_assistant")])).toBe(false)
    expect(leadingTurnNeedsParent([user("msg_user")])).toBe(false)
  })

  test("pauses between bounded history pages until the leading turn has its parent", async () => {
    const pages: SessionMessageInfo[][] = [[assistant("msg_older")], [user("msg_parent")]]
    const messages: SessionMessageInfo[] = [assistant("msg_latest"), user("msg_next")]
    let pauses = 0
    let loads = 0

    await enrichLeadingTurn({
      current: () => true,
      messages: () => messages,
      more: () => pages.length > 0,
      loading: () => false,
      loadMore: async () => {
        messages.unshift(...pages.shift()!)
        loads += 1
      },
      pause: async () => {
        pauses += 1
      },
      maxPages: 3,
    })

    expect(loads).toBe(2)
    expect(pauses).toBe(2)
    expect(leadingTurnNeedsParent(messages)).toBe(false)
  })

  test("caps background pages when the parent remains outside the window", async () => {
    let loads = 0

    await enrichLeadingTurn({
      current: () => true,
      messages: () => [assistant("msg_latest")],
      more: () => true,
      loading: () => false,
      loadMore: async () => {
        loads += 1
      },
      pause: async () => undefined,
      maxPages: 3,
    })

    expect(loads).toBe(3)
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
