import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo, SessionMessageUser } from "@opencode/client/promise"
import { enrichLeadingTurn, loadOlderTimeline } from "./model"

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
  test("does not enrich a different leading turn after prepending to a retained transcript", async () => {
    const messages: SessionMessageInfo[] = [user("msg_user"), assistant("msg_latest")]
    let loads = 0

    const input = {
      current: () => true,
      messages: () => messages,
      more: () => true,
      loading: () => false,
      loadMore: async () => {
        loads += 1
      },
      pause: async () => undefined,
      maxPages: 3,
    }

    await enrichLeadingTurn(input)
    messages.unshift(assistant("msg_older"))
    await enrichLeadingTurn(input)
    expect(loads).toBe(0)

    // An evicted/reloaded transcript gets its own initial enrichment budget.
    const reloaded = [...messages]
    await enrichLeadingTurn({ ...input, messages: () => reloaded })
    expect(loads).toBe(3)
  })

  const resumed = ["msg_previous_turn", "msg_parent", "msg_latest"]

  test("resumes the original leading turn after switching away", async () => {
    const messages: SessionMessageInfo[] = [assistant("msg_latest")]
    let current = true
    let loads = 0

    const input = {
      current: () => current,
      messages: () => messages,
      more: () => true,
      loading: () => false,
      loadMore: async () => {
        loads += 1
        messages.unshift(assistant("msg_previous_turn"), user("msg_parent"))
      },
      pause: async () => {
        current = false
      },
      maxPages: 3,
    }

    await enrichLeadingTurn(input)
    expect(loads).toBe(0)

    current = true
    await enrichLeadingTurn({ ...input, pause: async () => undefined })
    expect(messages.map((message) => message.id)).toEqual(resumed)
    expect(loads).toBe(1)

    await enrichLeadingTurn({ ...input, pause: async () => undefined })
    expect(loads).toBe(1)
  })

  test("resumes the original leading turn after a failed page", async () => {
    const messages: SessionMessageInfo[] = [assistant("msg_latest")]
    let loads = 0

    const input = {
      current: () => true,
      messages: () => messages,
      more: () => true,
      loading: () => false,
      loadMore: async () => {
        loads += 1

        if (loads === 1) throw new Error("history failed")
        messages.unshift(assistant("msg_previous_turn"), user("msg_parent"))
      },
      pause: async () => undefined,
      maxPages: 3,
    }

    await expect(enrichLeadingTurn(input)).rejects.toThrow("history failed")
    await enrichLeadingTurn(input)
    expect(messages.map((message) => message.id)).toEqual(resumed)
    expect(loads).toBe(2)

    await enrichLeadingTurn(input)
    expect(loads).toBe(2)
  })

  test("resumes the original leading turn after the transcript reconnects", async () => {
    const messages: SessionMessageInfo[] = [assistant("msg_latest")]
    let loads = 0

    const input = {
      current: () => true,
      messages: () => messages,
      more: () => true,
      loading: () => false,
      loadMore: async () => {
        loads += 1
        messages.unshift(assistant("msg_previous_turn"), user("msg_parent"))
      },
      pause: async () => undefined,
      maxPages: 3,
    }

    await enrichLeadingTurn(input)
    messages.splice(0, messages.length, assistant("msg_latest"))
    await enrichLeadingTurn(input)
    expect(messages.map((message) => message.id)).toEqual(resumed)
    expect(loads).toBe(2)

    await enrichLeadingTurn(input)
    expect(loads).toBe(2)
  })

  test.each([
    ["restores the anchor after one opaque cursor page", "ok", ["before", "load", "after", true]],
    ["does not restore an anchor after the session changes", "switch", ["before", "load"]],
    ["releases the anchor when loading history fails", "fail", ["before", "load", "after", true, "history failed"]],
  ] as const)("%s", async (_name, outcome, expected) => {
    let sessionID = "ses_old"
    const calls: Array<string | boolean> = []

    await loadOlderTimeline({
      sessionID: () => sessionID,
      more: () => true,
      loading: () => false,
      loadMore: async () => {
        calls.push("load")

        if (outcome === "switch") sessionID = "ses_new"

        if (outcome === "fail") throw new Error("history failed")
      },
      before: () => calls.push("before"),
      after: (done) => calls.push("after", done),
    }).catch((error: Error) => calls.push(error.message))

    expect(calls).toEqual([...expected])
  })

  test.each([
    ["caps background pages when the parent remains outside the window", [assistant("msg_latest")], 3],
    ["does not load before a leading user turn", [user("msg_user"), assistant("msg_latest")], 0],
    ["does not load without an assistant turn", [user("msg_user")], 0],
  ])("%s", async (_name, messages: SessionMessageInfo[], expected) => {
    let loads = 0

    await enrichLeadingTurn({
      current: () => true,
      messages: () => messages,
      more: () => true,
      loading: () => false,
      loadMore: async () => {
        loads += 1
      },
      pause: async () => undefined,
      maxPages: 3,
    })

    expect(loads).toBe(expected)
  })

  test("pauses between history pages and stops once the leading turn has its parent", async () => {
    const pages: SessionMessageInfo[][] = [
      [assistant("msg_older")],
      [assistant("msg_previous_turn"), user("msg_parent")],
      [user("msg_earlier")],
    ]

    const messages: SessionMessageInfo[] = [assistant("msg_latest"), user("msg_next")]
    const calls: string[] = []

    await enrichLeadingTurn({
      current: () => true,
      messages: () => messages,
      more: () => pages.length > 0,
      loading: () => false,
      loadMore: async () => {
        const page = pages.shift()!
        messages.unshift(...page)
        calls.push(`load:${page[0]!.id}`)
      },
      pause: async () => {
        calls.push("pause")
      },
      maxPages: 3,
    })

    expect(calls).toEqual(["pause", "load:msg_older", "pause", "load:msg_previous_turn"])
    expect(pages).toHaveLength(1)
  })
})
