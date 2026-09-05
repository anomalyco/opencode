import { expect, test } from "bun:test"
import type { SessionMessageUser } from "@opencode-ai/client/promise"
import { loadRevertBoundary, loadUndoTarget } from "./session-domain"

const user = (id: string): SessionMessageUser => ({ id, type: "user", text: id, time: { created: 1 } })

test("loads older pages until the revert boundary is available", async () => {
  const messages = [user("msg_newest")]
  const pages = [[user("msg_middle")], [user("msg_before"), user("msg_boundary")]]
  let loads = 0

  const result = await loadRevertBoundary({
    messageID: "msg_boundary",
    messages: () => messages,
    more: () => pages.length > 0,
    loadMore: async () => {
      messages.unshift(...(pages.shift() ?? []))
      loads += 1
    },
  })

  expect(loads).toBe(2)
  expect(result?.map((message) => message.id)).toEqual(["msg_before", "msg_boundary", "msg_middle", "msg_newest"])
})

test("stops when the revert boundary is not available", async () => {
  const messages = [user("msg_newest")]

  expect(
    await loadRevertBoundary({
      messageID: "msg_boundary",
      messages: () => messages,
      more: () => false,
      loadMore: async () => undefined,
    }),
  ).toBeUndefined()
})

test("loads older pages before selecting the next undo target", async () => {
  const messages = [user("msg_newest")]
  const pages = [[user("msg_previous"), user("msg_boundary")]]

  const result = await loadUndoTarget({
    messageID: "msg_boundary",
    messages: () => messages,
    more: () => pages.length > 0,
    loadMore: async () => {
      messages.unshift(...(pages.shift() ?? []))
    },
  })

  expect(result).toEqual({ message: user("msg_previous"), previous: undefined })
})

test("loads past a page-leading boundary to resolve the undo target and its predecessor", async () => {
  const messages = [user("msg_boundary"), user("msg_newest")]
  const pages = [[user("msg_previous"), user("msg_target")]]

  const result = await loadUndoTarget({
    messageID: "msg_boundary",
    messages: () => messages,
    more: () => pages.length > 0,
    loadMore: async () => {
      messages.unshift(...(pages.shift() ?? []))
    },
  })

  expect(result).toEqual({ message: user("msg_target"), previous: user("msg_previous") })
})
