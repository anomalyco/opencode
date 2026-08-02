import { expect, test } from "bun:test"
import type { SessionMessageInfo, SessionMessageUser } from "@opencode-ai/client"
import { findUndoBoundary } from "../../../src/routes/session/undo"

test("selects the latest promoted user message without pending inputs", () => {
  expect(findUndoBoundary([user("msg_001", "First"), user("msg_002", "Second")], [])?.id).toBe("msg_002")
})

test("skips the latest user message while it is pending", () => {
  expect(findUndoBoundary([user("msg_001", "First"), user("msg_002", "Second")], ["msg_002"])?.id).toBe("msg_001")
})

test("returns no boundary when all user messages are pending", () => {
  expect(
    findUndoBoundary([user("msg_001", "First"), user("msg_002", "Second")], ["msg_001", "msg_002"]),
  ).toBeUndefined()
})

test("selects only messages before an existing revert boundary", () => {
  expect(
    findUndoBoundary([user("msg_001", "First"), user("msg_002", "Second"), user("msg_003", "Third")], [], "msg_003")
      ?.id,
  ).toBe("msg_002")
})

test("skips blank user messages", () => {
  expect(findUndoBoundary([user("msg_001", "First"), user("msg_002", "  \n  ")], [])?.id).toBe("msg_001")
})

test("selects a newer promoted message when an earlier message is pending", () => {
  expect(
    findUndoBoundary([user("msg_001", "First"), user("msg_002", "Pending"), user("msg_003", "Third")], ["msg_002"])?.id,
  ).toBe("msg_003")
})

function user(id: string, text: string): SessionMessageUser {
  return { type: "user", id, text, time: { created: 0 } } satisfies SessionMessageInfo
}
