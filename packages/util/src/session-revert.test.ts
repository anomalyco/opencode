import { expect, test } from "bun:test"
import { beforeRevert } from "./session-revert.js"

const messages = ["msg_sch_first", "msg_010", "msg_030", "msg_020"].map((id) => ({ id }))

test("a revert leaves the messages before its boundary in the transcript, whatever their IDs sort like", () => {
  // The scheduled prompt sorts after the boundary, and the last message sorts before it.
  expect(beforeRevert(messages, "msg_030")).toEqual([{ id: "msg_sch_first" }, { id: "msg_010" }])
  expect(beforeRevert(messages, "msg_sch_first")).toEqual([])
  // A boundary that is not loaded is older than every loaded message.
  expect(beforeRevert(messages, "msg_000")).toEqual([])
  expect(beforeRevert(messages, undefined)).toBe(messages)
})
