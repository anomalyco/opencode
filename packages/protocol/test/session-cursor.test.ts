import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { SessionHistoryQuery, SessionsCursor } from "../src/groups/session"
import { Session } from "@bolt-ai/schema/session"

test("SessionsCursor remains the canonical session list cursor", () => {
  expect(SessionsCursor).toBe(Session.ListCursor)
})
